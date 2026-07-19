(function attachBarcodeNutrition(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MacroVaultBarcode = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createBarcodeNutrition() {
  const nutrientKeys = {
    calories: ["energy-kcal"],
    protein: ["proteins", "protein"],
    carbs: ["carbohydrates", "carbs"],
    sugar: ["sugars", "sugar"],
    fibre: ["fiber", "fibre"],
    fat: ["fat"],
    sodium: ["sodium"]
  };

  function finiteNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value) {
    const number = finiteNumber(value) ?? 0;
    return Math.round(number * 10) / 10;
  }

  function sodiumMilligrams(value, unit = "g") {
    const number = finiteNumber(value);
    if (number === null) return null;
    return String(unit || "g").trim().toLowerCase() === "mg" ? number : number * 1000;
  }

  function normalizeUnit(value, fallback = "g") {
    const unit = String(value || "").trim().toLowerCase();
    if (/^(ml|millilitre|milliliter)s?$/.test(unit)) return "ml";
    if (/^(g|gram|gramme)s?$/.test(unit)) return "g";
    if (/^(each|item|piece|serving)s?$/.test(unit)) return "each";
    return fallback;
  }

  function servingBasis(product = {}) {
    const quantity = finiteNumber(product.serving_quantity);
    const unitText = product.serving_quantity_unit || product.serving_size || "";
    if (quantity && quantity > 0) {
      return { amount: quantity, unit: normalizeUnit(unitText, "g"), label: String(product.serving_size || "").trim() || null };
    }

    const servingText = String(product.serving_size || "");
    const metric = servingText.match(/(\d+(?:[.,]\d+)?)\s*(ml|millilit(?:re|er)s?|g|grams?|grammes?)/i);
    if (metric) {
      return { amount: Number(metric[1].replace(",", ".")), unit: normalizeUnit(metric[2]), label: servingText || null };
    }

    const count = servingText.match(/(\d+(?:[.,]\d+)?)\s*(?:piece|item|bar|bottle|can|pack|serving)/i);
    return { amount: count ? Number(count[1].replace(",", ".")) : 1, unit: "each", label: servingText || null };
  }

  function nutritionBasis(product = {}, suffix = "100g") {
    if (suffix === "serving") return servingBasis(product);
    const basisText = String(product.nutrition_data_per || product.nutrition_data_prepared_per || suffix).toLowerCase();
    const liquid = basisText.includes("ml") || normalizeUnit(product.product_quantity_unit, "") === "ml";
    return { amount: 100, unit: liquid ? "ml" : "g", label: null };
  }

  function legacyValue(nutriments, aliases, suffix) {
    for (const alias of aliases) {
      const value = finiteNumber(nutriments[`${alias}_${suffix}`]);
      if (value !== null) return value;
    }
    return null;
  }

  function legacyNutrition(product = {}) {
    const nutriments = product.nutriments || {};
    const suffixes = ["100g", "serving"];
    let suffix = suffixes.find((candidate) => Object.values(nutrientKeys).some((aliases) => legacyValue(nutriments, aliases, candidate) !== null));
    if (!suffix) suffix = String(product.nutrition_data_per || "").toLowerCase() === "serving" ? "serving" : "value";

    const values = {};
    const missing = [];
    for (const [name, aliases] of Object.entries(nutrientKeys)) {
      let value = suffix === "value"
        ? aliases.map((alias) => finiteNumber(nutriments[alias])).find((candidate) => candidate !== null)
        : legacyValue(nutriments, aliases, suffix);
      if (name === "calories" && value === null) {
        const energyKj = suffix === "value"
          ? finiteNumber(nutriments["energy-kj"] ?? nutriments.energy)
          : finiteNumber(nutriments[`energy-kj_${suffix}`] ?? nutriments[`energy_${suffix}`]);
        if (energyKj !== null) value = energyKj / 4.184;
      }
      if (name === "sodium" && value !== null) value = sodiumMilligrams(value);
      if (value === null) missing.push(name);
      values[name] = round(value);
    }

    const effectiveSuffix = suffix === "value" && String(product.nutrition_data_per || "").toLowerCase() === "serving" ? "serving" : suffix;
    return {
      nutrition: values,
      basis: nutritionBasis(product, effectiveSuffix),
      sourceBasis: effectiveSuffix === "serving" ? "serving" : "100",
      missing
    };
  }

  function structuredNutrition(product = {}) {
    const set = product.nutrition?.aggregated_set;
    if (!set?.nutrients) return null;
    const values = {};
    const missing = [];
    for (const [name, aliases] of Object.entries(nutrientKeys)) {
      let nutrient = aliases.map((alias) => set.nutrients[alias]).find(Boolean);
      let value = finiteNumber(nutrient?.value_computed ?? nutrient?.value);
      if (name === "calories" && value === null) {
        nutrient = set.nutrients["energy-kj"] || set.nutrients.energy;
        const energyKj = finiteNumber(nutrient?.value_computed ?? nutrient?.value);
        if (energyKj !== null) value = energyKj / 4.184;
      }
      if (name === "sodium" && value !== null) value = sodiumMilligrams(value, nutrient?.unit || nutrient?.unit_name);
      if (value === null) missing.push(name);
      values[name] = round(value);
    }

    const per = String(set.per || "100g").toLowerCase();
    const amount = finiteNumber(set.per_quantity) || (per === "serving" ? servingBasis(product).amount : 100);
    const unit = per === "serving"
      ? normalizeUnit(set.per_unit, servingBasis(product).unit)
      : normalizeUnit(set.per_unit || per.replace(/[\d.]/g, ""), "g");
    return {
      nutrition: values,
      basis: { amount, unit, label: per === "serving" ? String(product.serving_size || "").trim() || null : null },
      sourceBasis: per === "serving" ? "serving" : "100",
      missing
    };
  }

  function validateNutrition(normalized) {
    const { nutrition, basis, missing } = normalized;
    const warnings = [];
    if (missing.length) warnings.push(`Missing values: ${missing.join(", ")}.`);
    if (!Object.values(nutrition).some((value) => value > 0)) warnings.push("No usable nutrition values were supplied.");
    if (nutrition.sugar > nutrition.carbs + 0.2) warnings.push("Sugar is higher than total carbohydrate.");
    if (Object.values(nutrition).some((value) => value < 0)) warnings.push("One or more nutrition values are negative.");
    if (basis.amount === 100 && [nutrition.protein, nutrition.carbs, nutrition.fat].some((value) => value > 100.5)) {
      warnings.push(`A macronutrient exceeds 100 ${basis.unit} per 100 ${basis.unit}.`);
    }
    const macroCalories = nutrition.protein * 4 + nutrition.carbs * 4 + nutrition.fat * 9;
    if (nutrition.calories > 0 && macroCalories > 0) {
      const difference = Math.abs(nutrition.calories - macroCalories) / nutrition.calories;
      if (difference > 0.45) warnings.push("Calories differ substantially from the protein, carbohydrate and fat values.");
    }
    return warnings;
  }

  function normalizeNutrition(product = {}) {
    const normalized = structuredNutrition(product) || legacyNutrition(product);
    const warnings = validateNutrition(normalized);
    return {
      ...normalized,
      warnings,
      confidence: warnings.length === 0 ? "high" : warnings.some((warning) => /No usable|negative|exceeds|Sugar/.test(warning)) ? "low" : "medium"
    };
  }

  function rescaleNutrition(nutrition = {}, fromBasis = {}, toBasis = {}) {
    const fromAmount = finiteNumber(fromBasis.amount);
    const toAmount = finiteNumber(toBasis.amount);
    const fromUnit = normalizeUnit(fromBasis.unit, "");
    const toUnit = normalizeUnit(toBasis.unit, "");
    if (!fromAmount || fromAmount <= 0 || !toAmount || toAmount <= 0 || !fromUnit || fromUnit !== toUnit) return null;

    const scale = toAmount / fromAmount;
    return Object.fromEntries(Object.keys(nutrientKeys).map((name) => {
      const value = finiteNumber(nutrition[name]) ?? 0;
      return [name, Math.round(value * scale * 100) / 100];
    }));
  }

  return { normalizeNutrition, rescaleNutrition, servingBasis };
});
