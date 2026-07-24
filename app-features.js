// MacroVault recipe actions, backups, family, private, and settings features.
async function deleteRecipe(recipeId) {
  const recipe = recipeById(recipeId);
  if (!recipe) return;
  const confirmed = await openUiDialog({
    title: "Delete recipe?",
    message: `${recipe.name} will be removed from recipes and the weekly planner.`,
    confirmLabel: "Delete recipe",
    tone: "danger"
  });
  if (!confirmed) return;
  state.recipes = state.recipes.filter((item) => item.id !== recipeId);
  days.forEach((day) => {
    mealPlanSlots
      .forEach((slot) => {
        state.planner[day][slot.id] = plannerRecipeIds(day, slot.id).filter((plannedId) => plannedId !== recipeId);
        if (state.plannerServings?.[day]?.[slot.id]) delete state.plannerServings[day][slot.id][recipeId];
      });
  });
  Object.values(state.kids).forEach((kid) => {
    delete kid.ratings[recipeId];
  });
  state.bought = [];
  saveState();
  render();
  showToast(`${recipe.name} deleted.`, { type: "success" });
}

function duplicateRecipe(recipeId) {
  const sourceRecipe = recipeById(recipeId);
  if (!sourceRecipe) return;
  const existingNames = new Set((state.recipes || []).map((recipe) => recipe.name.toLocaleLowerCase()));
  const baseName = `${sourceRecipe.name} Copy`;
  let copyName = baseName;
  let copyNumber = 2;
  while (existingNames.has(copyName.toLocaleLowerCase())) {
    copyName = `${baseName} ${copyNumber}`;
    copyNumber += 1;
  }
  const previousState = structuredClone(state);
  const copy = {
    ...structuredClone(sourceRecipe),
    id: `${slugify(copyName)}-${Date.now().toString(36)}`,
    name: copyName,
    favourite: false,
    prepared: false
  };
  state.recipes.unshift(copy);
  syncIngredientsAndRecipeLinks(state);
  if (!saveState()) {
    state = previousState;
    showToast("Could not duplicate this recipe. Browser storage may be full.", { type: "error" });
    return;
  }
  document.querySelector("#recipeSearch").value = "";
  document.querySelector("#tagFilter").value = "all";
  render();
  openRecipeDialog(recipeById(copy.id));
  showToast(`${sourceRecipe.name} duplicated. Rename and edit the copy.`, { type: "success" });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error || new Error("Could not read image")));
    reader.readAsDataURL(blob);
  });
}

async function exportState() {
  const exportedState = structuredClone(state);
  for (const [id, asset] of Object.entries(exportedState.imageLibrary || {})) {
    if (asset.data) continue;
    const response = await fetch(`api/images/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(`Could not include image ${id} in the backup.`);
    asset.data = await blobToDataUrl(await response.blob());
  }
  const blob = new Blob([JSON.stringify(exportedState, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `macrovault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importState(file) {
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported.recipes) || !imported.planner) {
        throw new Error("Backup is missing required MacroVault data.");
      }
      backupCurrentStorage("before import");
      state = normalizeState({ ...structuredClone(sampleState), ...imported });
      saveState({ skipBackup: true });
      render();
      showToast("MacroVault backup imported.", { type: "success" });
    } catch (error) {
      showToast(error.message || "Could not import this backup.", { type: "error" });
    }
  });
  reader.readAsText(file);
}

function rewardMonthDate(monthKey) {
  const [year, month] = normalizedMonthKey(monthKey).split("-").map(Number);
  return new Date(year, month - 1, 1);
}

function shiftedRewardMonth(monthKey, offset) {
  const date = rewardMonthDate(monthKey);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function renderFamilyRewards() {
  const container = document.querySelector("#familyRewardCharts");
  const monthInput = document.querySelector("#rewardMonth");
  if (!container || !monthInput) return;
  const monthKey = normalizedMonthKey(state.rewardChartMonth);
  state.rewardChartMonth = monthKey;
  monthInput.value = monthKey;
  monthInput.max = currentMonthKey();
  document.querySelector("#nextRewardMonth").disabled = monthKey >= currentMonthKey();
  const monthDate = rewardMonthDate(monthKey);
  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const leadingBlanks = monthDate.getDay();
  const childEntries = Object.entries(state.kids || {}).filter(([, member]) => member.role === "child");
  if (!childEntries.length) {
    container.innerHTML = '<p class="empty-state">Add a child in Settings to use monthly rewards.</p>';
    return;
  }
  container.innerHTML = childEntries.map(([name, member]) => {
    const settings = state.familyRewards[name] || { monthlyTarget: 20, reward: "" };
    const dates = Array.from({ length: daysInMonth }, (_, index) => `${monthKey}-${String(index + 1).padStart(2, "0")}`);
    const starsEarned = dates.filter((dateKey) => state.familyHabitHistory?.[dateKey]?.[name]?.earned).length;
    const target = settings.monthlyTarget;
    const remaining = Math.max(0, target - starsEarned);
    const rewardText = settings.reward || "your chosen reward";
    return `
      <article class="family-reward-card ${safeCssToken(member.color)}" data-family-reward-card="${escapeHtml(name)}">
        <header class="reward-card-header">
          <div>
            <h3>${escapeHtml(name)}</h3>
            <p><strong>${starsEarned} of ${target} stars earned</strong></p>
          </div>
          <span class="reward-star-total" aria-label="${starsEarned} stars">★ ${starsEarned}</span>
        </header>
        <div class="reward-progress" role="progressbar" aria-label="${escapeHtml(name)} monthly reward progress" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(starsEarned, target)}">
          <span style="width: ${Math.min(100, (starsEarned / target) * 100)}%"></span>
        </div>
        <p class="reward-status">${remaining ? `${remaining} more star${remaining === 1 ? "" : "s"} to ${escapeHtml(rewardText)}.` : `Target reached: ${escapeHtml(rewardText)}!`}</p>
        <div class="reward-settings">
          <label>Monthly target<input data-reward-target type="number" min="1" max="31" value="${target}"></label>
          <label>Reward<input data-reward-name maxlength="80" value="${escapeHtml(settings.reward)}" placeholder="e.g. Movie night"></label>
          <button class="secondary-button" data-save-family-reward="${escapeHtml(name)}" type="button">Save reward</button>
        </div>
        <div class="reward-calendar" aria-label="${escapeHtml(name)} reward calendar">
          ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span class="reward-weekday">${day}</span>`).join("")}
          ${Array.from({ length: leadingBlanks }, () => '<span class="reward-day blank" aria-hidden="true"></span>').join("")}
          ${dates.map((dateKey, index) => {
            const history = state.familyHabitHistory?.[dateKey]?.[name];
            const dayTarget = Math.max(0, Number(history?.target) || familyHabitProgress(state, name).target);
            const completed = Math.min(dayTarget, Math.max(0, Number(history?.completed) || 0));
            const earned = Boolean(history?.earned);
            const isFuture = dateKey > todayDateKey();
            const isToday = dateKey === todayDateKey();
            const canCorrect = !isFuture && !isToday;
            const label = earned ? "Star earned" : `${completed} of ${dayTarget} habits`;
            return `<button class="reward-day ${earned ? "earned" : completed ? "partial" : ""} ${isToday ? "today" : ""}" type="button"
              data-reward-person="${escapeHtml(name)}" data-reward-date="${dateKey}" ${canCorrect ? "" : "disabled"}
              aria-label="${escapeHtml(`${name}, ${dateKey}: ${label}${canCorrect ? ". Select to correct this day." : ""}`)}">
              <span class="reward-day-number">${index + 1}</span>
              <strong>${earned ? "★" : completed ? `${completed}/${dayTarget}` : ""}</strong>
            </button>`;
          }).join("")}
        </div>
        <p class="reward-correction-note">Parents can select a past day to add or remove a completion star.</p>
      </article>
    `;
  }).join("");
}

function renderKids() {
  document.querySelector("#kidsLayout").innerHTML = Object.entries(state.kids).map(([name, kid]) => {
    const habits = familyHabitTargetsForPerson(name);
    const completed = habits.reduce((sum, habit) => sum + (kid.habits?.[habit.id] || []).filter(Boolean).length, 0);
    const target = habits.reduce((sum, habit) => sum + habit.target, 0);
    const canSyncExercise = kid.role === "adult";
    return `
      <article class="kid-card kid-habit-card ${safeCssToken(kid.color)} ${kid.role === "adult" ? "adult" : "child"}">
        <header class="kid-habit-header">
          <div>
            <h3>${escapeHtml(name)}</h3>
            <p class="muted">${completed} / ${target} healthy ticks today</p>
          </div>
          <span class="kid-score-pill">${kid.stars} stars</span>
        </header>
        <div class="habit-grid">
          ${habits.map((habit) => `
            <section class="habit-row">
              <div class="habit-visual ${habit.icon}" aria-hidden="true"></div>
              <div class="habit-copy">
                <strong>${habit.label}</strong>
                <span>${(kid.habits?.[habit.id] || []).filter(Boolean).length} / ${habit.target}</span>
                ${habit.id === "exercise" && canSyncExercise ? `
                  <button class="health-sync-button" data-health-exercise="${escapeHtml(name)}" type="button">
                    ${Number(state.healthExercise?.[name]) > 0 ? `Health app: ${Number(state.healthExercise[name])} min` : "Link health app"}
                  </button>
                ` : ""}
              </div>
              <div class="habit-checks" aria-label="${escapeHtml(habit.label)} for ${escapeHtml(name)}">
                ${Array.from({ length: habit.target }, (_, index) => `
                  <label class="habit-check">
                    <input type="checkbox" ${kid.habits?.[habit.id]?.[index] ? "checked" : ""} data-kid-habit="${escapeHtml(name)}" data-habit="${escapeHtml(habit.id)}" data-habit-index="${index}">
                    <span></span>
                  </label>
                `).join("")}
              </div>
            </section>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
  renderFamilyRewards();
}

function renderImageStorage() {
  const summary = document.querySelector("#imageStorageSummary");
  const grid = document.querySelector("#imageStorageGrid");
  if (!summary || !grid) return;
  normalizeImageAssets(state);
  const assets = imageStorageSummary(state);
  const missingAssets = missingImageAssetUsages(state);
  const totalSize = Math.round(assets.reduce((sum, asset) => sum + asset.sizeKb, 0) * 10) / 10;
  summary.textContent = assets.length || missingAssets.length
    ? `${assets.length} uploaded image${assets.length === 1 ? "" : "s"} using about ${totalSize} KB in MacroVault server storage.`
    : "No uploaded images are stored in MacroVault. External image URLs are not copied to server storage.";
  grid.innerHTML = `
    ${missingAssets.length ? `
      <section class="image-storage-warning">
        <strong>${missingAssets.length} uploaded image reference${missingAssets.length === 1 ? "" : "s"} missing stored data</strong>
        <p class="muted">These images cannot be displayed because the server no longer has the uploaded image data. Re-upload the image or use an image URL.</p>
        <div class="missing-image-list">
          ${missingAssets.map((asset) => `<span>${escapeHtml(asset.type)}: ${escapeHtml(asset.name)}</span>`).join("")}
        </div>
        <button class="secondary-button" id="removeBrokenImagesButton" type="button">Remove broken image links</button>
      </section>
    ` : ""}
    ${assets.length ? assets.map((asset) => `
    <article class="image-storage-item">
      <a class="image-storage-thumb" href="${escapeHtml(resolveImageUrl(`${IMAGE_ASSET_PREFIX}${asset.id}`))}" target="_blank" rel="noreferrer" title="Open uploaded image">
        <img src="${escapeHtml(resolveImageUrl(`${IMAGE_ASSET_PREFIX}${asset.id}`))}" alt="">
      </a>
      <div>
        <strong>${asset.sizeKb} KB</strong>
        <p class="muted">${asset.uses.length ? asset.uses.map((use) => `${escapeHtml(use.type)}: ${escapeHtml(use.name)}`).join(", ") : "Not used"}</p>
      </div>
      <div class="image-storage-actions">
        <a class="secondary-button" href="${escapeHtml(resolveImageUrl(`${IMAGE_ASSET_PREFIX}${asset.id}`))}" target="_blank" rel="noreferrer">Open</a>
        <button class="text-button danger-button" data-remove-image-asset="${escapeHtml(asset.id)}" type="button">Remove</button>
      </div>
    </article>
  `).join("") : `<p class="muted">No uploaded images to show.</p>`}
  `;
}

function renderSite() {
  renderImageStorage();
}

function renderPrivate() {
  const dateInput = document.querySelector("#weightDate");
  if (dateInput && !dateInput.value) dateInput.value = displayWeightDate(todayDateKey());
  const memberNames = familyMemberNames();
  const selectedPerson = memberNames.includes(state.privatePerson) ? state.privatePerson : primaryFamilyMember();
  const targetWeight = Number(state.privateWeightGoals?.[selectedPerson]) || 0;
  document.querySelector("#weightGoalValue").value = targetWeight || "";
  const entries = [...(state.privateWeights || [])]
    .filter((entry) => (entry.person || selectedPerson) === selectedPerson)
    .sort((a, b) => a.date.localeCompare(b.date));
  document.querySelector("#privatePersonTabs").innerHTML = memberNames.map((person) => `
    <button class="person-tab ${person === selectedPerson ? "active" : ""}" data-private-person="${person}" type="button">${person}</button>
  `).join("");
  const chart = document.querySelector("#weightChart");
  const summary = document.querySelector("#weightSummary");
  const stats = document.querySelector("#weightStats");
  const history = document.querySelector("#weightHistory");

  if (!entries.length) {
    summary.textContent = `Add a weight entry for ${selectedPerson} to begin.`;
    stats.innerHTML = `
      <article class="weight-stat-card">
        <span>Latest weight</span>
        <strong>--</strong>
        <p>No entries saved for ${selectedPerson} yet.</p>
      </article>
      ${targetWeight ? `
        <article class="weight-stat-card target">
          <span>Target weight</span>
          <strong>${targetWeight} kg</strong>
          <p>Saved for ${selectedPerson}</p>
        </article>
      ` : ""}
    `;
    chart.innerHTML = `<div class="empty-chart">No weight data yet</div>`;
    history.innerHTML = `<p class="muted">No entries saved for ${selectedPerson}.</p>`;
    return;
  }

  const latest = entries[entries.length - 1];
  const first = entries[0];
  const change = Math.round((latest.weight - first.weight) * 10) / 10;
  summary.textContent = `${latest.weight} kg latest / ${change >= 0 ? "+" : ""}${change} kg overall`;
  stats.innerHTML = `
    <article class="weight-stat-card primary">
      <span>Latest weight</span>
      <strong>${latest.weight} kg</strong>
      <p>${displayWeightDate(latest.date)}</p>
    </article>
    <article class="weight-stat-card">
      <span>First entry</span>
      <strong>${first.weight} kg</strong>
      <p>${displayWeightDate(first.date)}</p>
    </article>
    <article class="weight-stat-card">
      <span>Overall change</span>
      <strong>${change >= 0 ? "+" : ""}${change} kg</strong>
      <p>${entries.length} ${selectedPerson} entr${entries.length === 1 ? "y" : "ies"}</p>
    </article>
    ${targetWeight ? `
      <article class="weight-stat-card target">
        <span>Target weight</span>
        <strong>${targetWeight} kg</strong>
        <p>${formatScaledNumber(Math.abs(latest.weight - targetWeight))} kg from latest</p>
      </article>
    ` : ""}
  `;

  const width = 720;
  const height = 260;
  const pad = 34;
  const weights = [...entries.map((entry) => entry.weight), ...(targetWeight ? [targetWeight] : [])];
  const minWeight = Math.min(...weights);
  const maxWeight = Math.max(...weights);
  const range = Math.max(1, maxWeight - minWeight);
  const points = entries.map((entry, index) => {
    const x = entries.length === 1 ? width / 2 : pad + (index / (entries.length - 1)) * (width - pad * 2);
    const y = height - pad - ((entry.weight - minWeight) / range) * (height - pad * 2);
    return { ...entry, x, y };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area = `${pad},${height - pad} ${polyline} ${width - pad},${height - pad}`;

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Weight trend chart">
      <defs>
        <linearGradient id="weightArea" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#70c8ff" stop-opacity="0.34"></stop>
          <stop offset="100%" stop-color="#75d47b" stop-opacity="0.06"></stop>
        </linearGradient>
      </defs>
      <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="chart-axis"></line>
      <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="chart-axis"></line>
      ${targetWeight ? (() => {
        const targetY = height - pad - ((targetWeight - minWeight) / range) * (height - pad * 2);
        return `<line x1="${pad}" y1="${targetY}" x2="${width - pad}" y2="${targetY}" class="weight-target-line"></line>
          <text x="${width - pad}" y="${Math.max(14, targetY - 7)}" text-anchor="end" class="weight-target-label">Target ${targetWeight} kg</text>`;
      })() : ""}
      <polygon points="${area}" class="weight-area"></polygon>
      <polyline points="${polyline}" class="weight-line"></polyline>
      ${points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="6"><title>${displayWeightDate(point.date)}: ${point.weight} kg</title></circle>`).join("")}
      <text x="${pad}" y="${pad - 10}">${maxWeight} kg</text>
      <text x="${pad}" y="${height - 10}">${minWeight} kg</text>
    </svg>
  `;

  history.innerHTML = entries.slice().reverse().map((entry) => `
    <article class="weight-row">
      <strong>${displayWeightDate(entry.date)}</strong>
      <span>${entry.weight} kg</span>
      <button class="text-button danger-button" data-delete-weight="${escapeHtml(entry.id)}" type="button">Delete</button>
    </article>
  `).join("");
}

function displayWeightDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value || "");
}

function normalizeWeightDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return todayDateKey();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return "";
  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function saveWeightEntry() {
  const status = document.querySelector("#weightSaveStatus");
  const memberNames = familyMemberNames();
  const person = memberNames.includes(state.privatePerson) ? state.privatePerson : primaryFamilyMember();
  const date = normalizeWeightDate(document.querySelector("#weightDate").value);
  const weight = Number(document.querySelector("#weightValue").value || 0);
  if (!date) {
    status.textContent = "Use a date like 12/05/2026.";
    return;
  }
  if (weight <= 0) {
    status.textContent = "Enter a weight above 0.";
    return;
  }
  const existing = (state.privateWeights || []).find((entry) => entry.date === date && (entry.person || person) === person);
  if (existing) {
    existing.weight = weight;
  } else {
    state.privateWeights ||= [];
    state.privateWeights.push({
      id: `weight-${slugify(person)}-${date}-${Date.now().toString(36)}`,
      person,
      date,
      weight
    });
  }
  state.privateWeights.sort((a, b) => a.date.localeCompare(b.date));
  document.querySelector("#weightDate").value = displayWeightDate(date);
  document.querySelector("#weightValue").value = "";
  status.textContent = `Saved ${weight} kg for ${person} on ${displayWeightDate(date)}.`;
  saveState();
  render();
}

function saveWeightGoal() {
  const status = document.querySelector("#weightGoalStatus");
  const memberNames = familyMemberNames();
  const person = memberNames.includes(state.privatePerson) ? state.privatePerson : primaryFamilyMember();
  const rawValue = document.querySelector("#weightGoalValue").value.trim();
  state.privateWeightGoals ||= {};
  if (!rawValue) {
    delete state.privateWeightGoals[person];
    status.textContent = `Cleared the target weight for ${person}.`;
  } else {
    const target = Math.round(Number(rawValue) * 10) / 10;
    if (!Number.isFinite(target) || target <= 0) {
      status.textContent = "Enter a target weight above 0.";
      return;
    }
    state.privateWeightGoals[person] = target;
    status.textContent = `Saved a ${target} kg target for ${person}.`;
  }
  saveState();
  render();
}

function printWeekPlanner() {
  const printDays = days;
  const hasPlannedWeek = printDays.some((day) => mealPlanSlots.some((slot) => plannerRecipeIds(day, slot.id).length));

  if (!hasPlannedWeek) {
    showToast("Add meals to the planner first, then print the weekly planner.", { type: "warning" });
    return;
  }

  const headerCells = printDays.map((day) => {
    const remaining = nutritionGoalRemainingForDay(day);
    return `
      <th>
        <strong>${escapeHtml(day)}</strong>
        <span>Household: ${formatPlannerNumber(plannedCaloriesForDay(day), "kcal")} / ${formatPlannerNumber(plannedProteinForDay(day), "protein")}</span>
        <span>Per person: ${formatPlannerNumber(plannedCaloriesPerPersonForDay(day), "kcal")} / ${formatPlannerNumber(plannedProteinPerPersonForDay(day), "protein")}</span>
        <em>${remaining.met ? "Goal met" : `Need ${formatPlannerNumber(remaining.calories, "kcal")} / ${formatPlannerNumber(remaining.protein, "protein")}`}</em>
      </th>
    `;
  }).join("");

  const printMealImage = (recipe, label) => {
    const imageUrl = resolveImageUrl(recipe?.imageUrl);
    if (imageUrl) {
      return `<span class="meal-print-image"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name)}"></span>`;
    }
    return `<span class="meal-print-image placeholder">${escapeHtml((label || "M").slice(0, 1))}</span>`;
  };

  const plannerRows = mealPlanSlots.map((slot) => `
    <tr>
      <th class="meal-label">
        ${escapeHtml(slot.label)}
        ${slot.timing ? `<small>${escapeHtml(slot.timing)}</small>` : ""}
      </th>
      ${printDays.map((day) => {
        const recipes = plannerRecipes(day, slot);
        const recipe = recipes[0];
        const calories = recipes.reduce((sum, item) => sum + caloriesPerServing(item) * plannerServingCount(day, slot.id, item.id), 0);
        const protein = recipes.reduce((sum, item) => sum + macrosPerServing(item).protein * plannerServingCount(day, slot.id, item.id), 0);
        return `
          <td>
            <div class="meal-print-cell">
              ${printMealImage(recipe, slot.label)}
              <div class="meal-print-text">
                ${recipes.length
                  ? recipes.map((item) => {
                    const servings = plannerServingCount(day, slot.id, item.id);
                    return `<strong>${escapeHtml(item.name)} (${servings} ${servings === 1 ? "person" : "people"})</strong>`;
                  }).join("")
                  : "<strong>Not planned</strong>"}
                ${recipes.length ? `<span>${formatPlannerNumber(calories, "kcal")} / ${formatPlannerNumber(protein, "protein")}</span>` : "<span>&nbsp;</span>"}
              </div>
            </div>
          </td>
        `;
      }).join("")}
    </tr>
  `).join("");

  const printWindow = window.open("", "_blank");
  if (!printWindow) {
    showToast("Your browser blocked the print window. Please allow pop-ups and try again.", { type: "error" });
    return;
  }

  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>Weekly Planner</title>
        <style>
          @page { size: A4 landscape; margin: 5mm; }
          * { box-sizing: border-box; }
          body { margin: 0; color: #121a2d; font-family: Arial, sans-serif; }
          h1 { margin: 0 0 5px; font-size: 18px; text-align: center; }
          table { width: 100%; min-height: 181mm; border-collapse: collapse; table-layout: fixed; }
          th, td { padding: 3px 4px; border: 1px solid #cfdacb; text-align: center; vertical-align: middle; }
          thead th { background: #eef7eb; text-align: center; }
          thead th strong { display: block; font-size: 10px; }
          th span, th em, td span, small { display: block; margin-top: 2px; color: #657181; font-size: 7px; font-style: normal; line-height: 1.16; }
          tbody tr { height: 19mm; }
          .meal-label { width: 11%; background: #f8fbf5; font-size: 8.5px; line-height: 1.12; text-align: center; vertical-align: middle; }
          .meal-print-cell { display: grid; justify-items: center; align-content: center; gap: 3px; min-height: 17mm; text-align: center; }
          .meal-print-image { display: grid; place-items: center; width: 42px; height: 38px; overflow: hidden; border-radius: 8px; color: #135f2f; background: #e8f7e4; font-size: 10px; font-weight: 800; }
          .meal-print-image img { display: block; width: 100%; height: 100%; object-fit: cover; }
          .meal-print-text { min-width: 0; max-width: 100%; }
          td strong { display: block; color: #071229; font-size: 7.6px; line-height: 1.05; overflow-wrap: anywhere; }
          @media print { body { margin: 0; } th, td { border-color: #c8d1c5; } }
        </style>
      </head>
      <body>
        <h1>Weekly Planner</h1>
        <table>
          <thead>
            <tr>
              <th>Meal</th>
              ${headerCells}
            </tr>
          </thead>
          <tbody>${plannerRows}</tbody>
        </table>
        <script>window.addEventListener("load", () => window.print());<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}

function configurationMemberRow(name = "", member = {}, originalName = "") {
  const role = member.role === "adult" ? "adult" : "child";
  const color = memberColorOptions.some((option) => option.value === member.color) ? member.color : "trevor";
  return `
    <article class="settings-member-row" data-config-member-row data-original-name="${escapeHtml(originalName)}">
      <label>
        Name
        <input data-config-member-name maxlength="40" value="${escapeHtml(name)}" required>
      </label>
      <label>
        Role
        <select data-config-member-role>
          <option value="adult" ${role === "adult" ? "selected" : ""}>Adult</option>
          <option value="child" ${role === "child" ? "selected" : ""}>Child</option>
        </select>
      </label>
      <label>
        Card colour
        <select data-config-member-color>
          ${memberColorOptions.map((option) => `<option value="${option.value}" ${color === option.value ? "selected" : ""}>${option.label}</option>`).join("")}
        </select>
      </label>
      <label class="settings-member-goal">
        Daily encouragement
        <input data-config-member-goal maxlength="100" value="${escapeHtml(member.goal || "")}" placeholder="A short family goal">
      </label>
      <button class="text-button danger-button settings-remove-member" data-remove-config-member type="button">Remove</button>
    </article>
  `;
}

function renderSettings() {
  const configuration = state.configuration || defaultConfiguration;
  const status = document.querySelector("#configurationStatus");
  status.textContent = "";
  status.classList.remove("error-text");
  document.querySelector("#configAppName").value = configuration.appName;
  document.querySelector("#configHouseholdName").value = configuration.householdName;
  document.querySelector("#configProfileName").value = configuration.profileName;
  document.querySelector("#configCalorieGoal").value = currentNutritionGoals().calories;
  document.querySelector("#configProteinGoal").value = currentNutritionGoals().protein;
  document.querySelector("#configMemberRows").innerHTML = Object.entries(state.kids || {})
    .map(([name, member]) => configurationMemberRow(name, member, name))
    .join("");
}

function configurationRows() {
  return [...document.querySelectorAll("[data-config-member-row]")];
}

function configurationError(message) {
  const status = document.querySelector("#configurationStatus");
  status.textContent = message;
  status.classList.add("error-text");
  return false;
}

function saveConfiguration() {
  const rows = configurationRows();
  if (!rows.length) return configurationError("Add at least one family member.");
  if (rows.length > 12) return configurationError("MacroVault supports up to 12 family members per household.");

  const memberDrafts = rows.map((row) => ({
    originalName: row.dataset.originalName || "",
    name: row.querySelector("[data-config-member-name]").value.trim(),
    role: row.querySelector("[data-config-member-role]").value,
    color: row.querySelector("[data-config-member-color]").value,
    goal: row.querySelector("[data-config-member-goal]").value.trim()
  }));
  if (memberDrafts.some((member) => !member.name)) return configurationError("Every family member needs a name.");
  if (memberDrafts.some((member) => ["__proto__", "prototype", "constructor"].includes(member.name.toLowerCase()))) {
    return configurationError("Choose a different family member name.");
  }
  const normalizedNames = memberDrafts.map((member) => member.name.toLocaleLowerCase());
  if (new Set(normalizedNames).size !== normalizedNames.length) return configurationError("Family member names must be unique.");

  const retainedOriginalNames = new Set(memberDrafts.map((member) => member.originalName).filter(Boolean));
  const removedNames = familyMemberNames().filter((name) => !retainedOriginalNames.has(name));
  const removedWithHistory = removedNames.filter((name) => (state.privateWeights || []).some((entry) => entry.person === name));
  if (removedWithHistory.length) {
    return configurationError(`Remove ${removedWithHistory.join(", ")}'s weight history before removing that family member.`);
  }

  const renameMap = new Map(memberDrafts.filter((member) => member.originalName).map((member) => [member.originalName, member.name]));
  const nextMembers = Object.fromEntries(memberDrafts.map((draft) => {
    const previous = state.kids?.[draft.originalName] || {};
    return [draft.name, {
      ...previous,
      role: draft.role === "adult" ? "adult" : "child",
      color: memberColorOptions.some((option) => option.value === draft.color) ? draft.color : "trevor",
      goal: draft.goal,
      stars: Number(previous.stars) || 0,
      ratings: previous.ratings || {},
      habits: previous.habits || {}
    }];
  }));

  state.kids = nextMembers;
  state.privateWeights = (state.privateWeights || []).map((entry) => ({
    ...entry,
    person: renameMap.get(entry.person) || entry.person
  }));
  const previousWeightGoals = state.privateWeightGoals || {};
  state.privateWeightGoals = Object.fromEntries(memberDrafts
    .map((member) => [member.name, Number(previousWeightGoals[member.originalName || member.name]) || 0])
    .filter(([, goal]) => goal > 0));
  state.privatePerson = renameMap.get(state.privatePerson) || (nextMembers[state.privatePerson] ? state.privatePerson : memberDrafts[0].name);
  const previousRewards = state.familyRewards || {};
  state.familyRewards = Object.fromEntries(memberDrafts.map((member) => [
    member.name,
    previousRewards[member.originalName || member.name] || { monthlyTarget: 20, reward: "" }
  ]));
  state.familyHabitHistory = Object.fromEntries(Object.entries(state.familyHabitHistory || {}).map(([dateKey, history]) => [
    dateKey,
    Object.fromEntries(memberDrafts
      .map((member) => [member.name, history?.[member.originalName || member.name]])
      .filter(([, entry]) => entry))
  ]));
  const previousExercise = state.healthExercise || {};
  state.healthExercise = { date: previousExercise.date || todayDateKey() };
  memberDrafts.forEach((member) => {
    state.healthExercise[member.name] = Math.max(0, Number(previousExercise[member.originalName || member.name]) || 0);
  });
  state.configuration = {
    appName: document.querySelector("#configAppName").value.trim(),
    householdName: document.querySelector("#configHouseholdName").value.trim(),
    profileName: document.querySelector("#configProfileName").value.trim()
  };
  state.nutritionGoals = {
    calories: Math.max(1, Number(document.querySelector("#configCalorieGoal").value) || defaultDailyNutritionGoals.calories),
    protein: Math.max(1, Number(document.querySelector("#configProteinGoal").value) || defaultDailyNutritionGoals.protein)
  };
  state = normalizeState(state);
  saveState();
  render();
  const status = document.querySelector("#configurationStatus");
  status.classList.remove("error-text");
  status.textContent = "Configuration saved to MacroVault.";
  showToast("Household configuration saved.", { type: "success" });
  return true;
}
