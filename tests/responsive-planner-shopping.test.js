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

    await page.getByRole("button", { name: "Ingredients", exact: true }).click();
    const ingredientToolbarLayout = await page.evaluate(() => {
      const search = document.querySelector("#ingredientSearchForm").getBoundingClientRect();
      const actions = document.querySelector("#ingredientsView .toolbar-actions").getBoundingClientRect();
      const buttons = [...document.querySelectorAll("#ingredientsView .toolbar-actions button")];
      return {
        searchRight: search.right,
        actionsLeft: actions.left,
        actionTextClipped: buttons.some((button) => button.scrollWidth > button.clientWidth + 1)
      };
    });
    assert.ok(ingredientToolbarLayout.actionsLeft >= ingredientToolbarLayout.searchRight);
    assert.equal(ingredientToolbarLayout.actionTextClipped, false);
    await page.locator("#ingredientSearch").fill("chicken");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    assert.ok(await page.locator("#ingredientTable .ingredient-row").count() > 0);

    await page.getByRole("button", { name: "Recipes", exact: true }).click();
    const desktopRecipeCard = page.locator(".recipe-card").first();
    await desktopRecipeCard.locator("[data-edit-recipe]").first().click();
    const recipeEditorLayout = await page.evaluate(() => {
      const ingredients = document.querySelector("#recipeIngredients").getBoundingClientRect();
      const image = document.querySelector("#recipeImagePreview").getBoundingClientRect();
      const dialog = document.querySelector("#recipeDialog").getBoundingClientRect();
      return {
        ingredientsLeft: ingredients.left,
        ingredientsRight: ingredients.right,
        ingredientsWidth: ingredients.width,
        ingredientsHeight: ingredients.height,
        imageLeft: image.left,
        dialogWidth: dialog.width
      };
    });
    assert.ok(recipeEditorLayout.ingredientsRight < recipeEditorLayout.imageLeft);
    assert.ok(recipeEditorLayout.ingredientsWidth < recipeEditorLayout.dialogWidth * 0.6);
    assert.ok(recipeEditorLayout.ingredientsHeight >= 250);
    await page.locator("#recipeDialog").getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: "Planner", exact: true }).click();
    const desktopPlannerAxis = await page.evaluate(() => {
      const sunday = document.querySelector('[data-planner-mobile-day="Sunday"]');
      const mealGrid = sunday.querySelector(".planner-day-meals");
      return {
        mealColumns: [...mealGrid.children].map((element) => element.dataset.plannerColumn),
        firstDayRow: document.querySelector("[data-planner-row]").dataset.plannerRow,
        daySections: document.querySelectorAll(".planner-day-section").length,
        verticalDayCards: document.querySelectorAll(".planner-corner").length,
        mealGridColumns: getComputedStyle(mealGrid).gridTemplateColumns.split(" ").length,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        gridClientWidth: document.querySelector("#plannerGrid").clientWidth,
        gridScrollWidth: document.querySelector("#plannerGrid").scrollWidth,
        mealLabelStyles: [...mealGrid.querySelectorAll(".planner-meal-label")].map((label) => ({
          backgroundImage: getComputedStyle(label).backgroundImage,
          textAlign: getComputedStyle(label).textAlign,
          alignItems: getComputedStyle(label).alignItems
        }))
      };
    });
    assert.deepEqual(desktopPlannerAxis.mealColumns, [
      "beforeBreakfastDrink",
      "breakfast",
      "morningSnack",
      "lunch",
      "afterLunchDrink",
      "afternoonSnack",
      "dinner",
      "eveningSnack",
      "afterTreatDrink"
    ]);
    assert.equal(desktopPlannerAxis.firstDayRow, "Sunday");
    assert.equal(desktopPlannerAxis.daySections, 7);
    assert.equal(desktopPlannerAxis.verticalDayCards, 0);
    assert.equal(desktopPlannerAxis.mealGridColumns, 3);
    assert.equal(desktopPlannerAxis.documentWidth, desktopPlannerAxis.viewportWidth);
    assert.ok(desktopPlannerAxis.gridScrollWidth <= desktopPlannerAxis.gridClientWidth + 1);
    assert.ok(new Set(desktopPlannerAxis.mealLabelStyles.map((style) => style.backgroundImage)).size >= 6);
    assert.ok(desktopPlannerAxis.mealLabelStyles.every((style) => style.textAlign === "center" && style.alignItems === "center"));
    assert.match(await page.locator('[data-planner-row="Sunday"] .planner-totals').textContent(), /Household total.*Per person/s);
    assert.equal(await page.locator(".planner-day-section.today").count(), 1);
    assert.equal(await page.locator(".planner-day-section.today .planner-today-badge").textContent(), "Today");
    assert.match(
      await page.locator(".planner-day-section.today .planner-cell").first().evaluate((element) => getComputedStyle(element).backgroundImage),
      /linear-gradient/
    );
    assert.ok(await page.locator("#plannerMonthGrid .planner-month-day").count() >= 35);

    const currentPlannerSnapshot = await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      return {
        weekKey: saved.selectedPlannerWeek,
        planner: JSON.stringify(saved.plannerWeeks[saved.selectedPlannerWeek].planner)
      };
    });
    await page.locator("#nextPlannerWeekButton").click();
    assert.equal(await page.locator(".planner-day-section.today").count(), 0);
    const nextWeekKey = await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).selectedPlannerWeek);
    assert.notEqual(nextWeekKey, currentPlannerSnapshot.weekKey);
    await page.locator("#autoFillPlannerButton").click();
    const futurePlannerState = await page.evaluate((currentWeekKey) => {
      const saved = JSON.parse(localStorage.getItem("macrovault.mvp.v1"));
      const plannedIds = Object.values(saved.plannerWeeks[saved.selectedPlannerWeek].planner)
        .flatMap((day) => Object.values(day).flat());
      return {
        plannedCount: plannedIds.length,
        currentPlanner: JSON.stringify(saved.plannerWeeks[currentWeekKey].planner)
      };
    }, currentPlannerSnapshot.weekKey);
    assert.ok(futurePlannerState.plannedCount > 0);
    assert.equal(futurePlannerState.currentPlanner, currentPlannerSnapshot.planner);
    const autoFilledWeek = await page.evaluate(() => JSON.stringify(
      JSON.parse(localStorage.getItem("macrovault.mvp.v1")).planner
    ));
    await page.locator("#autoFillPlannerButton").click();
    assert.equal(
      await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem("macrovault.mvp.v1")).planner)),
      autoFilledWeek
    );
    await page.locator("#currentPlannerWeekButton").click();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).selectedPlannerWeek),
      currentPlannerSnapshot.weekKey
    );
    const displayedMonth = await page.locator("#plannerMonth").inputValue();
    await page.locator("#nextPlannerMonthButton").click();
    assert.notEqual(await page.locator("#plannerMonth").inputValue(), displayedMonth);
    await page.locator("#plannerMonth").fill(nextWeekKey.slice(0, 7));
    await page.locator("#plannerMonth").dispatchEvent("change");
    await page.locator(`[data-select-planner-date="${nextWeekKey}"]`).click();
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).selectedPlannerWeek),
      nextWeekKey
    );
    await page.locator("#currentPlannerWeekButton").click();

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    const wideMealGrid = page.locator('[data-planner-mobile-day="Sunday"] .planner-day-meals');
    assert.equal(await wideMealGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 9);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1600);
    const wideAlignment = await wideMealGrid.evaluate((element) => {
      const spread = (values) => Math.max(...values) - Math.min(...values);
      const columns = [...element.querySelectorAll(":scope > .planner-slot-column")];
      return {
        labelBottomSpread: spread(columns.map((column) => column.querySelector(".planner-meal-label").getBoundingClientRect().bottom)),
        dishHeightSpread: spread(columns.map((column) => column.querySelector(".planner-dish, .planner-empty-dish").getBoundingClientRect().height)),
        selectBottomSpread: spread(columns.map((column) => column.querySelector("select").getBoundingClientRect().bottom))
      };
    });
    assert.ok(wideAlignment.labelBottomSpread <= 1, JSON.stringify(wideAlignment));
    assert.ok(wideAlignment.dishHeightSpread <= 1, JSON.stringify(wideAlignment));
    assert.ok(wideAlignment.selectBottomSpread <= 1, JSON.stringify(wideAlignment));

    await page.setViewportSize({ width: 900, height: 1000 });
    await page.reload({ waitUntil: "networkidle" });
    const tabletNavTopSpread = await page.locator("#navTabs .nav-button").evaluateAll((buttons) => {
      const tops = buttons.map((button) => Math.round(button.getBoundingClientRect().top));
      return Math.max(...tops) - Math.min(...tops);
    });
    assert.ok(tabletNavTopSpread <= 1);
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    assert.equal(await page.locator(".planner-scroll-hint").count(), 0);
    const tabletPlanner = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      gridClientWidth: document.querySelector("#plannerGrid").clientWidth,
      gridScrollWidth: document.querySelector("#plannerGrid").scrollWidth
    }));
    assert.equal(tabletPlanner.documentWidth, tabletPlanner.viewportWidth);
    assert.ok(tabletPlanner.gridScrollWidth <= tabletPlanner.gridClientWidth + 1);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Planner", exact: true }).click();
    assert.equal(await page.locator(".planner-mobile-day").count(), 7);
    assert.equal(await page.locator('.planner-mobile-day[data-planner-mobile-day="Sunday"] .planner-mobile-slot').count(), 9);
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
    const mondayServingInput = page.getByLabel("People eating Lemon Garlic Salmon on Monday", { exact: true });
    assert.equal(await mondayServingInput.inputValue(), "4");
    assert.equal(Math.round(await mondayServingInput.locator("xpath=ancestor::article[1]").locator(".meal-thumb").evaluate((element) => element.getBoundingClientRect().width)), 90);
    const nutritionPerServe = await mondayServingInput.locator("xpath=ancestor::article[1]").locator(".planner-recipe-nutrition").textContent();
    assert.match(nutritionPerServe, /kcal \/ serve/);
    await mondayServingInput.fill("6");
    await mondayServingInput.dispatchEvent("change");
    assert.equal(
      await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).plannerServings.Monday.dinner["lemon-salmon"]),
      6
    );
    assert.equal(
      await page.getByLabel("People eating Lemon Garlic Salmon on Monday", { exact: true }).locator("xpath=ancestor::article[1]").locator(".planner-recipe-nutrition").textContent(),
      nutritionPerServe
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
