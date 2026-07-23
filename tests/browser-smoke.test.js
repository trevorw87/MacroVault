const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const types = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      const body = Buffer.from(JSON.stringify({ ok: false, message: "Test API unavailable" }));
      response.writeHead(404, { "Content-Type": "application/json", "Content-Length": body.length });
      response.end(body);
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const target = path.resolve(root, relative);
    if (!target.startsWith(root) || !fs.existsSync(target)) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    const body = fs.readFileSync(target);
    response.writeHead(200, { "Content-Type": types[path.extname(target)] || "application/octet-stream" });
    response.end(body);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("#navTabs .nav-button");
    assert.equal(await page.locator("#navTabs .nav-button").count(), 9);
    assert.equal(await page.locator("#pageTitle").textContent(), "Dashboard");

    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    assert.equal(await page.locator("#pageTitle").textContent(), "Recipes");
    assert.ok(await page.locator(".recipe-card").count() > 0);

    await page.getByRole("button", { name: "Add recipe" }).click();
    assert.ok(await page.locator("#recipeDialog").evaluate((element) => element.open));
    await page.locator("#recipeDialog").getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: "Family", exact: true }).click();
    const familyCardWidths = await page.locator("#kidsLayout .kid-habit-card").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().width));
    assert.ok(familyCardWidths.every((width) => width > 300));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);

    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      saved.ingredients.push({
        id: "shopping-dedupe-cornflour",
        name: "Cornflour",
        label: "Staples",
        serving: { amount: 100, unit: "g" },
        nutrition: {},
        onHand: false
      });
      saved.recipes.push({
        id: "shopping-dedupe-recipe",
        name: "Shopping dedupe check",
        category: "dinner",
        categories: ["dinner"],
        tags: [],
        ingredients: ["25 g Cornflour", "2 Cornflour"],
        ingredientRefs: [
          { ingredientId: "shopping-dedupe-cornflour", usedAmount: 25, usedUnit: "g" },
          { ingredientId: "shopping-dedupe-cornflour", usedAmount: 2, usedUnit: "each" }
        ],
        method: "Test",
        servings: 2,
        macros: { protein: 0, carbs: 0, fat: 0 }
      });
      saved.planner = { Sunday: { dinner: "shopping-dedupe-recipe" } };
      localStorage.setItem("macrovault.mvp.v1", JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Shopping", exact: true }).click();
    const cornflourRows = page.locator("#shoppingList .check-row").filter({ hasText: "Cornflour" });
    assert.equal(await cornflourRows.count(), 1);
    assert.match(await cornflourRows.textContent(), /12\.5 g \+ 1 each/);

    await page.getByRole("button", { name: "Private", exact: true }).click();
    await page.getByRole("button", { name: "Ashley", exact: true }).click();
    await page.locator("#weightGoalValue").fill("72.5");
    await page.getByRole("button", { name: "Save target", exact: true }).click();
    const weightGoalState = await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).privateWeightGoals);
    assert.equal(weightGoalState.Ashley, 72.5);
    assert.match(await page.locator("#weightStats").textContent(), /Target weight\s*72\.5 kg/);

    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      saved.activeTab = "recipes";
      saved.recipes.push({
        id: "xss-check",
        name: `<img src=x onerror="window.__macroVaultXss=1">`,
        category: "dinner",
        categories: ["dinner"],
        tags: [],
        ingredients: ["unsafe item"],
        method: "Test",
        servings: 1,
        macros: { protein: 0, carbs: 0, fat: 0 }
      });
      saved.privateWeights = [{ id: "weight-migration-check", person: "Amelia", date: "2026-07-20", weight: 30 }];
      localStorage.setItem("macrovault.mvp.v1", JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => window.__macroVaultXss), undefined);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.ok((await page.locator("#recipesView").textContent()).includes("<img src=x"));

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("#configAppName").fill("Family Table");
    await page.locator("#configHouseholdName").fill("The Example Household");
    await page.locator("#configProfileName").fill("Jordan");
    await page.locator("[data-config-member-name]").first().fill("Avery");
    await page.getByRole("button", { name: "Save configuration", exact: true }).click();
    assert.equal(await page.locator("#appBrand").textContent(), "Family Table");
    assert.equal(await page.locator("#householdBrand").textContent(), "The Example Household");
    assert.equal(await page.locator("#profileAvatar").getAttribute("aria-label"), "Jordan profile");
    const configured = await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")));
    assert.ok(configured.kids.Avery);
    assert.equal(configured.kids.Amelia, undefined);
    assert.equal(configured.privateWeights[0].person, "Avery");

    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      saved.recipes[0].imageUrl = "image-asset:missing-test";
      saved.recipes[1].imageUrl = "image-asset:server-backed-test";
      saved.imageLibrary = {
        "server-backed-test": {
          id: "server-backed-test",
          contentType: "image/png",
          sizeBytes: 1234,
          createdAt: "2026-07-23"
        }
      };
      localStorage.setItem("macrovault.mvp.v1", JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Site", exact: true }).click();
    const imageStorageText = await page.locator("#imageStorageGrid").textContent();
    const imageWarningText = await page.locator(".image-storage-warning").textContent();
    const imageRecipeNames = await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).recipes.slice(0, 2).map((recipe) => recipe.name));
    assert.match(imageStorageText, /1 uploaded image reference missing stored data/);
    assert.ok(imageStorageText.includes(`Recipe: ${imageRecipeNames[0]}`));
    assert.ok(!imageWarningText.includes(`Recipe: ${imageRecipeNames[1]}`));
    await page.getByRole("button", { name: "Remove broken image links", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Remove broken image links", exact: true }).count(), 0);
    const cleaned = await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")));
    assert.equal(cleaned.recipes[0].imageUrl, "");
    assert.equal(cleaned.recipes[1].imageUrl, "image-asset:server-backed-test");
    await page.getByRole("button", { name: "Clean up images", exact: true }).click();
    await page.getByText("Image storage is already clean.", { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
    console.log("Browser smoke and injection checks: PASS");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
