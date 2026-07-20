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
    assert.equal(await page.locator("#navTabs .nav-button").count(), 8);
    assert.equal(await page.locator("#pageTitle").textContent(), "Dashboard");

    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    assert.equal(await page.locator("#pageTitle").textContent(), "Recipes");
    assert.ok(await page.locator(".recipe-card").count() > 0);

    await page.getByRole("button", { name: "Add recipe" }).click();
    assert.ok(await page.locator("#recipeDialog").evaluate((element) => element.open));
    await page.locator("#recipeDialog").getByRole("button", { name: "Cancel", exact: true }).click();

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
      localStorage.setItem("macrovault.mvp.v1", JSON.stringify(saved));
    });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => window.__macroVaultXss), undefined);
    assert.equal(await page.locator('img[src="x"]').count(), 0);
    assert.ok((await page.locator("#recipesView").textContent()).includes("<img src=x"));
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
