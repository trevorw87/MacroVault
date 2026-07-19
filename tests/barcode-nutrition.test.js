const assert = require("node:assert/strict");
const { normalizeNutrition, servingBasis } = require("../barcode-nutrition.js");

const per100 = normalizeNutrition({
  serving_quantity: 40,
  serving_quantity_unit: "g",
  nutriments: {
    "energy-kcal_100g": 500,
    proteins_100g: 8,
    carbohydrates_100g: 60,
    sugars_100g: 40,
    fiber_100g: 4,
    fat_100g: 25,
    sodium_100g: 0.25,
    "energy-kcal_serving": 200,
    proteins_serving: 3.2
  }
});
assert.deepEqual(per100.basis, { amount: 100, unit: "g", label: null });
assert.equal(per100.nutrition.calories, 500, "per-100g values must not be scaled to the serving size");
assert.equal(per100.nutrition.sodium, 250, "legacy Open Food Facts sodium must convert from grams to milligrams");

const perServing = normalizeNutrition({
  serving_quantity: 40,
  serving_quantity_unit: "g",
  serving_size: "1 bar (40 g)",
  nutriments: {
    "energy-kcal_serving": 200,
    proteins_serving: 3.2,
    carbohydrates_serving: 24,
    sugars_serving: 16,
    fiber_serving: 1.6,
    fat_serving: 10,
    sodium_serving: 0.1
  }
});
assert.deepEqual(perServing.basis, { amount: 40, unit: "g", label: "1 bar (40 g)" });
assert.equal(perServing.nutrition.calories, 200, "per-serving values must remain per serving");
assert.equal(perServing.nutrition.sodium, 100, "per-serving sodium must remain on the serving basis and convert to milligrams");

assert.deepEqual(servingBasis({ serving_size: "1 bar (45 g)" }), { amount: 45, unit: "g", label: "1 bar (45 g)" });

const structured = normalizeNutrition({
  nutrition: {
    aggregated_set: {
      per: "100g",
      per_quantity: 100,
      per_unit: "g",
      nutrients: {
        "energy-kcal": { value_computed: 120 },
        proteins: { value_computed: 4 },
        carbohydrates: { value_computed: 20 },
        sugars: { value_computed: 8 },
        fiber: { value_computed: 3 },
        fat: { value_computed: 2 },
        sodium: { value_computed: 75, unit: "mg" }
      }
    }
  }
});
assert.equal(structured.nutrition.calories, 120);
assert.equal(structured.nutrition.sodium, 75, "structured milligram sodium must not be converted twice");
assert.equal(structured.confidence, "high");

const invalid = normalizeNutrition({ nutriments: { carbohydrates_100g: 5, sugars_100g: 12 } });
assert.equal(invalid.confidence, "low");
assert.ok(invalid.warnings.some((warning) => warning.includes("Sugar is higher")));

console.log("Barcode nutrition normalization: PASS");
