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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const desktopLayout = await page.evaluate(() => ({
      viewportWidth: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      clippedMealCards: [...document.querySelectorAll(".dashboard-meal-card")].filter((card) => card.scrollHeight > card.clientHeight + 1).length,
      clippedFamilyValues: [...document.querySelectorAll("#kidSummary .rev-gauge-count")].filter((value) => {
        const valueRect = value.getBoundingClientRect();
        const cardRect = value.closest(".kid-card").getBoundingClientRect();
        return valueRect.right > cardRect.right + 1 || valueRect.left < cardRect.left - 1;
      }).length
    }));
    assert.equal(desktopLayout.documentWidth, desktopLayout.viewportWidth);
    assert.equal(desktopLayout.clippedMealCards, 0);
    assert.equal(desktopLayout.clippedFamilyValues, 0);

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    const tabletNavTopSpread = await page.locator("#navTabs .nav-button").evaluateAll((buttons) => {
      const tops = buttons.map((button) => Math.round(button.getBoundingClientRect().top));
      return Math.max(...tops) - Math.min(...tops);
    });
    assert.ok(tabletNavTopSpread <= 1);
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    assert.ok(await page.locator(".planner-scroll-hint").isVisible());
    const tabletPlanner = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      gridClientWidth: document.querySelector("#plannerGrid").clientWidth,
      gridScrollWidth: document.querySelector("#plannerGrid").scrollWidth
    }));
    assert.equal(tabletPlanner.documentWidth, tabletPlanner.viewportWidth);
    assert.ok(tabletPlanner.gridScrollWidth > tabletPlanner.gridClientWidth);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    assert.equal(await page.locator(".planner-mobile-day").count(), 7);
    assert.equal(await page.locator(".planner-table").count(), 0);
    const mobileLayout = await page.evaluate(() => {
      const navTops = [...document.querySelectorAll("#navTabs .nav-button")].map((button) => Math.round(button.getBoundingClientRect().top));
      const planner = document.querySelector("#plannerGrid");
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        plannerClientWidth: planner.clientWidth,
        plannerScrollWidth: planner.scrollWidth,
        navTopSpread: Math.max(...navTops) - Math.min(...navTops),
        sidebarHeight: document.querySelector(".sidebar").getBoundingClientRect().height,
        navHeight: document.querySelector("#navTabs").getBoundingClientRect().height,
        brandHeight: document.querySelector(".brand").getBoundingClientRect().height,
        sidebarColumns: getComputedStyle(document.querySelector(".sidebar")).gridTemplateColumns
      };
    });
    assert.equal(mobileLayout.documentWidth, mobileLayout.viewportWidth);
    assert.ok(mobileLayout.plannerScrollWidth <= mobileLayout.plannerClientWidth + 1);
    assert.ok(mobileLayout.navTopSpread <= 1);
    assert.ok(mobileLayout.sidebarHeight < 80, JSON.stringify(mobileLayout));

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      Object.keys(saved.planner).forEach((day) => { saved.planner[day] = {}; });
      saved.ingredients.forEach((ingredient) => { ingredient.onHand = false; });
      saved.recipes.forEach((recipe) => { recipe.prepared = false; });
      saved.bought = [];
      saved.activeTab = "dashboard";
      localStorage.setItem("macrovault.mvp.v1", JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    await page.getByLabel("Add another dish to Monday Dinner", { exact: true }).selectOption("lemon-salmon");
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).planner.Monday.dinner),
      ["lemon-salmon"]
    );

    const expectedShoppingNames = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      const recipe = saved.recipes.find((item) => item.id === "lemon-salmon");
      return [...new Set(recipe.ingredientRefs.map((ref) => saved.ingredients.find((item) => item.id === ref.ingredientId)?.name).filter(Boolean))];
    });
    assert.ok(expectedShoppingNames.length >= 5);

    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Shopping", exact: true }).click();
    assert.equal(await page.locator("#shoppingList .check-row").count(), expectedShoppingNames.length);
    for (const ingredientName of expectedShoppingNames) {
      assert.equal(await page.locator("#shoppingList .check-row").filter({ hasText: ingredientName }).count(), 1);
    }

    const firstShoppingRow = page.locator("#shoppingList .check-row").filter({ hasText: expectedShoppingNames[0] });
    await firstShoppingRow.locator('input[type="checkbox"]').check();
    assert.ok(await page.evaluate((ingredientName) => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).bought.includes(ingredientName), expectedShoppingNames[0]));

    await page.getByRole("button", { name: "Planner", exact: true }).click();
    await page.getByRole("button", { name: "Remove Lemon Garlic Salmon from Monday Dinner", exact: true }).click();
    await page.getByRole("button", { name: "Shopping", exact: true }).click();
    assert.match(await page.locator("#shoppingList").textContent(), /No shopping items yet/);

    assert.deepEqual(pageErrors, []);
    console.log("Responsive layouts and planner-to-shopping journey: PASS");
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
