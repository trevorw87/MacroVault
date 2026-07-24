// MacroVault rendering orchestration, event wiring, and application startup.
function renderActiveView() {
  const renderers = {
    dashboard: renderDashboard,
    recipes: renderRecipes,
    ingredients: renderIngredients,
    planner: renderPlanner,
    shopping: renderShopping,
    kids: renderKids,
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

document.addEventListener("click", async (event) => {
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

  const removePlannerRecipeButton = event.target.closest("[data-remove-planner-recipe]");
  if (removePlannerRecipeButton) {
    const { plannerDay, plannerSlot, removePlannerRecipe } = removePlannerRecipeButton.dataset;
    state.planner[plannerDay] ||= {};
    state.planner[plannerDay][plannerSlot] = plannerRecipeIds(plannerDay, plannerSlot)
      .filter((recipeId) => recipeId !== removePlannerRecipe);
    state.consumed[plannerDay] ||= {};
    if (!state.planner[plannerDay][plannerSlot].length) state.consumed[plannerDay][plannerSlot] = false;
    state.bought = [];
    saveState();
    render();
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
    state.ingredients = state.ingredients.filter((item) => item.id !== ingredient.id);
    state.recipes = state.recipes.map((recipe) => ({
      ...recipe,
      ingredientRefs: (recipe.ingredientRefs || []).map((ref) => ref.ingredientId === ingredient.id ? { ...ref, ingredientId: "" } : ref)
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

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js").catch((error) => {
    console.warn("Unable to register MacroVault for offline use", error);
  });
}

document.addEventListener("keydown", (event) => {
  const recipeImageButton = event.target.closest(".recipe-art[data-edit-recipe]");
  if (!recipeImageButton || !["Enter", " "].includes(event.key)) return;
  event.preventDefault();
  const recipe = recipeById(recipeImageButton.dataset.editRecipe);
  if (recipe) openRecipeDialog(recipe);
});

document.addEventListener("change", (event) => {
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
    state.consumed[plannerDay] ||= {};
    state.bought = [];
    saveState();
    render();
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

document.querySelector("#recipeSearch").addEventListener("input", renderRecipes);
document.querySelector("#tagFilter").addEventListener("change", renderRecipes);
document.querySelector("#ingredientSearch").addEventListener("input", renderIngredients);
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
  syncIngredientsAndRecipeLinks(state);
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
    plural: document.querySelector("#ingredientPlural").value.trim(),
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
  queueServerStateSave(state);
});

window.matchMedia("(max-width: 760px)").addEventListener("change", () => {
  if (state?.activeTab === "planner") renderPlanner();
});
