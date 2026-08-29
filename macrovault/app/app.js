// MacroVault rendering orchestration, event wiring, and application startup.
let quickMealContext = null;
let foodPickerPlannerContext = null;

function setTrackedWater(total) {
  const date = selectedTrackerDate();
  const person = selectedTrackerPerson();
  const values = waterTrackingValues(date, person);
  const normalized = Math.min(20000, Math.max(0, roundNutrition(total)));
  state.waterTracking ||= { entries: {}, goals: {}, glassSizes: {} };
  state.waterTracking.entries ||= {};
  state.waterTracking.entries[date] ||= {};
  state.waterTracking.entries[date][person] = normalized;
  const waterHabit = dailyFoodGroupTemplate.find((item) => item.id === "water");
  if (waterHabit) setDailyNutritionCount(date, person, "water", Math.floor((normalized / values.goal) * waterHabit.target));
  saveState();
  renderTracker();
}

function quickMealIngredientRow(index, ingredientId = "") {
  const options = [...state.ingredients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((ingredient) => {
      const amount = formatScaledNumber(Number(ingredient.serving?.amount) || 1);
      const unit = ingredient.serving?.unit || "each";
      return `<option value="${escapeHtml(ingredient.id)}" ${ingredient.id === ingredientId ? "selected" : ""}>${escapeHtml(`${ingredient.name} — ${amount} ${unit}`)}</option>`;
    })
    .join("");
  return `<div class="quick-meal-row" data-quick-meal-row>
    <label>Ingredient<select data-quick-meal-ingredient required><option value="">Choose ingredient</option>${options}</select><small data-quick-serving-info>Select an ingredient to see its serving size.</small></label>
    <label>Servings<input data-quick-meal-servings type="number" min="0.25" max="20" step="0.25" value="1" required></label>
    <button class="icon-button" type="button" data-remove-quick-meal-row aria-label="Remove ingredient">&times;</button>
  </div>`;
}

function updateQuickMealServingInfo(row) {
  const ingredient = ingredientById(row.querySelector("[data-quick-meal-ingredient]").value);
  const info = row.querySelector("[data-quick-serving-info]");
  if (!ingredient) {
    info.textContent = "Select an ingredient to see its serving size.";
    return;
  }
  const servings = Math.min(20, Math.max(0.25, Number(row.querySelector("[data-quick-meal-servings]").value) || 1));
  const servingAmount = Number(ingredient.serving?.amount) || 1;
  const unit = ingredient.serving?.unit || "each";
  info.textContent = `Serving size: ${formatScaledNumber(servingAmount)} ${unit} · Total: ${formatScaledNumber(servingAmount * servings)} ${unit}`;
}

function addQuickMealRow(ingredientId = "") {
  const rows = document.querySelector("#quickMealRows");
  rows.insertAdjacentHTML("beforeend", quickMealIngredientRow(rows.children.length, ingredientId));
}

function openQuickMealDialog(day, slotId) {
  quickMealContext = { day, slotId };
  document.querySelector("#quickMealName").value = "";
  document.querySelector("#quickMealRows").innerHTML = "";
  addQuickMealRow();
  addQuickMealRow();
  document.querySelector("#quickMealDialog").showModal();
}

function renderActiveView() {
  const renderers = {
    dashboard: renderDashboard,
    recipes: renderRecipes,
    ingredients: renderIngredients,
    planner: renderPlanner,
    tracker: renderTracker,
    prepared: renderPrepared,
    shopping: renderShopping,
    kids: renderKids,
    familyGoals: renderFamilyGoals,
    private: renderPrivate,
    site: renderSite,
    settings: renderSettings
  };
  renderers[state.activeTab]?.();
}

function render() {
  if (ensureFamilyHabitsForToday(state)) saveState();
  applyConfigurationToLayout();
  renderNav();
  renderLayout();
  renderActiveView();
  renderRestoreStatus();
  renderGenericNutritionStatus();
}

function renderRestoreStatus() {
  const key = `${STORAGE_KEY}.restoreStatus`;
  const raw = sessionStorage.getItem(key);
  if (!raw || document.querySelector("#restoreStatusBanner")) return;
  let status = null;
  try {
    status = JSON.parse(raw);
  } catch {
    status = { ok: false, message: "Could not read restore status." };
  }
  const banner = document.createElement("div");
  banner.id = "restoreStatusBanner";
  banner.className = `restore-status-banner ${status.ok ? "success" : "error"}`;
  banner.textContent = status.ok
    ? `Backup restored. Previous state kept as ${status.preRestoreKey || "pre-restore backup"}.`
    : status.message || "Backup restore did not run.";
  document.body.append(banner);
  setTimeout(() => banner.remove(), 12000);
  sessionStorage.removeItem(key);
}

function renderGenericNutritionStatus() {
  const key = `${STORAGE_KEY}.genericNutritionStatus`;
  const raw = sessionStorage.getItem(key);
  if (!raw || document.querySelector("#genericNutritionStatusBanner")) return;
  let status = null;
  try {
    status = JSON.parse(raw);
  } catch {
    status = { ok: false, changed: 0 };
  }
  const banner = document.createElement("div");
  banner.id = "genericNutritionStatusBanner";
  banner.className = `restore-status-banner ${status.ok ? "success" : "error"}`;
  banner.textContent = status.ok
    ? `Generic nutrition updated for ${status.changed} ingredient${status.changed === 1 ? "" : "s"}.`
    : "Generic nutrition update could not be saved.";
  document.body.append(banner);
  setTimeout(() => banner.remove(), 12000);
  sessionStorage.removeItem(key);
}

function advanceHabitRow(name, habitId) {
  const member = state.kids?.[name];
  const habit = familyHabitTargetsForPerson(name).find((item) => item.id === habitId);
  if (!member || !habit) return;
  member.habits ||= {};
  const ticks = Array.from({ length: habit.target }, (_, index) => Boolean(member.habits[habitId]?.[index]));
  const nextUnchecked = ticks.findIndex((checked) => !checked);
  if (nextUnchecked === -1) ticks.fill(false);
  else ticks[nextUnchecked] = true;
  member.habits[habitId] = ticks;
  recordFamilyHabitDay(state, todayDateKey(), { force: true });
  saveState();
  render();
}

let draggedFamilyGoal = null;

document.addEventListener("dragstart", (event) => {
  const handle = event.target.closest("[data-family-goal-drag]");
  if (!handle) return;
  const item = handle.closest("[data-family-goal-id]");
  const horizon = handle.closest("[data-goal-horizon]")?.dataset.goalHorizon;
  if (!item || !state.familyGoals?.[horizon]) return;
  draggedFamilyGoal = { id: handle.dataset.familyGoalDrag, horizon };
  item.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", handle.dataset.familyGoalDrag);
});

document.addEventListener("dragover", (event) => {
  const item = event.target.closest("[data-family-goal-id]");
  const horizon = item?.closest("[data-goal-horizon]")?.dataset.goalHorizon;
  if (!item || !draggedFamilyGoal || horizon !== draggedFamilyGoal.horizon || item.dataset.familyGoalId === draggedFamilyGoal.id) return;
  event.preventDefault();
  document.querySelectorAll(".family-goal-item.drag-over").forEach((goal) => goal.classList.remove("drag-over"));
  item.classList.add("drag-over");
  event.dataTransfer.dropEffect = "move";
});

document.addEventListener("drop", (event) => {
  const target = event.target.closest("[data-family-goal-id]");
  const horizon = target?.closest("[data-goal-horizon]")?.dataset.goalHorizon;
  if (!target || !draggedFamilyGoal || horizon !== draggedFamilyGoal.horizon) return;
  event.preventDefault();
  const goals = state.familyGoals[horizon];
  const fromIndex = goals.findIndex((goal) => goal.id === draggedFamilyGoal.id);
  const targetIndex = goals.findIndex((goal) => goal.id === target.dataset.familyGoalId);
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return;
  const [movedGoal] = goals.splice(fromIndex, 1);
  const targetAfterRemoval = goals.findIndex((goal) => goal.id === target.dataset.familyGoalId);
  const placeAfter = event.clientY > target.getBoundingClientRect().top + target.getBoundingClientRect().height / 2;
  goals.splice(targetAfterRemoval + (placeAfter ? 1 : 0), 0, movedGoal);
  saveState();
  renderFamilyGoals();
  draggedFamilyGoal = null;
});

document.addEventListener("dragend", () => {
  draggedFamilyGoal = null;
  document.querySelectorAll(".family-goal-item.dragging, .family-goal-item.drag-over").forEach((goal) => goal.classList.remove("dragging", "drag-over"));
});

document.querySelector("#trackerDate").addEventListener("change", renderTracker);
document.querySelector("#trackerPerson").addEventListener("change", renderTracker);
document.querySelector("#trackerCalorieGoal").addEventListener("change", (event) => {
  state.nutritionGoals ||= { ...defaultDailyNutritionGoals };
  state.nutritionGoals.calories = Math.max(1, Number(event.target.value) || defaultDailyNutritionGoals.calories);
  saveState();
  renderTracker();
});
document.querySelector("#trackerProteinGoal").addEventListener("change", (event) => {
  state.nutritionGoals ||= { ...defaultDailyNutritionGoals };
  state.nutritionGoals.protein = Math.max(1, Number(event.target.value) || defaultDailyNutritionGoals.protein);
  saveState();
  renderTracker();
});
document.querySelector("#foodLogSource").addEventListener("change", applyFoodLogSource);
document.querySelector("#foodLogSearch").addEventListener("input", renderFoodLogBrowser);
document.querySelector("#foodLogTabs").addEventListener("click", (event) => {
  const button = event.target.closest("[data-food-log-filter]");
  if (!button) return;
  document.querySelectorAll("#foodLogTabs [data-food-log-filter]").forEach((item) => item.classList.toggle("active", item === button));
  renderFoodLogBrowser();
});
document.querySelector("#foodLogResults").addEventListener("click", (event) => {
  const result = event.target.closest("[data-food-log-source]");
  if (!result) return;
  document.querySelector("#foodLogSource").value = result.dataset.foodLogSource;
  applyFoodLogSource();
});
document.querySelector("#foodLogForm").addEventListener("click", (event) => {
  const preset = event.target.closest("[data-food-log-serving]");
  if (!preset) return;
  document.querySelector("#foodLogServings").value = formatFoodLogNumber(preset.dataset.foodLogServing);
  document.querySelector("#foodLogGrams").value = "";
  updateFoodLogNutritionPreview();
});
document.querySelector("#foodLogGrams").addEventListener("input", updateFoodLogServingsFromGrams);
document.querySelector("#foodLogGramsPerServing").addEventListener("input", updateFoodLogServingsFromGrams);
document.querySelectorAll("#foodLogForm input[type=number]").forEach((input) => {
  input.addEventListener("input", updateFoodLogNutritionPreview);
  input.addEventListener("change", () => {
    if (input.value !== "") input.value = formatFoodLogNumber(input.value);
    updateFoodLogNutritionPreview();
  });
});
document.querySelector("#foodLogForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  validateFoodLogGrams();
  if (!event.currentTarget.reportValidity()) return;
  if (foodPickerPlannerContext) {
    const context = foodPickerPlannerContext;
    const selectedValue = document.querySelector("#foodLogSource").value;
    const selectedServings = Math.min(20, Math.max(0.01, Number(document.querySelector("#foodLogServings").value) || 1));
    let recipeId = selectedValue.startsWith("recipe:") ? selectedValue.slice(7) : "";
    const sourceRecipe = recipeId ? recipeById(recipeId) : null;
    if (sourceRecipe && Math.abs(selectedServings - 1) > 0.001) {
      const factor = selectedServings / recipeServings(sourceRecipe);
      const macros = macrosPerServing(sourceRecipe);
      const portionRecipe = {
        ...structuredClone(sourceRecipe),
        id: `planner-portion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: `${sourceRecipe.name} (${formatScaledNumber(selectedServings)} servings)`,
        tags: [...new Set([...(sourceRecipe.tags || []), "planner portion"])],
        ingredients: (sourceRecipe.ingredients || []).map((line) => scaleIngredientLine(line, factor)),
        originalIngredients: [],
        ingredientRefs: (sourceRecipe.ingredientRefs || []).map((ref) => ({
          ...ref,
          usedAmount: roundNutrition((Number(ref.usedAmount) || 0) * factor)
        })),
        servings: 1,
        calories: roundNutrition(caloriesPerServing(sourceRecipe) * selectedServings),
        macros: {
          protein: roundNutrition(macros.protein * selectedServings),
          carbs: roundNutrition(macros.carbs * selectedServings),
          fat: roundNutrition(macros.fat * selectedServings)
        },
        favourite: false,
        prepared: false,
        quickMeal: true
      };
      state.recipes.unshift(portionRecipe);
      recipeId = portionRecipe.id;
    }
    if (!recipeId) {
      const ingredient = selectedValue.startsWith("ingredient:") ? ingredientById(selectedValue.slice(11)) : null;
      const slot = mealPlanSlots.find((item) => item.id === context.slotId);
      const scaledNutrition = ingredient
        ? scaleNutrition(ingredient.nutrition || {}, selectedServings)
        : {
          calories: (Number(document.querySelector("#foodLogCalories").value) || 0) * selectedServings,
          protein: (Number(document.querySelector("#foodLogProtein").value) || 0) * selectedServings,
          carbs: (Number(document.querySelector("#foodLogCarbs").value) || 0) * selectedServings,
          fat: (Number(document.querySelector("#foodLogFat").value) || 0) * selectedServings
        };
      const servingAmount = Number(ingredient?.serving?.amount) || 1;
      const servingUnit = ingredient?.serving?.unit || "serving";
      const name = document.querySelector("#foodLogName").value.trim();
      const recipe = {
        id: `planner-food-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        category: slot?.category || context.slotId,
        categories: [slot?.category || context.slotId],
        tags: ["planner food", ingredient ? "ingredient" : "recent food"],
        ingredients: ingredient ? [`${roundNutrition(servingAmount * selectedServings)} ${servingUnit} ${ingredient.name}`] : [name],
        originalIngredients: [],
        ingredientRefs: ingredient ? [{
          ingredientId: ingredient.id,
          line: ingredient.name,
          usedAmount: roundNutrition(servingAmount * selectedServings),
          usedUnit: servingUnit
        }] : [],
        method: "Serve as planned.",
        servings: 1,
        calories: roundNutrition(scaledNutrition.calories),
        macros: {
          protein: roundNutrition(scaledNutrition.protein),
          carbs: roundNutrition(scaledNutrition.carbs),
          fat: roundNutrition(scaledNutrition.fat)
        },
        nutrition: {
          sugar: roundNutrition(scaledNutrition.sugar),
          fibre: roundNutrition(scaledNutrition.fibre),
          sodium: roundNutrition(scaledNutrition.sodium)
        },
        imageUrl: ingredient?.imageUrl || "",
        favourite: false,
        prepared: false,
        art: "custom",
        quickMeal: true
      };
      state.recipes.unshift(recipe);
      recipeId = recipe.id;
    }
    state.planner[context.day] ||= {};
    state.planner[context.day][context.slotId] = [...new Set([...plannerRecipeIds(context.day, context.slotId), recipeId])];
    state.plannerServings[context.day] ||= {};
    state.plannerServings[context.day][context.slotId] ||= {};
    state.consumed[context.day] ||= {};
    state.consumed[context.day][context.slotId] = false;
    state.bought = [];
    syncIngredientsAndRecipeLinks(state);
    saveState();
    document.querySelector("#foodLogDialog").close();
    foodPickerPlannerContext = null;
    renderPlanner();
    showToast(`${document.querySelector("#foodLogName").value.trim()} was added to ${context.day} ${context.slotLabel}.`, { type: "success" });
    return;
  }
  state.foodLog.push({
    id: `food-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    date: selectedTrackerDate(),
    person: selectedTrackerPerson(),
    meal: document.querySelector("#foodLogMeal").value,
    name: document.querySelector("#foodLogName").value.trim(),
    servings: Math.max(0.01, Number(document.querySelector("#foodLogServings").value) || 1),
    grams: Math.max(0, Number(document.querySelector("#foodLogGrams").value) || 0),
    gramsPerServing: Math.max(0, Number(document.querySelector("#foodLogGramsPerServing").value) || 0),
    calories: Math.max(0, Number(document.querySelector("#foodLogCalories").value) || 0),
    protein: Math.max(0, Number(document.querySelector("#foodLogProtein").value) || 0),
    carbs: Math.max(0, Number(document.querySelector("#foodLogCarbs").value) || 0),
    fat: Math.max(0, Number(document.querySelector("#foodLogFat").value) || 0)
  });
  saveState();
  document.querySelector("#foodLogDialog").close();
  renderTracker();
  showToast("Food added to the daily tracker.", { type: "success" });
});

document.addEventListener("click", async (event) => {
  const waterSetButton = event.target.closest("[data-water-set]");
  if (waterSetButton) {
    setTrackedWater(Number(waterSetButton.dataset.waterSet));
    return;
  }
  const waterAddButton = event.target.closest("[data-water-add]");
  if (waterAddButton) {
    const values = waterTrackingValues(selectedTrackerDate(), selectedTrackerPerson());
    setTrackedWater(values.total + Number(waterAddButton.dataset.waterAdd));
    return;
  }
  if (event.target.closest("#addCustomWaterButton")) {
    const amount = Number(document.querySelector("#waterCustomAmount").value) || 0;
    if (amount <= 0) {
      showToast("Enter a water amount in millilitres.", { type: "warning" });
      return;
    }
    const values = waterTrackingValues(selectedTrackerDate(), selectedTrackerPerson());
    setTrackedWater(values.total + amount);
    return;
  }
  if (event.target.closest("#saveWaterSettingsButton")) {
    const person = selectedTrackerPerson();
    state.waterTracking ||= { entries: {}, goals: {}, glassSizes: {} };
    state.waterTracking.goals ||= {};
    state.waterTracking.glassSizes ||= {};
    state.waterTracking.goals[person] = Math.min(10000, Math.max(250, Number(document.querySelector("#waterGoalInput").value) || 2000));
    state.waterTracking.glassSizes[person] = Math.min(2000, Math.max(50, Number(document.querySelector("#waterGlassInput").value) || 250));
    saveState();
    renderTracker();
    showToast("Water settings saved.", { type: "success" });
    return;
  }
  const nutritionHabitButton = event.target.closest("[data-nutrition-habit][data-nutrition-change]");
  if (nutritionHabitButton) {
    const context = nutritionHabitButton.closest("[data-daily-nutrition-context]");
    const date = context?.dataset.nutritionDate || document.querySelector("#trackerDate").value || todayDateKey();
    const person = context?.dataset.nutritionPerson || document.querySelector("#trackerPerson").value;
    const counts = dailyNutritionCounts(date, person);
    const habitId = nutritionHabitButton.dataset.nutritionHabit;
    if (setDailyNutritionCount(date, person, habitId, (counts[habitId] || 0) + Number(nutritionHabitButton.dataset.nutritionChange))) {
      saveState();
      if (state.activeTab === "dashboard") renderDashboard();
      else renderTracker();
    }
    return;
  }
  const quickMealButton = event.target.closest("[data-quick-meal-day][data-quick-meal-slot]");
  if (quickMealButton) {
    openQuickMealDialog(quickMealButton.dataset.quickMealDay, quickMealButton.dataset.quickMealSlot);
    return;
  }
  const plannerFoodButton = event.target.closest("[data-planner-food-day][data-planner-food-slot]");
  if (plannerFoodButton) {
    openFoodLogDialog({
      day: plannerFoodButton.dataset.plannerFoodDay,
      slotId: plannerFoodButton.dataset.plannerFoodSlot,
      slotLabel: plannerFoodButton.dataset.plannerFoodLabel
    });
    return;
  }

  const removeQuickMealRowButton = event.target.closest("[data-remove-quick-meal-row]");
  if (removeQuickMealRowButton) {
    const rows = document.querySelectorAll("[data-quick-meal-row]");
    if (rows.length <= 1) {
      showToast("A quick meal needs at least one ingredient.", { type: "warning" });
      return;
    }
    removeQuickMealRowButton.closest("[data-quick-meal-row]").remove();
    return;
  }
  const smartPlanButton = event.target.closest("#smartPlanButton");
  if (smartPlanButton) {
    const goals = currentNutritionGoals();
    document.querySelector("#smartPlannerTarget").textContent = `Daily target: ${formatPlannerNumber(goals.calories, "kcal")} and ${formatPlannerNumber(goals.protein, "protein")}.`;
    document.querySelector("#smartPlannerDialog").showModal();
    return;
  }

  const smartBalanceDayButton = event.target.closest("[data-smart-balance-day]");
  if (smartBalanceDayButton) {
    const day = smartBalanceDayButton.dataset.smartBalanceDay;
    const added = smartPlanDay(day, { keepExisting: true, preferPrepared: true, maxRepeats: 2 }, plannerRecipeUsageCounts(), state);
    saveState();
    renderPlanner();
    showToast(added ? `${day} was balanced with ${added} suggested meal${added === 1 ? "" : "s"}.` : `${day} has no empty slots with suitable recipes.`, { type: added ? "success" : "warning" });
    return;
  }

  const smartSwapButton = event.target.closest("[data-smart-swap]");
  if (smartSwapButton) {
    const { plannerDay: day, plannerSlot: slotId, currentRecipe, smartSwap: replacementId } = smartSwapButton.dataset;
    state.planner[day][slotId] = plannerRecipeIds(day, slotId).map((id) => id === currentRecipe ? replacementId : id);
    delete state.plannerServings?.[day]?.[slotId]?.[currentRecipe];
    state.bought = [];
    saveState();
    renderPlanner();
    showToast("Meal swapped with a nutrition-matched alternative.", { type: "success" });
    return;
  }
  const deleteFamilyGoalButton = event.target.closest("[data-family-goal-delete]");
  if (deleteFamilyGoalButton) {
    const horizon = deleteFamilyGoalButton.closest("[data-goal-horizon]")?.dataset.goalHorizon;
    if (!state.familyGoals?.[horizon]) return;
    state.familyGoals[horizon] = state.familyGoals[horizon].filter((goal) => goal.id !== deleteFamilyGoalButton.dataset.familyGoalDelete);
    saveState();
    renderFamilyGoals();
    return;
  }
  const addFoodButton = event.target.closest("#addFoodLogButton");
  if (addFoodButton) {
    openFoodLogDialog();
    return;
  }

  const removeFoodButton = event.target.closest("[data-remove-food-log]");
  if (removeFoodButton) {
    state.foodLog = state.foodLog.filter((entry) => entry.id !== removeFoodButton.dataset.removeFoodLog);
    saveState();
    renderTracker();
    return;
  }

  const habitRow = event.target.closest("[data-habit-row]");
  if (habitRow && !event.target.closest("input, label, button, a, select, textarea")) {
    advanceHabitRow(habitRow.dataset.habitMember, habitRow.dataset.habitId);
    return;
  }

  const previousRewardMonth = event.target.closest("#previousRewardMonth");
  if (previousRewardMonth) {
    state.rewardChartMonth = shiftedRewardMonth(state.rewardChartMonth, -1);
    saveState();
    renderFamilyRewards();
    return;
  }

  const nextRewardMonth = event.target.closest("#nextRewardMonth");
  if (nextRewardMonth && !nextRewardMonth.disabled) {
    state.rewardChartMonth = shiftedRewardMonth(state.rewardChartMonth, 1);
    if (state.rewardChartMonth > currentMonthKey()) state.rewardChartMonth = currentMonthKey();
    saveState();
    renderFamilyRewards();
    return;
  }

  const saveFamilyRewardButton = event.target.closest("[data-save-family-reward]");
  if (saveFamilyRewardButton) {
    const name = saveFamilyRewardButton.dataset.saveFamilyReward;
    const card = saveFamilyRewardButton.closest("[data-family-reward-card]");
    if (!card || state.kids?.[name]?.role !== "child") return;
    state.familyRewards[name] = {
      monthlyTarget: Math.min(31, Math.max(1, Number(card.querySelector("[data-reward-target]").value) || 20)),
      reward: card.querySelector("[data-reward-name]").value.trim().slice(0, 80)
    };
    saveState();
    renderFamilyRewards();
    showToast(`${name}'s reward target saved.`, { type: "success" });
    return;
  }

  const rewardDayButton = event.target.closest("[data-reward-date][data-reward-person]");
  if (rewardDayButton && !rewardDayButton.disabled) {
    const { rewardDate: dateKey, rewardPerson: name } = rewardDayButton.dataset;
    if (state.kids?.[name]?.role !== "child" || dateKey >= todayDateKey()) return;
    const existing = state.familyHabitHistory?.[dateKey]?.[name];
    const earned = Boolean(existing?.earned);
    const confirmed = await openUiDialog({
      title: earned ? "Remove this reward star?" : "Mark this day complete?",
      message: earned
        ? `${name}'s star for ${dateKey} will be removed.`
        : `${name} will receive a completion star for ${dateKey}.`,
      confirmLabel: earned ? "Remove star" : "Mark complete",
      tone: earned ? "danger" : "default"
    });
    if (!confirmed) return;
    const target = Math.max(1, Number(existing?.target) || familyHabitProgress(state, name).target);
    state.familyHabitHistory ||= {};
    state.familyHabitHistory[dateKey] ||= {};
    state.familyHabitHistory[dateKey][name] = {
      completed: earned ? 0 : target,
      target,
      earned: !earned,
      manual: true
    };
    saveState();
    renderFamilyRewards();
    showToast(`${name}'s ${dateKey} reward record updated.`, { type: "success" });
    return;
  }

  const tabButton = event.target.closest("[data-tab]");
  if (tabButton) setTab(tabButton.dataset.tab);

  const removeConfigMemberButton = event.target.closest("[data-remove-config-member]");
  if (removeConfigMemberButton) {
    if (configurationRows().length <= 1) {
      showToast("A household needs at least one family member.", { type: "warning" });
      return;
    }
    removeConfigMemberButton.closest("[data-config-member-row]")?.remove();
    document.querySelector("#configurationStatus").textContent = "Save configuration to apply this removal.";
  }

  const privatePersonButton = event.target.closest("[data-private-person]");
  if (privatePersonButton) {
    state.privatePerson = privatePersonButton.dataset.privatePerson;
    saveState();
    renderPrivate();
  }

  const printWeekButton = event.target.closest("#printWeekPlannerButton");
  if (printWeekButton) printWeekPlanner();

  const printRecipeButton = event.target.closest("[data-print-recipe]");
  if (printRecipeButton) {
    printRecipe(printRecipeButton.dataset.printRecipe);
    return;
  }

  const previousPlannerWeekButton = event.target.closest("#previousPlannerWeekButton");
  if (previousPlannerWeekButton) {
    selectPlannerWeek(shiftDateKey(state.selectedPlannerWeek, -7));
    saveState();
    render();
    return;
  }

  const nextPlannerWeekButton = event.target.closest("#nextPlannerWeekButton");
  if (nextPlannerWeekButton) {
    selectPlannerWeek(shiftDateKey(state.selectedPlannerWeek, 7));
    saveState();
    render();
    return;
  }

  const currentPlannerWeekButton = event.target.closest("#currentPlannerWeekButton");
  if (currentPlannerWeekButton) {
    selectPlannerWeek(currentPlannerWeekKey());
    saveState();
    render();
    return;
  }

  const selectedPlannerDate = event.target.closest("[data-select-planner-date]");
  if (selectedPlannerDate) {
    selectPlannerWeek(selectedPlannerDate.dataset.selectPlannerDate);
    saveState();
    render();
    document.querySelector("#plannerView")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const autoFillPlannerButton = event.target.closest("#autoFillPlannerButton");
  if (autoFillPlannerButton) {
    const filled = autoFillSelectedPlannerWeek();
    saveState();
    render();
    showToast(filled
      ? `Added ${filled} rotating meal${filled === 1 ? "" : "s"} to ${plannerWeekLabel()}.`
      : "Every available planner box is already filled.", { type: filled ? "success" : "warning" });
    return;
  }

  const previousPlannerMonthButton = event.target.closest("#previousPlannerMonthButton");
  const nextPlannerMonthButton = event.target.closest("#nextPlannerMonthButton");
  if (previousPlannerMonthButton || nextPlannerMonthButton) {
    state.plannerMonth = shiftMonthKey(state.plannerMonth, previousPlannerMonthButton ? -1 : 1);
    saveState();
    renderPlanner();
    return;
  }

  const removePlannerRecipeButton = event.target.closest("[data-remove-planner-recipe]");
  if (removePlannerRecipeButton) {
    const { plannerDay, plannerSlot, removePlannerRecipe } = removePlannerRecipeButton.dataset;
    state.planner[plannerDay] ||= {};
    state.planner[plannerDay][plannerSlot] = plannerRecipeIds(plannerDay, plannerSlot)
      .filter((recipeId) => recipeId !== removePlannerRecipe);
    if (state.plannerServings?.[plannerDay]?.[plannerSlot]) {
      delete state.plannerServings[plannerDay][plannerSlot][removePlannerRecipe];
    }
    state.consumed[plannerDay] ||= {};
    if (!state.planner[plannerDay][plannerSlot].length) state.consumed[plannerDay][plannerSlot] = false;
    state.bought = [];
    saveState();
    render();
  }

  const plannerServingStepButton = event.target.closest("[data-planner-serving-step]");
  if (plannerServingStepButton) {
    const { plannerDay, plannerSlot, plannerRecipe, plannerServingStep } = plannerServingStepButton.dataset;
    state.plannerServings ||= {};
    state.plannerServings[plannerDay] ||= {};
    state.plannerServings[plannerDay][plannerSlot] ||= {};
    state.plannerServings[plannerDay][plannerSlot][plannerRecipe] = Math.min(99, Math.max(1,
      plannerServingCount(plannerDay, plannerSlot, plannerRecipe) + Number(plannerServingStep)
    ));
    state.bought = [];
    saveState();
    render();
    return;
  }

  const resetPlannerServingButton = event.target.closest("[data-reset-planner-serving]");
  if (resetPlannerServingButton) {
    const { plannerDay, plannerSlot, plannerRecipe } = resetPlannerServingButton.dataset;
    delete state.plannerServings?.[plannerDay]?.[plannerSlot]?.[plannerRecipe];
    state.bought = [];
    saveState();
    render();
    return;
  }

  const toggleRecipePreparedButton = event.target.closest("[data-toggle-recipe-prepared]");
  if (toggleRecipePreparedButton) {
    const recipe = recipeById(toggleRecipePreparedButton.dataset.toggleRecipePrepared);
    if (!recipe) return;
    recipe.prepared = !recipe.prepared;
    saveState();
    render();
    return;
  }

  const editButton = event.target.closest("[data-edit-recipe]");
  if (editButton) {
    const recipe = recipeById(editButton.dataset.editRecipe);
    if (recipe) openRecipeDialog(recipe);
  }

  const duplicateRecipeButton = event.target.closest("[data-duplicate-recipe]");
  if (duplicateRecipeButton) duplicateRecipe(duplicateRecipeButton.dataset.duplicateRecipe);

  const openIngredientRecipeButton = event.target.closest("[data-open-ingredient-recipe]");
  if (openIngredientRecipeButton) {
    const recipe = recipeById(openIngredientRecipeButton.dataset.openIngredientRecipe);
    if (!recipe) return;
    document.querySelector("#recipeSearch").value = recipe.name;
    document.querySelector("#tagFilter").value = "all";
    setTab("recipes");
    openRecipeDialog(recipe);
  }

  const editIngredientButton = event.target.closest("[data-edit-ingredient]");
  if (editIngredientButton) {
    const ingredient = ingredientById(editIngredientButton.dataset.editIngredient);
    if (ingredient) openIngredientDialog(ingredient);
  }

  const deleteIngredientButton = event.target.closest("[data-delete-ingredient]");
  if (deleteIngredientButton) {
    const ingredient = ingredientById(deleteIngredientButton.dataset.deleteIngredient);
    if (!ingredient) return;
    const confirmed = await openUiDialog({
      title: "Delete ingredient?",
      message: `${ingredient.name} will be removed from ingredient data and unlinked from recipes.`,
      confirmLabel: "Delete ingredient",
      tone: "danger"
    });
    if (!confirmed) return;
    const deletedNameKey = ingredientKey(ingredient.name);
    const deletedIngredients = state.ingredients.filter((item) => ingredientKey(item.name) === deletedNameKey);
    const deletedIds = new Set(deletedIngredients.map((item) => item.id));
    const deletedKeys = new Set([
      ...(state.deletedIngredientKeys || []),
      ...deletedIngredients.flatMap((item) => [item.name, item.plural, ...(item.aliases || [])]).map(ingredientKey)
    ].filter(Boolean));
    state.deletedIngredientKeys = [...deletedKeys];
    state.ingredients = state.ingredients.filter((item) => !deletedIds.has(item.id));
    state.recipes = state.recipes.map((recipe) => ({
      ...recipe,
      ingredientRefs: (recipe.ingredientRefs || []).map((ref) => deletedIds.has(ref.ingredientId) ? { ...ref, ingredientId: "" } : ref)
    }));
    saveState();
    render();
    showToast(`${ingredient.name} deleted.`, { type: "success" });
  }

  const deleteWeightButton = event.target.closest("[data-delete-weight]");
  if (deleteWeightButton) {
    state.privateWeights = (state.privateWeights || []).filter((entry) => entry.id !== deleteWeightButton.dataset.deleteWeight);
    saveState();
    render();
  }

  const cleanupImagesButton = event.target.closest("#cleanupImagesButton");
  if (cleanupImagesButton) {
    const previousCount = Object.keys(state.imageLibrary || {}).length;
    normalizeImageAssets(state);
    const removedCount = previousCount - Object.keys(state.imageLibrary || {}).length;
    if (!saveState()) {
      showToast("Image cleanup could not be saved.", { type: "error" });
      return;
    }
    render();
    showToast(removedCount
      ? `Removed ${removedCount} unused uploaded image${removedCount === 1 ? "" : "s"}.`
      : "Image storage is already clean.", { type: "success" });
  }

  const removeBrokenImagesButton = event.target.closest("#removeBrokenImagesButton");
  if (removeBrokenImagesButton) {
    const previousState = structuredClone(state);
    const removedCount = removeBrokenImageReferences(state);
    if (!removedCount) {
      render();
      showToast("No broken image links were found.", { type: "success" });
      return;
    }
    if (!saveState()) {
      state = previousState;
      showToast("Broken image links could not be removed.", { type: "error" });
      return;
    }
    render();
    showToast(`Removed ${removedCount} broken image link${removedCount === 1 ? "" : "s"}.`, { type: "success" });
  }

  const removeImageAssetButton = event.target.closest("[data-remove-image-asset]");
  if (removeImageAssetButton) {
    const imageRef = `${IMAGE_ASSET_PREFIX}${removeImageAssetButton.dataset.removeImageAsset}`;
    state.recipes = (state.recipes || []).map((recipe) => recipe.imageUrl === imageRef ? { ...recipe, imageUrl: "" } : recipe);
    state.ingredients = (state.ingredients || []).map((ingredient) => ingredient.imageUrl === imageRef ? { ...ingredient, imageUrl: "" } : ingredient);
    delete state.imageLibrary?.[removeImageAssetButton.dataset.removeImageAsset];
    saveState();
    render();
  }

  const healthExerciseButton = event.target.closest("[data-health-exercise]");
  if (healthExerciseButton) {
    const name = healthExerciseButton.dataset.healthExercise;
    const current = state.healthExercise?.[name] || "";
    const enteredMinutes = await openUiDialog({
      title: "Update exercise",
      message: `Enter today's exercise minutes for ${name}.`,
      confirmLabel: "Save minutes",
      input: { label: "Exercise minutes", type: "number", inputMode: "numeric", min: 0, step: 1, value: current }
    });
    if (enteredMinutes === null) return;
    const minutes = Number(enteredMinutes);
    if (!Number.isFinite(minutes) || minutes < 0) return;
    ensureHealthExerciseForToday(state);
    state.healthExercise[name] = Math.round(minutes);
    state.kids[name].habits ||= {};
    state.kids[name].habits.exercise = [minutes > 0];
    saveState();
    render();
  }

  const deleteButton = event.target.closest("[data-delete-recipe]");
  if (deleteButton) await deleteRecipe(deleteButton.dataset.deleteRecipe);

  const favoriteButton = event.target.closest("[data-favorite-recipe]");
  if (favoriteButton) {
    const recipe = recipeById(favoriteButton.dataset.favoriteRecipe);
    if (!recipe) return;
    recipe.favourite = !recipe.favourite;
    saveState();
    render();
  }
});

document.addEventListener("error", (event) => {
  if (event.target instanceof HTMLImageElement && event.target.matches("[data-hide-on-error]")) {
    event.target.hidden = true;
  }
}, true);

document.addEventListener("toggle", (event) => {
  const daySection = event.target.closest?.("[data-planner-mobile-day]");
  if (!daySection?.open || state.activeTab !== "planner") return;
  const day = daySection.dataset.plannerMobileDay;
  document.querySelectorAll("[data-planner-mobile-day][open]").forEach((section) => {
    if (section !== daySection) section.open = false;
  });
  if (state.plannerFocusDay !== day) {
    state.plannerFocusDay = day;
    saveState();
  }
}, true);

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js").catch((error) => {
    console.warn("Unable to register MacroVault for offline use", error);
  });
}

document.addEventListener("keydown", (event) => {
  const habitRow = event.target.closest("[data-habit-row]");
  if (habitRow && event.target === habitRow && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    advanceHabitRow(habitRow.dataset.habitMember, habitRow.dataset.habitId);
    return;
  }
  const recipeImageButton = event.target.closest(".recipe-art[data-edit-recipe]");
  if (!recipeImageButton || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const recipe = recipeById(recipeImageButton.dataset.editRecipe);
  if (recipe) openRecipeDialog(recipe);
});

document.addEventListener("change", (event) => {
  const quickMealField = event.target.closest("[data-quick-meal-ingredient], [data-quick-meal-servings]");
  if (quickMealField) {
    updateQuickMealServingInfo(quickMealField.closest("[data-quick-meal-row]"));
    return;
  }
  const familyGoalText = event.target.closest("[data-family-goal-text]");
  if (familyGoalText) {
    const horizon = familyGoalText.closest("[data-goal-horizon]")?.dataset.goalHorizon;
    const goal = state.familyGoals?.[horizon]?.find((item) => item.id === familyGoalText.dataset.familyGoalText);
    if (!goal) return;
    const text = familyGoalText.value.trim().slice(0, 180);
    if (!text) {
      familyGoalText.value = goal.text;
      showToast("A family goal cannot be blank.", { type: "warning" });
      return;
    }
    goal.text = text;
    familyGoalText.value = text;
    saveState();
    showToast("Family goal updated.", { type: "success" });
    return;
  }

  const familyGoalToggle = event.target.closest("[data-family-goal-toggle]");
  if (familyGoalToggle) {
    const horizon = familyGoalToggle.closest("[data-goal-horizon]")?.dataset.goalHorizon;
    const goal = state.familyGoals?.[horizon]?.find((item) => item.id === familyGoalToggle.dataset.familyGoalToggle);
    if (!goal) return;
    goal.completed = familyGoalToggle.checked;
    saveState();
    renderFamilyGoals();
    return;
  }
  const plannerDayServingInput = event.target.closest("[data-planner-day-serving]");
  if (plannerDayServingInput) {
    const day = plannerDayServingInput.dataset.plannerDayServing;
    state.plannerDayServings ||= {};
    state.plannerDayServings[day] = Math.min(99, Math.max(1, Math.round(Number(plannerDayServingInput.value) || 1)));
    state.bought = [];
    saveState();
    render();
    return;
  }

  const plannerMonthInput = event.target.closest("#plannerMonth");
  if (plannerMonthInput) {
    state.plannerMonth = normalizedMonthKey(plannerMonthInput.value);
    saveState();
    renderPlanner();
    return;
  }

  const rewardMonthInput = event.target.closest("#rewardMonth");
  if (rewardMonthInput) {
    state.rewardChartMonth = normalizedMonthKey(rewardMonthInput.value);
    if (state.rewardChartMonth > currentMonthKey()) state.rewardChartMonth = currentMonthKey();
    saveState();
    renderFamilyRewards();
    return;
  }

  const plannerSelect = event.target.closest("[data-planner-add-day]");
  if (plannerSelect) {
    const { plannerAddDay: plannerDay, plannerAddSlot: plannerSlot } = plannerSelect.dataset;
    state.planner[plannerDay] ||= {};
    state.planner[plannerDay][plannerSlot] = [...new Set([
      ...plannerRecipeIds(plannerDay, plannerSlot),
      plannerSelect.value
    ].filter(Boolean))];
    state.plannerServings ||= {};
    state.plannerServings[plannerDay] ||= {};
    state.plannerServings[plannerDay][plannerSlot] ||= {};
    if (plannerSelect.value) {
      delete state.plannerServings[plannerDay][plannerSlot][plannerSelect.value];
    }
    state.consumed[plannerDay] ||= {};
    state.bought = [];
    saveState();
    render();
    return;
  }

  const plannerServingInput = event.target.closest("[data-planner-serving-count]");
  if (plannerServingInput) {
    const { plannerDay, plannerSlot, plannerRecipe } = plannerServingInput.dataset;
    state.plannerServings ||= {};
    state.plannerServings[plannerDay] ||= {};
    state.plannerServings[plannerDay][plannerSlot] ||= {};
    state.plannerServings[plannerDay][plannerSlot][plannerRecipe] = Math.min(99, Math.max(1,
      Math.round(Number(plannerServingInput.value) || 1)
    ));
    if (state.plannerServings[plannerDay][plannerSlot][plannerRecipe] === plannerDayServingCount(plannerDay)) {
      delete state.plannerServings[plannerDay][plannerSlot][plannerRecipe];
    }
    state.bought = [];
    saveState();
    render();
    return;
  }

  const boughtCheckbox = event.target.closest("[data-bought]");
  if (boughtCheckbox) {
    const item = boughtCheckbox.dataset.bought;
    state.bought = boughtCheckbox.checked
      ? [...new Set([...state.bought, item])]
      : state.bought.filter((bought) => bought !== item);
    saveState();
    render();
  }

  const clearRecipeFiltersButton = event.target.closest("#clearRecipeFiltersButton");
  if (clearRecipeFiltersButton) {
    document.querySelector("#recipeSearch").value = "";
    document.querySelector("#tagFilter").value = "all";
    renderRecipes();
  }

  const ingredientOnHand = event.target.closest("[data-ingredient-onhand]");
  if (ingredientOnHand) {
    const ingredient = ingredientById(ingredientOnHand.dataset.ingredientOnhand);
    if (!ingredient) return;
    ingredient.onHand = ingredientOnHand.checked;
    saveState();
    render();
  }

  const recipePrepared = event.target.closest("[data-recipe-prepared]");
  if (recipePrepared) {
    const recipe = recipeById(recipePrepared.dataset.recipePrepared);
    if (!recipe) return;
    recipe.prepared = recipePrepared.checked;
    saveState();
    render();
  }

  const habitInput = event.target.closest("[data-kid-habit]");
  if (habitInput) {
    const { kidHabit, habit, habitIndex } = habitInput.dataset;
    state.kids[kidHabit].habits ||= {};
    state.kids[kidHabit].habits[habit] ||= [];
    state.kids[kidHabit].habits[habit][Number(habitIndex)] = habitInput.checked;
    recordFamilyHabitDay(state, todayDateKey(), { force: true });
    saveState();
    render();
  }

});

document.addEventListener("input", (event) => {
  const quickMealServings = event.target.closest("[data-quick-meal-servings]");
  if (quickMealServings) updateQuickMealServingInfo(quickMealServings.closest("[data-quick-meal-row]"));
  const familyGoalText = event.target.closest("[data-family-goal-text]");
  if (familyGoalText) resizeFamilyGoalText(familyGoalText);
});

document.addEventListener("submit", (event) => {
  const familyGoalForm = event.target.closest("[data-family-goal-form]");
  if (!familyGoalForm) return;
  event.preventDefault();
  const horizon = familyGoalForm.dataset.familyGoalForm;
  const input = familyGoalForm.querySelector("input");
  const category = familyGoalForm.querySelector("select").value;
  const text = input.value.trim().slice(0, 180);
  if (!text || !state.familyGoals?.[horizon]) return;
  state.familyGoals[horizon].push({
    id: `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    completed: false,
    category: ["important", "nice", "dreams"].includes(category) ? category : "important"
  });
  saveState();
  renderFamilyGoals();
  document.querySelector(`#familyGoal-${horizon}`)?.focus();
});

document.querySelector("#smartPlannerForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const added = smartPlanSelectedWeek({
    keepExisting: document.querySelector("#smartKeepMeals").checked,
    preferPrepared: document.querySelector("#smartPreferPrepared").checked,
    maxRepeats: document.querySelector("#smartMaxRepeats").value
  });
  saveState();
  document.querySelector("#smartPlannerDialog").close();
  renderPlanner();
  showToast(added ? `Smart plan added ${added} nutrition-matched meal${added === 1 ? "" : "s"}.` : "No suitable recipes were available to add.", { type: added ? "success" : "warning" });
});

document.querySelector("#addQuickMealIngredient").addEventListener("click", () => addQuickMealRow());

document.querySelector("#quickMealForm").addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  if (!quickMealContext) return;
  const selected = [...document.querySelectorAll("[data-quick-meal-row]")].map((row) => {
    const ingredient = ingredientById(row.querySelector("[data-quick-meal-ingredient]").value);
    const servings = Math.min(20, Math.max(0.25, Number(row.querySelector("[data-quick-meal-servings]").value) || 1));
    return ingredient ? { ingredient, servings } : null;
  }).filter(Boolean);
  if (!selected.length) {
    showToast("Choose at least one saved ingredient.", { type: "warning" });
    return;
  }
  const slot = mealPlanSlots.find((item) => item.id === quickMealContext.slotId);
  if (!slot) return;
  const totals = selected.reduce((sum, item) => {
    const nutrition = scaleNutrition(item.ingredient.nutrition || {}, item.servings);
    Object.keys(sum).forEach((key) => { sum[key] += Number(nutrition[key]) || 0; });
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, sugar: 0, fibre: 0, fat: 0, sodium: 0 });
  const customName = document.querySelector("#quickMealName").value.trim();
  const name = (customName || selected.map((item) => item.ingredient.name).join(" & ")).slice(0, 100);
  const recipe = {
    id: `quick-meal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    category: slot.category,
    categories: [slot.category],
    tags: ["quick meal", "ingredients only"],
    ingredients: selected.map(({ ingredient, servings }) => {
      const amount = roundNutrition((Number(ingredient.serving?.amount) || 1) * servings);
      return `${amount} ${ingredient.serving?.unit || "each"} ${ingredient.name}`;
    }),
    originalIngredients: [],
    ingredientRefs: selected.map(({ ingredient, servings }) => ({
      ingredientId: ingredient.id,
      line: ingredient.name,
      usedAmount: roundNutrition((Number(ingredient.serving?.amount) || 1) * servings),
      usedUnit: ingredient.serving?.unit || "each"
    })),
    method: "Combine and serve.",
    servings: 1,
    calories: roundNutrition(totals.calories),
    macros: { protein: roundNutrition(totals.protein), carbs: roundNutrition(totals.carbs), fat: roundNutrition(totals.fat) },
    nutrition: { sugar: roundNutrition(totals.sugar), fibre: roundNutrition(totals.fibre), sodium: roundNutrition(totals.sodium) },
    imageUrl: selected.find((item) => item.ingredient.imageUrl)?.ingredient.imageUrl || "",
    favourite: false,
    prepared: false,
    art: "custom",
    quickMeal: true
  };
  state.recipes.unshift(recipe);
  state.planner[quickMealContext.day] ||= {};
  state.planner[quickMealContext.day][quickMealContext.slotId] = [...plannerRecipeIds(quickMealContext.day, quickMealContext.slotId), recipe.id];
  state.plannerServings[quickMealContext.day] ||= {};
  state.plannerServings[quickMealContext.day][quickMealContext.slotId] ||= {};
  state.consumed[quickMealContext.day] ||= {};
  state.consumed[quickMealContext.day][quickMealContext.slotId] = false;
  state.bought = [];
  syncIngredientsAndRecipeLinks(state);
  saveState();
  document.querySelector("#quickMealDialog").close();
  quickMealContext = null;
  renderPlanner();
  showToast(`${name} was added to ${slot.label}.`, { type: "success" });
});

document.querySelector("#recipeSearch").addEventListener("input", renderRecipes);
document.querySelector("#tagFilter").addEventListener("change", renderRecipes);
let ingredientSearchFrame = 0;
document.querySelector("#ingredientSearch").addEventListener("input", () => {
  cancelAnimationFrame(ingredientSearchFrame);
  ingredientSearchFrame = requestAnimationFrame(() => {
    ingredientSearchFrame = 0;
    renderIngredients();
  });
});
document.querySelector("#ingredientSearchForm").addEventListener("submit", (event) => {
  event.preventDefault();
  cancelAnimationFrame(ingredientSearchFrame);
  ingredientSearchFrame = 0;
  renderIngredients();
});
document.querySelector("#dailyCalorieGoal").addEventListener("change", (event) => {
  state.nutritionGoals ||= { ...defaultDailyNutritionGoals };
  state.nutritionGoals.calories = Math.max(0, Number(event.target.value) || defaultDailyNutritionGoals.calories);
  saveState();
  renderPlanner();
});
document.querySelector("#dailyProteinGoal").addEventListener("change", (event) => {
  state.nutritionGoals ||= { ...defaultDailyNutritionGoals };
  state.nutritionGoals.protein = Math.max(0, Number(event.target.value) || defaultDailyNutritionGoals.protein);
  saveState();
  renderPlanner();
});
document.querySelector("#dashboardNutritionPerson").addEventListener("change", (event) => {
  const section = document.querySelector(".dashboard-nutrition-template");
  section.dataset.nutritionPerson = event.target.value;
  renderDailyNutritionTemplate(document.querySelector("#dashboardNutritionTemplate"), todayDateKey(), event.target.value);
});

document.querySelector("#addRecipeButton").addEventListener("click", () => openRecipeDialog());
document.querySelector("#addConfigMemberButton").addEventListener("click", () => {
  const rows = configurationRows();
  if (rows.length >= 12) {
    showToast("MacroVault supports up to 12 family members.", { type: "warning" });
    return;
  }
  document.querySelector("#configMemberRows").insertAdjacentHTML(
    "beforeend",
    configurationMemberRow("", { role: "child", color: memberColorOptions[rows.length % memberColorOptions.length].value }, "")
  );
  const nextRows = configurationRows();
  nextRows[nextRows.length - 1].querySelector("[data-config-member-name]").focus();
});
document.querySelector("#configurationForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveConfiguration();
});
document.querySelector("#addIngredientButton").addEventListener("click", () => openIngredientDialog());
document.querySelector("#syncIngredientsButton").addEventListener("click", syncIngredientsFromRecipes);
document.querySelector("#updateGenericNutritionButton").addEventListener("click", updateIngredientsWithGenericNutrition);
document.querySelector("#scanBarcodeButton").addEventListener("click", () => openBarcodeDialog());
document.querySelector("#lookupIngredientBarcodeButton").addEventListener("click", async () => {
  const barcode = normalizeBarcode(document.querySelector("#ingredientBarcode").value);
  openBarcodeDialog(barcode);
  if (barcode) {
    await lookupBarcode(barcode);
    return;
  }
  try {
    await startBarcodeCamera();
  } catch (error) {
    stopBarcodeCamera();
    barcodeStatus(barcodeCameraError(error));
  }
});
document.querySelector("#startBarcodeCameraButton").addEventListener("click", async () => {
  try {
    await startBarcodeCamera();
  } catch (error) {
    stopBarcodeCamera();
    barcodeStatus(barcodeCameraError(error));
  }
});
document.querySelector("#takeBarcodePhotoButton").addEventListener("click", () => {
  document.querySelector("#barcodePhotoInput").click();
});
document.querySelector("#barcodePhotoInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    barcodeStatus("Reading barcode from photo...");
    const barcode = await detectBarcodeFromPhoto(file);
    document.querySelector("#barcodeManualInput").value = barcode;
    await lookupBarcode(barcode);
  } catch (error) {
    barcodeStatus(error.message || "Could not read barcode from this photo.");
  } finally {
    event.target.value = "";
  }
});
document.querySelector("#lookupBarcodeButton").addEventListener("click", () => {
  lookupBarcode(document.querySelector("#barcodeManualInput").value);
});
barcodeDialog.addEventListener("close", stopBarcodeCamera);

document.querySelector("#scanNutritionLabelButton").addEventListener("click", () => {
  document.querySelector("#nutritionLabelPhotoInput").click();
});
document.querySelector("#nutritionLabelPhotoInput").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await scanNutritionLabelPhoto(file);
  } catch (error) {
    nutritionLabelStatus(error.message || "Could not read this nutrition label.");
  } finally {
    event.target.value = "";
  }
});

document.querySelector("#estimateMacrosButton").addEventListener("click", fillEstimatedMacros);
document.querySelector("#recipeIngredients").addEventListener("input", () => {
  renderRecipeIngredientNutritionEditor();
  updateRecipeTotalsFromIngredientNutrition();
});
document.querySelector("#recipeServings").addEventListener("input", refreshRecipeServingMath);
document.querySelector("#recipeServings").addEventListener("change", refreshRecipeServingMath);
["#recipeCalories", "#recipeProtein", "#recipeCarbs", "#recipeFat", "#recipeFibre", "#recipeSodium"].forEach((selector) => {
  document.querySelector(selector).addEventListener("input", renderRecipeNutritionSummary);
});
document.querySelector("#recipeIngredientNutrition").addEventListener("input", (event) => {
  const input = event.target.closest("[data-recipe-ingredient-index]");
  if (!input) return;
  const row = input.closest(".recipe-ingredient-row");
  if (row && ["usedAmount", "usedUnit"].includes(input.dataset.recipeIngredientField)) {
    refreshRecipeIngredientRowNutrition(row);
  }
  updateRecipeTotalsFromIngredientNutrition();
});
document.querySelector("#recipeIngredientNutrition").addEventListener("change", (event) => {
  const input = event.target.closest("[data-recipe-ingredient-index]");
  if (!input) return;
  const row = input.closest(".recipe-ingredient-row");
  if (row && input.dataset.recipeIngredientField === "ingredientId") {
    refreshRecipeIngredientRowFromSelection(row);
  }
  if (row && ["usedAmount", "usedUnit"].includes(input.dataset.recipeIngredientField)) {
    refreshRecipeIngredientRowNutrition(row);
  }
  updateRecipeTotalsFromIngredientNutrition();
});

document.querySelector("#importRecipeButton").addEventListener("click", openRecipeImportDialog);

document.querySelector("#parseRecipeButton").addEventListener("click", previewRecipeImport);

document.querySelector("#recipeImageUrl").addEventListener("input", (event) => {
  if (event.target.value.trim()) {
    document.querySelector("#recipeImageData").value = "";
    document.querySelector("#recipeImageFile").value = "";
  }
  updateRecipeImagePreview(event.target.value.trim() || document.querySelector("#recipeImageData").value);
});

document.querySelector("#recipeImageFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imageData = await resizeImageFile(file);
    document.querySelector("#recipeImageData").value = imageData;
    document.querySelector("#recipeImageUrl").value = "";
    updateRecipeImagePreview(imageData);
  } catch (error) {
    showToast(error.message || "Could not prepare this image.", { type: "error" });
    event.target.value = "";
  }
});

document.querySelector("#clearRecipeImageButton").addEventListener("click", () => {
  document.querySelector("#recipeImageData").value = "";
  document.querySelector("#recipeImageUrl").value = "";
  document.querySelector("#recipeImageFile").value = "";
  updateRecipeImagePreview("");
});

document.querySelector("#ingredientImageUrl").addEventListener("input", (event) => {
  if (event.target.value.trim()) {
    document.querySelector("#ingredientImageData").value = "";
    document.querySelector("#ingredientImageFile").value = "";
  }
  updateIngredientImagePreview(event.target.value.trim() || document.querySelector("#ingredientImageData").value);
});

document.querySelector("#ingredientImageFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imageData = await resizeImageFile(file);
    document.querySelector("#ingredientImageData").value = imageData;
    document.querySelector("#ingredientImageUrl").value = "";
    updateIngredientImagePreview(imageData);
  } catch (error) {
    showToast(error.message || "Could not prepare this image.", { type: "error" });
    event.target.value = "";
  }
});

document.querySelector("#clearIngredientImageButton").addEventListener("click", () => {
  document.querySelector("#ingredientImageData").value = "";
  document.querySelector("#ingredientImageUrl").value = "";
  document.querySelector("#ingredientImageFile").value = "";
  updateIngredientImagePreview("");
});

document.querySelector("#exportButton").addEventListener("click", async () => {
  try {
    await exportState();
  } catch (error) {
    showToast(error.message || "Could not export the full backup.", { type: "error" });
  }
});

document.querySelector("#importButton").addEventListener("click", () => {
  document.querySelector("#importFile").click();
});

document.querySelector("#importFile").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) importState(file);
  event.target.value = "";
});

document.querySelector("#seedButton").addEventListener("click", async () => {
  const acknowledged = await openUiDialog({
    title: "Reset all application data?",
    message: "This will replace saved recipes, ingredients, planner, shopping, family, and private records with sample data. A browser backup will be kept first when storage allows it.",
    confirmLabel: "Continue to final check",
    tone: "danger"
  });
  if (!acknowledged) return;

  const confirmationPhrase = "RESET SAMPLE DATA";
  const enteredPhrase = await openUiDialog({
    title: "Final reset confirmation",
    message: `Type ${confirmationPhrase} exactly to confirm that you want to replace the current household data.`,
    confirmLabel: "Reset to sample data",
    tone: "danger",
    input: {
      label: `Type ${confirmationPhrase} to continue`,
      type: "text",
      value: ""
    }
  });
  if (enteredPhrase === null) return;
  if (enteredPhrase.trim() !== confirmationPhrase) {
    showToast("Reset cancelled because the confirmation phrase did not match.", { type: "warning" });
    return;
  }

  backupCurrentStorage("before sample reload");
  state = normalizeState(structuredClone(sampleState));
  saveState({ skipBackup: true });
  render();
  showToast("Sample data reloaded.", { type: "success" });
});

document.querySelector("#clearCheckedButton").addEventListener("click", () => {
  state.bought = [];
  saveState();
  render();
});

recipeForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    recipeDialog.close();
    return;
  }

  event.preventDefault();

  const name = document.querySelector("#recipeName").value.trim();
  const recipeId = document.querySelector("#recipeId").value;
  const tags = document.querySelector("#recipeTags").value.split(",").map((tag) => tag.trim()).filter(Boolean);
  const categories = [...document.querySelectorAll("#recipeCategory input:checked")].map((input) => input.value);
  const category = categories[0] || "dinner";
  const ingredientLines = recipeIngredientLinesFromForm();
  const ingredientData = ingredientLines.map(parseIngredientLine);
  const ingredientEdits = readRecipeIngredientNutritionEdits();
  const ingredients = ingredientLines;
  const originalIngredients = document.querySelector("#recipeOriginalIngredients").value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
  const method = document.querySelector("#recipeMethod").value.trim();
  const previousState = structuredClone(state);
  const imageUrl = await prepareRecipeImageForSave(document.querySelector("#recipeImageData").value || document.querySelector("#recipeImageUrl").value.trim());
  const servings = Math.max(1, Number(document.querySelector("#recipeServings").value || 1));
  const caloriesPerServe = roundNutrition(document.querySelector("#recipeCalories").value);
  const enteredMacrosPerServe = {
    protein: roundNutrition(document.querySelector("#recipeProtein").value),
    carbs: roundNutrition(document.querySelector("#recipeCarbs").value),
    fat: roundNutrition(document.querySelector("#recipeFat").value)
  };
  const fibrePerServe = roundNutrition(document.querySelector("#recipeFibre").value);
  const sodiumPerServe = roundNutrition(document.querySelector("#recipeSodium").value);
  const enteredMacros = scaleNutrition(enteredMacrosPerServe, servings);
  const editorTotals = editorNutritionTotals();
  const estimatedMacros = estimateMacrosFromIngredients(ingredientLines);
  const shouldUseEstimate = !hasMeaningfulMacros(enteredMacrosPerServe)
    || (!recipeId && enteredMacrosPerServe.protein === 25 && enteredMacrosPerServe.carbs === 45 && enteredMacrosPerServe.fat === 15);

  const existingRecipe = recipeById(recipeId);
  const recipeData = {
    id: recipeId || `${slugify(name)}-${Date.now().toString(36)}`,
    name,
    category,
    categories: categories.length ? categories : [category],
    tags: tags.length ? tags : ["family recipe"],
    ingredients,
    originalIngredients,
    method,
    servings,
    calories: shouldUseEstimate
      ? caloriesFromMacros(estimatedMacros)
      : roundNutrition((caloriesPerServe || caloriesFromMacros(enteredMacrosPerServe)) * servings),
    macros: shouldUseEstimate ? estimatedMacros : enteredMacros,
    nutrition: {
      ...(existingRecipe?.nutrition || {}),
      sugar: editorTotals.sugar,
      fibre: editorTotals.fibre || roundNutrition(fibrePerServe * servings),
      sodium: editorTotals.sodium || roundNutrition(sodiumPerServe * servings)
    },
    imageUrl,
    favourite: existingRecipe?.favourite || false,
    prepared: document.querySelector("#recipePrepared").checked,
    art: existingRecipe?.art || "custom",
    sourceUrl: document.querySelector("#recipeSourceUrl").value.trim(),
    ingredientRefs: ingredientData.map((item, index) => {
      const existingRef = existingRecipe?.ingredientRefs?.[index] || {};
      const existingIngredient = existingRef.ingredientId ? ingredientById(existingRef.ingredientId) : null;
      const existingIngredientId = existingIngredient && ingredientMatchesLine(existingIngredient, item.name) ? existingRef.ingredientId : "";
      return {
        ...existingRef,
        line: item.name,
        ingredientId: ingredientEdits[index]?.ingredientId || existingIngredientId,
        usedAmount: item.usedAmount,
        usedUnit: item.usedUnit
      };
    })
  };

  if (recipeId) {
    state.recipes = state.recipes.map((recipe) => recipe.id === recipeId ? { ...recipe, ...recipeData } : recipe);
  } else {
    state.recipes.unshift(recipeData);
  }
  syncIngredientsAndRecipeLinks(state, { removeUnused: true });
  applyRecipeIngredientNutritionEdits(ingredients);
  applyRecipeIngredientUsageEdits(recipeData.id);
  syncIngredientsAndRecipeLinks(state);
  state.recipes = state.recipes.map((recipe) => recipe.id === recipeData.id
    ? refreshRecipeNutritionFromIngredients(recipe, state.ingredients)
    : recipe);

  document.querySelector("#recipeSearch").value = "";
  document.querySelector("#tagFilter").value = "all";
  if (!saveState()) {
    state = previousState;
    document.querySelector("#macroEstimateNote").textContent = "Could not save. Browser storage may be full; remove uploaded images from Site or use image URLs.";
    showToast("Could not save. Browser storage is probably full from uploaded images. Remove a few large images from Site, or use image URLs instead.", { type: "error", duration: 8000 });
    return;
  }
  if (lastSaveWarning) showToast(lastSaveWarning, { type: "warning", duration: 8000 });

  recipeForm.reset();
  recipeDialog.close();
  setTab("recipes");
});

ingredientForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") {
    ingredientDialog.close();
    return;
  }
  event.preventDefault();

  const ingredientId = document.querySelector("#ingredientId").value;
  const name = document.querySelector("#ingredientName").value.trim();
  if (!name) return;
  const previousState = structuredClone(state);
  const ingredientData = {
    id: ingredientId || `ingredient-${slugify(name)}-${Date.now().toString(36)}`,
    name,
    manuallyAdded: true,
    plural: document.querySelector("#ingredientPlural").value.trim(),
    aliases: normalizeIngredientAliases(document.querySelector("#ingredientAliases").value)
      .filter((alias) => ![ingredientKey(name), ingredientKey(document.querySelector("#ingredientPlural").value)].includes(ingredientKey(alias))),
    description: document.querySelector("#ingredientDescription").value.trim(),
    barcode: normalizeBarcode(document.querySelector("#ingredientBarcode").value),
    imageUrl: document.querySelector("#ingredientImageData").value || document.querySelector("#ingredientImageUrl").value.trim(),
    label: document.querySelector("#ingredientLabel").value.trim() || categoryForIngredient(name),
    onHand: document.querySelector("#ingredientOnHand").checked,
    serving: {
      amount: Math.max(0.1, Number(document.querySelector("#ingredientServingAmount").value || 1)),
      unit: document.querySelector("#ingredientServingUnit").value || "each"
    },
    nutrition: {
      calories: roundNutrition(document.querySelector("#ingredientCalories").value),
      protein: roundNutrition(document.querySelector("#ingredientProtein").value),
      carbs: roundNutrition(document.querySelector("#ingredientCarbs").value),
      sugar: roundNutrition(document.querySelector("#ingredientSugar").value),
      fibre: roundNutrition(document.querySelector("#ingredientFibre").value),
      fat: roundNutrition(document.querySelector("#ingredientFat").value),
      sodium: roundNutrition(document.querySelector("#ingredientSodium").value)
    }
  };

  const restoredKeys = new Set([ingredientData.name, ingredientData.plural, ...ingredientData.aliases].map(ingredientKey).filter(Boolean));
  state.deletedIngredientKeys = (state.deletedIngredientKeys || []).filter((key) => !restoredKeys.has(ingredientKey(key)));

  if (ingredientId) {
    state.ingredients = state.ingredients.map((ingredient) => ingredient.id === ingredientId ? ingredientData : ingredient);
  } else {
    state.ingredients.push(ingredientData);
  }
  state.ingredients.sort((a, b) => a.name.localeCompare(b.name));
  syncIngredientsAndRecipeLinks(state, { refreshRecipeNutrition: true });
  if (!saveState()) {
    state = previousState;
    showToast("Could not save this ingredient. Browser storage is probably full from uploaded images. Remove a few images from Site, or use image URLs instead.", { type: "error", duration: 8000 });
    return;
  }
  ingredientForm.reset();
  ingredientDialog.close();
  setTab("ingredients");
});

document.querySelector("#weightForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveWeightEntry();
});
document.querySelector("#saveWeightButton").addEventListener("click", (event) => {
  event.preventDefault();
  saveWeightEntry();
});
document.querySelector("#saveWeightGoalButton").addEventListener("click", saveWeightGoal);

recipeImportForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") {
    recipeImportDialog.close();
    return;
  }
  event.preventDefault();
  await saveImportedRecipe();
});

async function initializeApp() {
  await initializeStateFromStorage();
  applyGenericNutritionFromUrlRequest();
  render();
}

initializeApp().catch((error) => {
  console.error("Unable to initialize MacroVault", error);
  state = loadState();
  setSyncStatus("local", "Saved in this browser");
  render();
});

const moreActionsButton = document.querySelector("#moreActionsButton");
const moreActionsMenu = document.querySelector("#moreActionsMenu");

function closeActionMenu() {
  moreActionsMenu.hidden = true;
  moreActionsButton.setAttribute("aria-expanded", "false");
}

moreActionsButton.addEventListener("click", () => {
  const willOpen = moreActionsMenu.hidden;
  moreActionsMenu.hidden = !willOpen;
  moreActionsButton.setAttribute("aria-expanded", String(willOpen));
});

document.addEventListener("click", (event) => {
  if (!document.querySelector("#actionOverflow").contains(event.target)) closeActionMenu();
  if (event.target.closest("#moreActionsMenu button")) closeActionMenu();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !moreActionsMenu.hidden) {
    closeActionMenu();
    moreActionsButton.focus();
  }
});

window.addEventListener("offline", () => setSyncStatus("local", "Offline — saved locally"));
window.addEventListener("online", () => {
  setSyncStatus("saving", "Reconnecting…");
  queueServerStateSave(state, syncMetadata.pending ? { token: syncMetadata.pending.token } : {});
});

window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  if (state?.activeTab === "planner") renderPlanner();
});
