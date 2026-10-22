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
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:' + server.address().port, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Planner', exact: true }).click();
    const day = await page.locator('.planner-day-section[open]').getAttribute('data-planner-mobile-day');
    const before = await page.evaluate(day => plannedCaloriesPerPersonForDay(day), day);
    await page.locator('.planner-day-section[open] [data-essentials-apply]').first().click();
    assert.equal(await page.locator('.planner-day-section[open] .planner-essential-space').count(), 13);
    assert.equal(await page.evaluate(day => plannedCaloriesPerPersonForDay(day), day), before);
    const fruit = page.locator('[data-essential-day="' + day + '"][data-essential-space="fruit-morningSnack"]');
    await fruit.click();
    await page.locator('#foodLogDialog [aria-label="Close"]').click();
    assert.equal(await page.locator('#foodLogDialog').isVisible(), false);
    await fruit.click();
    assert.match(await page.locator('#foodLogResults button').first().innerText(), /Suggested/);
    await page.locator('#foodLogSearch').fill('Apple Slices');
    await page.locator('#foodLogResults button').first().click();
    await page.locator('#addFoodLogSubmit').click();
    assert.equal(await page.locator('#foodLogDialog').isVisible(), true, 'requires portion confirmation');
    await page.locator('#foodLogEssentialConfirm').check();
    await page.locator('#addFoodLogSubmit').click();
    assert.match(await fruit.getAttribute('class'), /complete/);
    const assignment = await page.evaluate(day => state.plannerEssentials[plannerWeekDateKey(day)].assignments['fruit-morningSnack'], day);
    const water = page.locator('[data-essential-water="' + day + '"]');
    await water.fill('2200');
    await water.press('Tab');
    await page.locator('.planner-day-section[open] [data-essentials-apply="week"]').click();
    assert.equal(await page.evaluate(() => days.filter(day => state.plannerEssentials[plannerWeekDateKey(day)]).length), 7);
    assert.equal(await page.evaluate(day => state.plannerEssentials[plannerWeekDateKey(day)].waterGoal, day), 2200);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Planner', exact: true }).click();
    assert.match(await fruit.getAttribute('class'), /complete/);
    assert.equal(await water.inputValue(), '2200');
    await page.evaluate(day => {
      const original = state.selectedPlannerWeek;
      const date = dateFromLocalKey(original); date.setDate(date.getDate() + 7);
      selectPlannerWeek(localDateKey(date));
      if (state.plannerEssentials?.[plannerWeekDateKey(day)]) throw new Error('Template leaked into another week');
      selectPlannerWeek(original); renderPlanner();
    }, day);
    assert.match(await fruit.getAttribute('class'), /complete/);
    await page.setViewportSize({ width: 390, height: 844 });
    await fruit.click({ trial: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(require('node:os').tmpdir(), 'macrovault-planner-essentials-preview.png'), fullPage: false });
    await page.evaluate(({day, id}) => {
      recipeById(id).ingredients.push('Extra apple slice');
      renderPlanner();
    }, { day, id: assignment.recipeId });
    assert.doesNotMatch(await fruit.getAttribute('class'), /complete/, 'portion changes require confirmation again');
    await page.evaluate(({day, id}) => {
      recipeById(id).ingredients.pop();
      state.planner[day].morningSnack = plannerRecipeIds(day, 'morningSnack').filter(item => item !== id);
      renderPlanner();
    }, { day, id: assignment.recipeId });
    assert.doesNotMatch(await fruit.getAttribute('class'), /complete/, 'removing food clears completion');
    await page.locator('.planner-day-section[open] [data-planner-food-day]').first().click();
    assert.equal(await page.locator('#foodLogEssentialConfirmation').isVisible(), false);
    assert.equal(await page.locator('#foodLogEssentialConfirm').getAttribute('required'), null);
    await page.locator('#foodLogDialog [aria-label="Close"]').click();
    assert.deepEqual(errors, []);
    console.log('Planner daily essentials: PASS');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
