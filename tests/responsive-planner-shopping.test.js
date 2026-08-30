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

    await page.setViewportSize({ width: 820, height: 1180 });
    await page.getByRole("button", { name: "Family", exact: true }).click();
    const iPadPortraitFamily = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#kidsLayout .kid-habit-card")];
      const first = cards[0].getBoundingClientRect();
      const second = cards[1].getBoundingClientRect();
      const row = cards[0].querySelector(".habit-row").getBoundingClientRect();
      const checkbox = cards[0].querySelector(".habit-check span").getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        stacked: second.top >= first.bottom,
        rowWidth: row.width,
        cardWidth: first.width,
        checkboxWidth: checkbox.width
      };
    });
    assert.equal(iPadPortraitFamily.documentWidth, iPadPortraitFamily.viewportWidth);
    assert.equal(iPadPortraitFamily.stacked, true);
    assert.ok(iPadPortraitFamily.rowWidth <= iPadPortraitFamily.cardWidth);
    assert.ok(iPadPortraitFamily.checkboxWidth >= 30);

    await page.setViewportSize({ width: 1024, height: 768 });
    const iPadLandscapeFamily = await page.evaluate(() => {
      const cards = [...document.querySelectorAll("#kidsLayout .kid-habit-card")];
      const first = cards[0].getBoundingClientRect();
      const second = cards[1].getBoundingClientRect();
      const row = cards[0].querySelector(".habit-row").getBoundingClientRect();
      const checks = cards[0].querySelector(".habit-checks").getBoundingClientRect();
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        sideBySide: Math.abs(first.top - second.top) < 2,
        checksInsideRow: checks.right <= row.right + 1,
        rowHeight: row.height
      };
    });
    assert.equal(iPadLandscapeFamily.documentWidth, iPadLandscapeFamily.viewportWidth);
    assert.equal(iPadLandscapeFamily.sideBySide, true);
    assert.equal(iPadLandscapeFamily.checksInsideRow, true);
    assert.ok(iPadLandscapeFamily.rowHeight <= 64);

    await page.setViewportSize({ width: 1440, height: 1000 });

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
    const ingredientFieldRows = await page.locator("#recipeIngredientNutrition .recipe-ingredient-row").first().locator(":scope > label").evaluateAll((labels) =>
      labels.map((label) => Math.round(label.getBoundingClientRect().top))
    );
    assert.ok(Math.max(...ingredientFieldRows) - Math.min(...ingredientFieldRows) <= 1, "desktop ingredient fields should fit on one line");
    await page.locator("#recipeDialog").getByRole("button", { name: "Cancel", exact: true }).click();

    await page.getByRole("button", { name: "Planner", exact: true }).click();
    assert.equal(await page.locator(".planner-day-section[open]").count(), 1);
    assert.equal(await page.locator(".planner-day-section.today[open]").count(), 1);
    const desktopPlannerAxis = await page.evaluate(() => {
      const sunday = document.querySelector('[data-planner-mobile-day="Sunday"]');
      const mealGrid = sunday.querySelector(".planner-day-meals");
      return {
        mealColumns: [...mealGrid.children].map((element) => element.dataset.plannerColumn),
        firstDayRow: document.querySelector("[data-planner-row]").dataset.plannerRow,
        daySections: document.querySelectorAll(".planner-day-section").length,
        verticalDayCards: document.querySelectorAll(".planner-corner").length,
        mealGridColumns: new Set([...mealGrid.children].map((element) => Math.round(element.getBoundingClientRect().left))).size,
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
      "breakfast",
      "morningSnack",
      "lunch",
      "afternoonSnack",
      "dinner",
      "eveningSnack"
    ]);
    assert.equal(desktopPlannerAxis.firstDayRow, "Sunday");
    assert.equal(desktopPlannerAxis.daySections, 7);
    assert.equal(desktopPlannerAxis.verticalDayCards, 0);
    assert.equal(desktopPlannerAxis.mealGridColumns, 1);
    assert.equal(desktopPlannerAxis.documentWidth, desktopPlannerAxis.viewportWidth);
    assert.ok(desktopPlannerAxis.gridScrollWidth <= desktopPlannerAxis.gridClientWidth + 1);
    assert.equal(new Set(desktopPlannerAxis.mealLabelStyles.map((style) => style.backgroundImage)).size, 4);
    assert.ok(desktopPlannerAxis.mealLabelStyles.every((style) => style.textAlign === "left" && style.alignItems === "flex-start"));
    assert.match(await page.locator('[data-planner-row="Sunday"] .planner-progress-summary').textContent(), /Daily nutrition.*1 person/s);
    assert.doesNotMatch(await page.locator('[data-planner-row="Sunday"]').textContent(), /Household|People/);
    assert.equal(await page.locator(".planner-day-section.today").count(), 1);
    assert.equal(await page.locator(".planner-day-section.today .planner-today-badge").textContent(), "Today");
    assert.equal(await page.locator(".planner-day-section.today.current-day-feature").count(), 1);
    assert.equal(await page.locator(".planner-day-section.past-day:not([open]):visible").count(), 0);
    assert.equal(
      await page.locator(".planner-day-section.today .planner-cell").first().evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgb(255, 255, 255)"
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
    await page.waitForFunction(() => document.querySelectorAll(".planner-day-section[open]").length === 1);
    assert.equal(await page.locator(".planner-day-section[open]").count(), 1);
    const wideMealGrid = page.locator('.planner-day-section.today .planner-day-meals');
    assert.equal(await wideMealGrid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
    const wideColumnWidths = await wideMealGrid.locator(":scope > .planner-slot-column").evaluateAll((columns) =>
      Object.fromEntries(columns.map((column) => [column.dataset.plannerColumn, column.getBoundingClientRect().width]))
    );
    assert.ok(Math.max(...Object.values(wideColumnWidths)) - Math.min(...Object.values(wideColumnWidths)) <= 1, JSON.stringify(wideColumnWidths));
    const plannerColors = await wideMealGrid.locator(":scope > .planner-slot-column").evaluateAll((columns) =>
      Object.fromEntries(columns.map((column) => [column.dataset.plannerColumn, getComputedStyle(column.querySelector(".planner-meal-label")).backgroundImage]))
    );
    assert.equal(plannerColors.morningSnack, plannerColors.afternoonSnack);
    assert.equal(plannerColors.afternoonSnack, plannerColors.eveningSnack);
    assert.notEqual(plannerColors.breakfast, plannerColors.morningSnack);
    assert.notEqual(plannerColors.lunch, plannerColors.dinner);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 1600);
    const wideAlignment = await wideMealGrid.evaluate((element) => {
      const columns = [...element.querySelectorAll(":scope > .planner-slot-column")];
      return {
        rowTops: columns.map((column) => Math.round(column.getBoundingClientRect().top)),
        rowWidths: columns.map((column) => Math.round(column.getBoundingClientRect().width))
      };
    });
    assert.ok(wideAlignment.rowTops.every((top, index, values) => index === 0 || top > values[index - 1]), JSON.stringify(wideAlignment));
    assert.ok(Math.max(...wideAlignment.rowWidths) - Math.min(...wideAlignment.rowWidths) <= 1, JSON.stringify(wideAlignment));
    assert.ok(Math.max(...await wideMealGrid.locator(".planner-dish, .planner-empty-dish").evaluateAll((cards) => cards.map((card) => card.getBoundingClientRect().height))) <= 250);
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
    assert.equal(await page.locator('.planner-mobile-day[data-planner-mobile-day="Sunday"] .planner-mobile-slot').count(), 6);
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
    await page.locator("#nextPlannerWeekButton").click();
    await page.getByRole("button", { name: "Create smart plan" }).click();
    assert.match(await page.locator("#smartPlannerTarget").textContent(), /2,000 kcal.*130.*protein/);
    await page.locator("#smartPlannerForm button[value=default]").click();
    const smartPlanResult = await page.evaluate(() => {
      const plannedCounts = days.map((day) => mealPlanSlots.reduce((sum, slot) => sum + plannerRecipeIds(day, slot.id).length, 0));
      return {
        minimumMeals: Math.min(...plannedCounts),
        coreSlotsFilled: days.every((day) => ["breakfast", "lunch", "dinner"].every((slot) => plannerRecipeIds(day, slot).length)),
        nutritionDays: days.filter((day) => plannedCaloriesPerPersonForDay(day) > 0 && plannedProteinPerPersonForDay(day) > 0).length,
        dailyNutrition: days.map((day) => [day, plannedCaloriesPerPersonForDay(day), plannedProteinPerPersonForDay(day)])
      };
    });
    assert.ok(smartPlanResult.minimumMeals >= 3);
    assert.equal(smartPlanResult.coreSlotsFilled, true);
    assert.equal(smartPlanResult.nutritionDays, 7);
    assert.ok(smartPlanResult.dailyNutrition.filter(([, calories, protein]) => calories >= 1600 && calories <= 2400 && protein >= 95 && protein <= 170).length >= 5, JSON.stringify(smartPlanResult.dailyNutrition));
    await page.evaluate(() => {
      days.forEach((day) => { state.planner[day] = {}; });
      state.bought = [];
      saveState({ skipBackup: true });
      renderPlanner();
    });
    await page.locator('[data-planner-mobile-day="Monday"] > summary').click();
    await page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="breakfast"] [data-planner-food-day]').click();
    assert.equal(await page.locator("#foodLogDialog h2").textContent(), "Add Food or Recipe");
    await page.locator("#foodLogSearch").fill("Lemon Garlic Salmon");
    await page.locator('[data-food-log-source="recipe:lemon-salmon"]').click();
    await page.locator("#addFoodLogSubmit").click();
    assert.deepEqual(await page.evaluate(() => plannerRecipeIds("Monday", "breakfast")), ["lemon-salmon"]);
    await page.evaluate(() => {
      state.planner.Monday.breakfast = [];
      saveState({ skipBackup: true });
      renderPlanner();
    });
    await page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="lunch"] [data-quick-meal-day]').click();
    await page.locator('#quickMealDialog button[aria-label="Close"]').click();
    assert.equal(await page.locator("#quickMealDialog").evaluate((dialog) => dialog.open), false);
    await page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="lunch"] [data-quick-meal-day]').click();
    const firstQuickMealRowAlignment = await page.locator("[data-quick-meal-row]").first().evaluate((row) => ({
      ingredientTop: Math.round(row.querySelector("select").getBoundingClientRect().top),
      servingsTop: Math.round(row.querySelector("input").getBoundingClientRect().top),
      removeTop: Math.round(row.querySelector("button").getBoundingClientRect().top)
    }));
    assert.ok(Math.max(...Object.values(firstQuickMealRowAlignment)) - Math.min(...Object.values(firstQuickMealRowAlignment)) <= 1, JSON.stringify(firstQuickMealRowAlignment));
    const quickIngredients = await page.evaluate(() => state.ingredients.slice(0, 2).map((ingredient) => ({ id: ingredient.id, name: ingredient.name })));
    await page.locator("[data-quick-meal-ingredient]").nth(0).selectOption(quickIngredients[0].id);
    assert.match(await page.locator("[data-quick-serving-info]").nth(0).textContent(), /1 serving = .*1 servings = .* total/);
    await page.locator("[data-quick-meal-servings]").nth(0).fill("2");
    const doubledServingText = await page.locator("[data-quick-serving-info]").nth(0).textContent();
    assert.match(doubledServingText, /1 serving = .*2 servings = .* total/);
    await page.locator("[data-quick-meal-ingredient]").nth(1).selectOption(quickIngredients[1].id);
    await page.locator("#quickMealName").fill("Steak and lettuce");
    await page.locator("#quickMealForm button[value=default]").click();
    const quickMealResult = await page.evaluate(() => {
      const id = plannerRecipeIds("Monday", "lunch")[0];
      const recipe = recipeById(id);
      return {
        id,
        quickMeal: recipe.quickMeal,
        ingredientCount: recipe.ingredientRefs.length,
        calories: caloriesPerServing(recipe),
        shoppingNames: getShoppingItems().map((item) => item.name)
      };
    });
    assert.equal(quickMealResult.quickMeal, true);
    assert.equal(quickMealResult.ingredientCount, 2);
    assert.ok(quickMealResult.calories >= 0);
    assert.ok(quickIngredients.every((ingredient) => quickMealResult.shoppingNames.some((name) => name.toLowerCase().includes(ingredient.name.toLowerCase()))));
    await page.evaluate((quickMealId) => {
      state.planner.Monday.lunch = [];
      state.recipes = state.recipes.filter((recipe) => recipe.id !== quickMealId);
      state.bought = [];
      saveState({ skipBackup: true });
      renderPlanner();
    }, quickMealResult.id);
    await page.getByLabel("Choose Dinner for Monday", { exact: true }).selectOption("lemon-salmon");
    assert.deepEqual(
      await page.evaluate(() => JSON.parse(localStorage.getItem("macrovault.mvp.v1")).planner.Monday.dinner),
      ["lemon-salmon"]
    );
    const mondayDish = page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="dinner"] .planner-dish');
    assert.equal(Math.round(await mondayDish.locator(".meal-thumb").evaluate((element) => element.getBoundingClientRect().width)), 48);
    const nutritionPerServe = await mondayDish.locator(".planner-recipe-nutrition").textContent();
    assert.match(nutritionPerServe, /kcal.*g protein/);
    assert.doesNotMatch(nutritionPerServe, /\/ serve/);
    assert.ok(await mondayDish.locator(".planner-status-chip").isVisible());
    assert.ok(await mondayDish.locator(".planner-swap-menu").isVisible());
    assert.equal(await mondayDish.locator(".planner-dish-options input").isVisible(), false);
    assert.equal(await page.evaluate(() => plannerServingCount("Monday", "dinner", "lemon-salmon")), 1);
    assert.equal(await mondayDish.locator(".planner-dish-options").count(), 0);
    await mondayDish.locator(".planner-status-chip").click();
    assert.equal(await page.evaluate(() => recipeById("lemon-salmon").prepared), true);
    await page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="dinner"] .planner-add-dish > summary').click();
    assert.ok(await page.locator('[data-planner-mobile-day="Monday"] [data-planner-column="dinner"] .planner-add-dish > select').isVisible());
    assert.match(await page.locator('[data-planner-row="Monday"] .planner-person-progress').textContent(), /\/ 2,000 kcal/);

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
