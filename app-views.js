// MacroVault dashboard, recipe, ingredient, planner, and shopping views.
function getShoppingItems() {
  const plannedRecipes = days
    .flatMap((day) => mealPlanSlots
      .flatMap((slot) => plannerRecipes(day, slot).map((recipe) => ({
        recipe,
        servings: plannerServingCount(day, slot.id, recipe.id)
      }))))
    .filter(Boolean);
  const counts = new Map();

  plannedRecipes.forEach(({ recipe, servings }) => {
    (recipe.ingredients || []).forEach((ingredient, index) => {
      const ref = recipe.ingredientRefs?.[index];
      const linkedIngredient = ref?.ingredientId ? ingredientById(ref.ingredientId) : findIngredientForLine(ingredient);
      if (linkedIngredient?.onHand) return;
      const usedAmount = Number(ref?.usedAmount) || 0;
      const usedUnit = ref?.usedUnit || "";
      const perServeAmount = usedAmount ? usedAmount / recipeServings(recipe) : 0;
      const name = linkedIngredient?.name || cleanIngredientName(ingredient) || ingredient;
      const key = linkedIngredient?.id || ingredientKey(name) || name.toLowerCase();
      const existing = counts.get(key) || {
        name,
        count: 0,
        quantities: [],
        category: categoryForIngredient(linkedIngredient?.name || ingredient)
      };
      existing.count += servings;
      if (perServeAmount) {
        const unit = usedUnit || "each";
        const base = unitBaseFactor(unit);
        const quantity = existing.quantities.find((item) => item.group === base.group);
        if (quantity) {
          quantity.baseAmount += perServeAmount * servings * base.factor;
        } else {
          existing.quantities.push({
            group: base.group,
            baseAmount: perServeAmount * servings * base.factor,
            unit,
            factor: base.factor
          });
        }
      }
      counts.set(key, existing);
    });
  });

  return [...counts.values()].map((item) => ({
    ...item,
    quantities: item.quantities.map((quantity) => ({
      amount: quantity.baseAmount / quantity.factor,
      unit: quantity.unit
    }))
  }));
}

function shoppingItemQuantityLabel(item) {
  const quantities = (item.quantities || [])
    .filter((quantity) => Number(quantity.amount) > 0)
    .map((quantity) => `${formatScaledNumber(quantity.amount)} ${quantity.unit}`);
  if (quantities.length) return quantities.join(" + ");
  return item.count > 1 ? `x${item.count}` : "";
}

function groupShoppingItems(items) {
  return items.reduce((groups, item) => {
    groups[item.category] ||= [];
    groups[item.category].push(item);
    return groups;
  }, {});
}

function renderDashboard() {
  const today = days[new Date().getDay()];
  const dashboardMeals = [
    { id: "breakfast", label: "Breakfast", size: "main" },
    { id: "lunch", label: "Lunch", size: "main" },
    { id: "dinner", label: "Dinner", size: "main" },
    { id: "morningSnack", label: "Morning Snack", size: "small" },
    { id: "afternoonSnack", label: "Afternoon Snack", size: "small" },
    { id: "eveningSnack", label: "After Dinner Treat", size: "small" }
  ];
  document.querySelector("#todayMeals").innerHTML = dashboardMeals.map((meal) => {
    const slot = mealPlanSlots.find((item) => item.id === meal.id) || meal;
    const recipes = plannerRecipes(today, slot);
    const recipe = recipes[0];
    const imageUrl = resolveImageUrl(recipe?.imageUrl);
    const mealName = recipes.map((item) => item.name).join(" + ");
    const mealCalories = recipes.reduce((sum, item) => sum + caloriesPerServing(item) * plannerServingCount(today, slot.id, item.id), 0);
    const mealProtein = recipes.reduce((sum, item) => sum + macrosPerServing(item).protein * plannerServingCount(today, slot.id, item.id), 0);
    return `
      <article class="dashboard-meal-card ${meal.size === "small" ? "small" : "main"} ${imageUrl ? "has-image" : ""}">
        <button class="dashboard-meal-image" ${recipe ? `data-edit-recipe="${escapeHtml(recipe.id)}"` : `data-tab="planner"`} type="button" aria-label="${recipe ? `Open ${escapeHtml(recipe.name)}` : `Choose ${meal.label.toLowerCase()}`}">
          ${recipe
            ? `${recipeFallbackArtMarkup(recipe)}${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name)}" data-hide-on-error>` : ""}`
            : `<span>${meal.label.slice(0, 1)}</span>`}
        </button>
        <div class="dashboard-meal-copy">
          <span>${meal.label}</span>
          <strong>${recipes.length ? escapeHtml(mealName) : `Choose ${meal.label.toLowerCase()}`}</strong>
          <p>${recipes.length ? `${roundNutrition(mealCalories)} kcal / ${roundNutrition(mealProtein)}g protein${recipes.length > 1 ? ` · ${recipes.length} dishes` : ""}` : `Plan ${meal.label.toLowerCase()} for ${today}.`}</p>
        </div>
      </article>
    `;
  }).join("");

  const plannedCount = days.filter((day) => mealPlanSlots.some((slot) => plannerRecipeIds(day, slot.id).length)).length;
  const shoppingCount = getShoppingItems().length;
  const shoppingCounter = document.querySelector("#shoppingCount");
  if (shoppingCounter) shoppingCounter.textContent = shoppingCount;

  document.querySelector("#metricRow").innerHTML = [
    ["Recipes", `${(state.recipes || []).length} saved`, "R", "recipes"],
    ["Ingredients", `${(state.ingredients || []).length} foods`, "I", "ingredients"],
    ["Meal Planner", `${plannedCount}/7 planned`, "P", "planner"],
    ["Shopping", `${shoppingCount} items`, "S", "shopping"]
  ].map(([label, value, icon, tab]) => `
    <button class="metric-card" data-tab="${tab}" type="button">
      <span class="metric-icon">${icon}</span>
      <span><strong>${label}</strong><span class="muted">${value}</span></span>
    </button>
  `).join("");

  document.querySelector("#kidSummary").innerHTML = Object.entries(state.kids || {}).map(([name, kid]) => {
    const habits = familyHabitTargetsForPerson(name);
    const completed = habits.reduce((sum, habit) => sum + (kid.habits?.[habit.id] || []).filter(Boolean).length, 0);
    const target = habits.reduce((sum, habit) => sum + habit.target, 0);
    const percent = target ? Math.round((completed / target) * 100) : 0;
    const clampedPercent = Math.min(100, Math.max(0, percent));
    const needleAngle = -76 + (clampedPercent * 1.52);
    return `
      <article class="kid-card ${safeCssToken(kid.color)}" style="--progress-width: ${Math.min(100, Math.max(0, percent))}%">
        <h3>${escapeHtml(name)}</h3>
        <div class="star-line">${[1, 2, 3, 4, 5].map((score) => `<span class="star ${score <= kid.stars ? "filled" : ""}"></span>`).join("")}</div>
        <div class="rev-gauge" aria-label="${completed} of ${target} healthy ticks today">
          <svg viewBox="0 0 140 86" role="img" aria-hidden="true">
            <path class="rev-arc-bg" pathLength="100" d="M18 68 A52 52 0 0 1 122 68"></path>
            <path class="rev-arc-fill" pathLength="100" stroke-dasharray="${clampedPercent} 100" d="M18 68 A52 52 0 0 1 122 68"></path>
            ${[-70, -42, -14, 14, 42, 70].map((angle) => `<line class="rev-tick" x1="70" y1="17" x2="70" y2="25" transform="rotate(${angle} 70 68)"></line>`).join("")}
            <line class="rev-needle" x1="70" y1="68" x2="70" y2="26" transform="rotate(${needleAngle} 70 68)"></line>
            <circle class="rev-hub" cx="70" cy="68" r="7"></circle>
          </svg>
          <div class="rev-gauge-count">
            <strong>${completed} / ${target}</strong>
            <span>ticks</span>
          </div>
        </div>
        <p class="muted">${escapeHtml(kid.goal)}</p>
      </article>
    `;
  }).join("");
}

function recipeCard(recipe) {
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  const totals = recipeNutritionTotals(recipe);
  const perServe = recipeNutritionPerServing(recipe);
  const artType = recipeArtType(recipe);
  const imageUrl = resolveImageUrl(recipe.imageUrl);
  const sourceUrl = safeHttpUrl(recipe.sourceUrl);
  return `
    <article class="recipe-card">
      <div class="recipe-art recipe-art-${artType} ${imageUrl ? "has-image" : "has-fallback-art"}" data-edit-recipe="${escapeHtml(recipe.id)}" role="button" tabindex="0" aria-label="Open ${escapeHtml(recipe.name)}">
        ${recipeImageMarkup(recipe)}
        <button class="image-edit-button" data-edit-recipe="${escapeHtml(recipe.id)}" type="button">Edit</button>
      </div>
      <div class="recipe-body">
        <div class="recipe-title-row">
          <h3>${escapeHtml(recipe.name)}</h3>
          <button class="favorite-button ${recipe.favourite ? "active" : ""}" data-favorite-recipe="${escapeHtml(recipe.id)}" aria-label="${recipe.favourite ? "Remove from favourites" : "Add to favourites"}" title="${recipe.favourite ? "Remove from favourites" : "Add to favourites"}" type="button">${iconMarkup("heart")}</button>
        </div>
        <p class="muted">${escapeHtml(recipe.method)}</p>
        ${sourceUrl ? `<a class="source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">Open source</a>` : ""}
        <label class="recipe-prepared-toggle">
          <input type="checkbox" ${recipe.prepared ? "checked" : ""} data-recipe-prepared="${escapeHtml(recipe.id)}">
          <span>${recipe.prepared ? "In freezer / prepared" : "Not prepared"}</span>
        </label>
        <div class="tag-row">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <div class="recipe-nutrition-card">
          <div class="recipe-nutrition-primary">
            <span><strong>${perServe.calories}</strong> kcal / serve</span>
            <span><strong>${perServe.protein}g</strong> protein</span>
          </div>
          <div class="recipe-nutrition-secondary">
            <span>Serves ${recipeServings(recipe)}</span>
            <span>${perServe.sugar}g sugar</span>
            <span>${perServe.fibre}g fibre</span>
          </div>
          <div class="recipe-nutrition-total" title="${totals.calories} kcal, ${totals.protein}g protein, ${totals.sugar}g sugar, ${totals.fibre}g fibre, ${totals.sodium}mg sodium total">
            Total: ${totals.calories} kcal · ${totals.protein}g protein · ${totals.sugar}g sugar · ${totals.fibre}g fibre · ${totals.sodium}mg sodium
          </div>
        </div>
        <div class="card-actions">
          <button class="secondary-button" data-edit-recipe="${escapeHtml(recipe.id)}" type="button">Edit</button>
          <button class="secondary-button" data-duplicate-recipe="${escapeHtml(recipe.id)}" type="button" aria-label="Duplicate ${escapeHtml(recipe.name)}">Duplicate</button>
          <button class="text-button danger-button" data-delete-recipe="${escapeHtml(recipe.id)}" type="button">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function renderRecipes() {
  const search = document.querySelector("#recipeSearch").value.trim().toLowerCase();
  const tagFilter = document.querySelector("#tagFilter");
  const tags = ["all", ...new Set(state.recipes.flatMap((recipe) => Array.isArray(recipe.tags) ? recipe.tags : []))].sort();
  const selectedTag = tags.includes(tagFilter.value) ? tagFilter.value : "all";
  tagFilter.innerHTML = tags.map((tag) => `<option value="${tag}">${tag === "all" ? "All tags" : tag}</option>`).join("");
  tagFilter.value = selectedTag;

  const recipes = state.recipes.filter((recipe) => {
    const recipeTags = Array.isArray(recipe.tags) ? recipe.tags : [];
    const recipeIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const originalIngredients = Array.isArray(recipe.originalIngredients) ? recipe.originalIngredients : [];
    const categoryLabel = recipeCategories
      .filter((category) => recipeBelongsToCategory(recipe, category.id))
      .map((category) => category.label)
      .join(" ");
    const haystack = [recipe.name, categoryLabel, ...recipeTags, ...recipeIngredients, ...originalIngredients].join(" ").toLowerCase();
    const matchesSearch = !search || haystack.includes(search);
    const matchesTag = selectedTag === "all" || recipeTags.includes(selectedTag);
    return matchesSearch && matchesTag;
  });

  if (!recipes.length) {
    document.querySelector("#recipeGrid").innerHTML = `
      <section class="section-block">
        <h2>No recipes match</h2>
        <p class="muted">Try clearing the search and tag filter. If the recipe still does not appear, it was not saved in this browser.</p>
        <button class="secondary-button" id="clearRecipeFiltersButton" type="button">Clear recipe filters</button>
      </section>
    `;
    return;
  }

  if (selectedTag !== "all") {
    document.querySelector("#recipeGrid").innerHTML = recipes.map(recipeCard).join("");
    return;
  }

  document.querySelector("#recipeGrid").innerHTML = recipeCategories.map((category) => {
    const categoryRecipes = recipes.filter((recipe) => recipeBelongsToCategory(recipe, category.id));
    return `
      <section class="recipe-section">
        <div class="section-heading">
          <h2>${category.label}</h2>
          <span class="muted">${categoryRecipes.length} saved</span>
        </div>
        ${categoryRecipes.length
          ? `<div class="recipe-grid-inner">${categoryRecipes.map(recipeCard).join("")}</div>`
          : `<p class="recipe-empty">No ${category.label.toLowerCase()} recipes yet.</p>`}
      </section>
    `;
  }).join("");
}

function renderIngredients() {
  const search = document.querySelector("#ingredientSearch").value.trim().toLowerCase();
  const ingredients = state.ingredients.filter((ingredient) => {
    const haystack = [ingredient.name, ingredient.plural, ingredient.description, ingredient.label, ingredient.barcode].join(" ").toLowerCase();
    return !search || haystack.includes(search);
  });
  const categoryOrder = ["Produce", "Dairy", "Protein", "Staples", "Spread", "Snack", "Treat", "Other"];
  const groupedIngredients = ingredients.reduce((groups, ingredient) => {
    const category = ingredient.label || categoryForIngredient(ingredient.name) || "Other";
    groups[category] ||= [];
    groups[category].push(ingredient);
    return groups;
  }, {});
  const categories = Object.keys(groupedIngredients).sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a);
    const bIndex = categoryOrder.indexOf(b);
    if (aIndex !== -1 || bIndex !== -1) {
      return (aIndex === -1 ? categoryOrder.length : aIndex) - (bIndex === -1 ? categoryOrder.length : bIndex);
    }
    return a.localeCompare(b);
  });

  document.querySelector("#ingredientTable").innerHTML = `
    ${categories.map((category) => {
      const categoryIngredients = groupedIngredients[category].sort((a, b) => a.name.localeCompare(b.name));
      return `
        <div class="ingredient-category-row">
          <strong>${escapeHtml(category)}</strong>
          <span>${categoryIngredients.length} item${categoryIngredients.length === 1 ? "" : "s"}</span>
        </div>
        <div class="ingredient-row ingredient-row-heading">
          <span>Name</span>
          <span>Label</span>
          <span>Nutrition</span>
          <span>On hand</span>
          <span></span>
        </div>
        ${categoryIngredients.map((ingredient) => `
          <article class="ingredient-row">
            <div class="ingredient-name-cell">
              ${ingredientImageMarkup(ingredient)}
              <div>
                <strong>${escapeHtml(ingredient.name)}</strong>
                <span class="muted">${escapeHtml(ingredient.plural || ingredient.description || "Ingredient")}</span>
                ${ingredient.barcode ? `<span class="muted">Barcode ${escapeHtml(ingredient.barcode)}</span>` : ""}
                ${ingredientUsageMarkup(ingredient.id)}
              </div>
            </div>
            <span class="tag">${escapeHtml(ingredient.label || "Other")}</span>
            <div class="ingredient-nutrition">
              <span>per ${ingredient.serving.amount}${ingredient.serving.unit}</span>
              <span>${ingredient.nutrition.calories} kcal</span>
              <span>${ingredient.nutrition.protein}g P</span>
              <span>${ingredient.nutrition.carbs}g C</span>
              <span>${ingredient.nutrition.sugar}g sugar</span>
              <span>${ingredient.nutrition.fibre}g fibre</span>
              <span>${ingredient.nutrition.fat}g F</span>
              <span>${ingredient.nutrition.sodium || 0}mg sodium</span>
            </div>
            <label class="ingredient-onhand">
              <input type="checkbox" ${ingredient.onHand ? "checked" : ""} data-ingredient-onhand="${escapeHtml(ingredient.id)}">
              <span>${ingredient.onHand ? "Yes" : "No"}</span>
            </label>
            <div class="ingredient-actions">
              <button class="secondary-button" data-edit-ingredient="${escapeHtml(ingredient.id)}" type="button">Edit</button>
              <button class="text-button danger-button" data-delete-ingredient="${escapeHtml(ingredient.id)}" type="button">Delete</button>
            </div>
          </article>
        `).join("")}
      `;
    }).join("") || `<p class="muted ingredient-empty">No ingredients match that search.</p>`}
  `;
}

function openIngredientDialog(ingredient = null) {
  document.querySelector("#ingredientDialogTitle").textContent = ingredient ? "Edit ingredient" : "Add ingredient";
  resetNutritionLabelScan();
  document.querySelector("#ingredientId").value = ingredient?.id || "";
  document.querySelector("#ingredientName").value = ingredient?.name || "";
  document.querySelector("#ingredientPlural").value = ingredient?.plural || "";
  document.querySelector("#ingredientDescription").value = ingredient?.description || "";
  document.querySelector("#ingredientBarcode").value = ingredient?.barcode || "";
  document.querySelector("#ingredientImageUrl").value = isEmbeddedImage(ingredient?.imageUrl) || isImageAssetRef(ingredient?.imageUrl) ? "" : ingredient?.imageUrl || "";
  document.querySelector("#ingredientImageData").value = isEmbeddedImage(ingredient?.imageUrl) || isImageAssetRef(ingredient?.imageUrl) ? ingredient.imageUrl : "";
  document.querySelector("#ingredientImageFile").value = "";
  updateIngredientImagePreview(ingredient?.imageUrl || "");
  document.querySelector("#ingredientLabel").value = ingredient?.label || "";
  document.querySelector("#ingredientServingAmount").value = ingredient?.serving?.amount ?? 1;
  document.querySelector("#ingredientServingUnit").value = ingredient?.serving?.unit || "each";
  document.querySelector("#ingredientCalories").value = ingredient?.nutrition?.calories ?? 0;
  document.querySelector("#ingredientProtein").value = ingredient?.nutrition?.protein ?? 0;
  document.querySelector("#ingredientCarbs").value = ingredient?.nutrition?.carbs ?? 0;
  document.querySelector("#ingredientSugar").value = ingredient?.nutrition?.sugar ?? 0;
  document.querySelector("#ingredientFibre").value = ingredient?.nutrition?.fibre ?? 0;
  document.querySelector("#ingredientFat").value = ingredient?.nutrition?.fat ?? 0;
  document.querySelector("#ingredientSodium").value = ingredient?.nutrition?.sodium ?? 0;
  document.querySelector("#ingredientOnHand").checked = Boolean(ingredient?.onHand);
  ingredientDialog.showModal();
}

function syncIngredientsFromRecipes() {
  syncIngredientsAndRecipeLinks(state, { applyGenericNutrition: true, refreshRecipeNutrition: true });
  saveState();
  render();
}

function updateIngredientsWithGenericNutrition() {
  const changed = applyGenericNutritionToIngredients(state, { force: true, refreshRecipeNutrition: true });
  saveState();
  render();
  showToast(`Updated generic nutrition for ${changed} ingredient${changed === 1 ? "" : "s"}.`, { type: "success" });
}

function plannerCellMarkup(day, slot) {
  const selectedIds = plannerRecipeIds(day, slot.id);
  const selectedRecipes = plannerRecipes(day, slot);
  const options = recipesForSlot(slot)
    .filter((recipe) => !selectedIds.includes(recipe.id))
    .map((recipe) => `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)} (${caloriesPerServing(recipe)} kcal / ${macrosPerServing(recipe).protein}g protein)</option>`)
    .join("");
  const controlId = `planner-${slugify(day)}-${slot.id}`;
  return `
    <div class="planner-cell">
      <div class="planner-dish-list">
        ${selectedRecipes.length ? selectedRecipes.map((recipe) => {
          const servings = plannerServingCount(day, slot.id, recipe.id);
          const scaledCalories = caloriesPerServing(recipe) * servings;
          const scaledProtein = macrosPerServing(recipe).protein * servings;
          return `
          <article class="planner-dish">
            ${mealThumbnailMarkup(recipe, slot.label)}
            <div class="planner-meal-pick">
              <strong>${escapeHtml(recipe.name)}</strong>
              <span class="planner-recipe-nutrition">${escapeHtml(`${formatPlannerNumber(scaledCalories, "kcal")} / ${formatPlannerNumber(scaledProtein, "protein")}`)}</span>
              <label class="planner-serving-control">
                <span>People eating</span>
                <span class="planner-serving-stepper">
                  <button data-planner-serving-step="-1" data-planner-day="${day}" data-planner-slot="${slot.id}" data-planner-recipe="${escapeHtml(recipe.id)}" type="button" aria-label="One fewer person eating ${escapeHtml(recipe.name)}">&minus;</button>
                  <input type="number" min="1" max="99" step="1" value="${servings}" data-planner-serving-count data-planner-day="${day}" data-planner-slot="${slot.id}" data-planner-recipe="${escapeHtml(recipe.id)}" aria-label="People eating ${escapeHtml(recipe.name)} on ${day}">
                  <button data-planner-serving-step="1" data-planner-day="${day}" data-planner-slot="${slot.id}" data-planner-recipe="${escapeHtml(recipe.id)}" type="button" aria-label="One more person eating ${escapeHtml(recipe.name)}">&plus;</button>
                </span>
              </label>
              <label class="recipe-prepared-toggle planner-prepared-toggle">
                <input type="checkbox" ${recipe.prepared ? "checked" : ""} data-recipe-prepared="${escapeHtml(recipe.id)}">
                <span>${recipe.prepared ? "In freezer / prepared" : "Not prepared"}</span>
              </label>
            </div>
            <button class="planner-remove-dish" data-remove-planner-recipe="${escapeHtml(recipe.id)}" data-planner-day="${day}" data-planner-slot="${slot.id}" type="button" aria-label="Remove ${escapeHtml(recipe.name)} from ${day} ${slot.label}" title="Remove dish">&times;</button>
          </article>
        `;
        }).join("") : `
          <div class="planner-empty-dish">
            ${mealThumbnailMarkup(null, slot.label)}
            <strong>Choose ${slot.label.toLowerCase()}</strong>
          </div>
        `}
      </div>
      <select id="${controlId}" aria-label="Add another dish to ${day} ${slot.label}" data-planner-add-day="${day}" data-planner-add-slot="${slot.id}" ${options ? "" : "disabled"}>
        <option value="">${selectedRecipes.length ? "Add another dish" : `Choose ${slot.label.toLowerCase()}`}</option>
        ${options}
      </select>
    </div>
  `;
}

function renderPlanner() {
  const goals = currentNutritionGoals();
  const calorieGoalInput = document.querySelector("#dailyCalorieGoal");
  const proteinGoalInput = document.querySelector("#dailyProteinGoal");
  if (calorieGoalInput && document.activeElement !== calorieGoalInput) calorieGoalInput.value = goals.calories;
  if (proteinGoalInput && document.activeElement !== proteinGoalInput) proteinGoalInput.value = goals.protein;

  const mobilePlanner = window.matchMedia("(max-width: 760px)").matches;
  const today = days[new Date().getDay()];
  document.querySelector("#plannerGrid").innerHTML = `
    <div class="planner-week planner-mobile">
      ${days.map((day) => {
        const remaining = nutritionGoalRemainingForDay(day);
        const expanded = !mobilePlanner || day === today;
        return `
          <details class="planner-day-section planner-mobile-day ${day === today ? "today" : ""}" data-planner-mobile-day="${day}" ${expanded ? "open" : ""}>
            <summary>
              <div class="planner-day-heading" data-planner-row="${day}">
                <h3>${day}</h3>
                <div class="planner-totals">
                  <strong>${formatPlannerNumber(plannedCaloriesForDay(day), "kcal")}</strong>
                  <strong>${formatPlannerNumber(plannedProteinForDay(day), "protein")}</strong>
                </div>
                <div class="planner-remaining ${remaining.met ? "met" : ""}">
                  ${remaining.met
                    ? "Daily goal met"
                    : `Still need ${formatPlannerNumber(remaining.calories, "kcal")} / ${formatPlannerNumber(remaining.protein, "protein")}`}
                </div>
              </div>
            </summary>
            <div class="planner-day-meals planner-mobile-slots">
              ${mealPlanSlots.map((slot) => `
                <section class="planner-slot-column planner-mobile-slot" data-planner-column="${slot.id}">
                  <div class="planner-meal-label">
                    <span>${slot.label}</span>
                    ${slot.timing ? `<small>${slot.timing}</small>` : ""}
                  </div>
                  ${plannerCellMarkup(day, slot)}
                </section>
              `).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </div>
  `;
}

function renderShopping() {
  const list = getShoppingItems();
  const grouped = groupShoppingItems(list);
  const orderedCategories = ["Produce", "Protein", "Dairy", "Staples", "Other"];
  document.querySelector("#shoppingList").innerHTML = orderedCategories
    .filter((category) => grouped[category]?.length)
    .map((category) => `
      <section class="shopping-group">
        <h3>${category}</h3>
        ${grouped[category].map((item) => {
          const checked = state.bought.includes(item.name);
          const quantityLabel = shoppingItemQuantityLabel(item);
          return `
            <label class="check-row">
              <input type="checkbox" data-bought="${escapeHtml(item.name)}" ${checked ? "checked" : ""}>
              <span>${escapeHtml(item.name)}${quantityLabel ? ` - ${escapeHtml(quantityLabel)}` : ""}</span>
            </label>
          `;
        }).join("")}
      </section>
    `).join("") || `<p class="muted">No shopping items yet. Add meals to the planner first.</p>`;
}
