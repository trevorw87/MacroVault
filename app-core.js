// MacroVault core state, persistence, nutrition, and shared helpers.
const { escapeHtml, safeHttpUrl, safeImageUrl, safeCssToken, stripIngredientBullet } = MacroVaultUtils;
const STORAGE_KEY = "macrovault.mvp.v1";
const BACKUP_KEY = `${STORAGE_KEY}.backup`;
const BACKUP_META_KEY = `${STORAGE_KEY}.backupMeta`;
const IMAGE_ASSET_PREFIX = "image-asset:";
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 75 * 1024;
const IMAGE_UPLOAD_MAX_SIDE = 520;
const IMAGE_UPLOAD_QUALITY = 0.62;
const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
const API_STATE_URL = "api/state";
let lastSaveWarning = "";
let serverStorageAvailable = false;
let serverSaveTimer = null;
let serverSaveInFlight = null;
let serverRevision = 0;
let serverConflictInFlight = null;

class ServerRequestError extends Error {
  constructor(message, status, payload = null) {
    super(message);
    this.name = "ServerRequestError";
    this.status = status;
    this.payload = payload;
  }
}

const tabs = [
  { id: "dashboard", label: "Dashboard", icon: "dashboard" },
  { id: "recipes", label: "Recipes", icon: "recipes" },
  { id: "ingredients", label: "Ingredients", icon: "ingredients" },
  { id: "planner", label: "Planner", icon: "planner" },
  { id: "shopping", label: "Shopping", icon: "shopping" },
  { id: "kids", label: "Family", icon: "family" },
  { id: "private", label: "Private", icon: "private" },
  { id: "site", label: "Site", icon: "storage" },
  { id: "settings", label: "Settings", icon: "settings" }
];

const iconPaths = {
  dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  recipes: '<path d="M6 3h11a2 2 0 0 1 2 2v16H7a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/><path d="M7 3v18M10 8h6M10 12h6"/>',
  ingredients: '<path d="M12 3c4 3 6 6 6 10a6 6 0 0 1-12 0c0-4 2-7 6-10Z"/><path d="M8.5 15.5c2-1 4-3 5.5-6"/>',
  planner: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  shopping: '<path d="M6 8h15l-2 8H8L6 4H3"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  family: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2"/><path d="M3 20c0-4 2-7 6-7s6 3 6 7M15 15c3 0 5 2 5 5"/>',
  private: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  storage: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21H9.6v-.09A1.7 1.7 0 0 0 8.5 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.1 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H2V9.6h.09A1.7 1.7 0 0 0 3.6 8.5a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8 4.1a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V2h4v.09A1.7 1.7 0 0 0 14.5 3.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 18.9 8c.12.39.35.74.66 1 .3.25.69.4 1.1.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/>'
};

function iconMarkup(name) {
  return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || ""}</svg>`;
}

const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const mealPlanSlots = [
  { id: "beforeBreakfastDrink", label: "Beverages", category: "hotBeverage", timing: "Before Breakfast" },
  { id: "breakfast", label: "Breakfast", category: "breakfast" },
  { id: "morningSnack", label: "Morning Snack", category: "morningSnack" },
  { id: "lunch", label: "Lunch", category: "lunch" },
  { id: "afterLunchDrink", label: "Beverages", category: "hotBeverage", timing: "After Lunch" },
  { id: "afternoonSnack", label: "Afternoon Snack", category: "afternoonSnack" },
  { id: "dinner", label: "Dinner", category: "dinner" },
  { id: "eveningSnack", label: "After Dinner Treat", category: "afterDinnerTreat" },
  { id: "afterTreatDrink", label: "Beverages", category: "hotBeverage", timing: "After Dinner Treat" }
];

const recipeCategories = [
  { id: "hotBeverage", label: "Hot Beverage" },
  { id: "breakfast", label: "Breakfast" },
  { id: "morningSnack", label: "Morning Snack" },
  { id: "lunch", label: "Lunch" },
  { id: "afternoonSnack", label: "Afternoon Snack" },
  { id: "dinner", label: "Dinner" },
  { id: "afterDinnerTreat", label: "After Dinner Treat" }
];

const defaultDailyNutritionGoals = {
  calories: 2000,
  protein: 130
};

const defaultConfiguration = {
  appName: "MacroVault",
  householdName: "Healthy Family",
  profileName: "Ashley"
};

const memberColorOptions = [
  { value: "amelia", label: "Pink" },
  { value: "spencer", label: "Blue" },
  { value: "trevor", label: "Green" },
  { value: "ashley", label: "Purple" }
];

const kidHabitTargets = [
  { id: "vegetables", label: "Vegetables", target: 5, icon: "veg" },
  { id: "fruit", label: "Fruit", target: 2, icon: "fruit" },
  { id: "yoghurt", label: "Yoghurt", target: 1, icon: "yoghurt" },
  { id: "water", label: "Water", target: 2, icon: "water" },
  { id: "multivitamin", label: "Multivitamin", target: 1, icon: "vitamin" },
  { id: "exercise", label: "Exercise", target: 1, icon: "exercise" }
];

const childRoutineTargets = [
  { id: "makeBed", label: "Make bed", target: 1, icon: "bed" },
  { id: "brushTeethMorning", label: "Brush teeth (morning)", target: 1, icon: "teeth" },
  { id: "showerBath", label: "Shower / bath", target: 1, icon: "bath" },
  { id: "brushTeethNight", label: "Brush teeth (night)", target: 1, icon: "teeth" },
  { id: "goodnightStory", label: "Goodnight story", target: 1, icon: "story" }
];

function habitDefinitionsForMember(name, member = null) {
  const child = member?.role ? member.role === "child" : ["Amelia", "Spencer"].includes(name);
  return child ? [...kidHabitTargets, ...childRoutineTargets] : kidHabitTargets;
}

function habitTargetForPerson(name, habit, member = null) {
  const adult = member?.role ? member.role === "adult" : ["Trevor", "Ashley"].includes(name);
  return habit.id === "water" && adult ? 8 : habit.target;
}

function familyHabitTargetsForPerson(name) {
  const member = state.kids?.[name];
  return habitDefinitionsForMember(name, member).map((habit) => ({
    ...habit,
    target: habitTargetForPerson(name, habit, member)
  }));
}

const defaultFamilyMembers = {
  Amelia: { color: "amelia", role: "child", goal: "Try one colourful vegetable", stars: 4, ratings: { "hidden-veg-pasta": 5, "pizza-wraps": 5 } },
  Spencer: { color: "spencer", role: "child", goal: "Help choose one snack food", stars: 3, ratings: { "taco-bowls": 4, "pizza-wraps": 5 } },
  Trevor: { color: "trevor", role: "adult", goal: "Move your body today", stars: 0, ratings: {} },
  Ashley: { color: "ashley", role: "adult", goal: "Take vitamins and hydrate", stars: 0, ratings: {} }
};

const categoryRules = [
  { category: "Protein", matches: ["salmon", "mince", "chicken", "ham", "beef"] },
  { category: "Produce", matches: ["lemon", "garlic", "beans", "lettuce", "tomatoes", "carrot", "zucchini", "capsicum", "onion", "celery", "pineapple", "corn"] },
  { category: "Staples", matches: ["rice", "pasta", "wraps", "tomato paste", "tomatoes", "lentils", "black beans", "olive oil"] },
  { category: "Dairy", matches: ["cheese", "yoghurt", "parmesan"] }
];

const macroRules = [
  { match: ["salmon"], unit: "piece", serving: 150, protein: 33, carbs: 0, fat: 18 },
  { match: ["chicken thigh", "chicken breast", "chicken"], unit: "piece", serving: 160, protein: 38, carbs: 0, fat: 12 },
  { match: ["lean mince", "mince", "beef"], unit: "piece", serving: 150, protein: 35, carbs: 0, fat: 16 },
  { match: ["ham"], unit: "piece", serving: 80, protein: 14, carbs: 1, fat: 5 },
  { match: ["black beans"], unit: "cup", protein: 15, carbs: 41, fat: 1 },
  { match: ["lentils"], unit: "cup", protein: 18, carbs: 40, fat: 1 },
  { match: ["rice"], unit: "cup", protein: 4, carbs: 45, fat: 0 },
  { match: ["pasta"], unit: "cup", protein: 8, carbs: 43, fat: 1 },
  { match: ["wrap"], unit: "piece", protein: 5, carbs: 30, fat: 4 },
  { match: ["potato"], unit: "piece", protein: 4, carbs: 37, fat: 0 },
  { match: ["corn"], unit: "cup", protein: 5, carbs: 31, fat: 2 },
  { match: ["cheese", "parmesan"], unit: "cup", protein: 28, carbs: 4, fat: 36 },
  { match: ["greek yoghurt", "yoghurt", "yogurt"], unit: "cup", protein: 20, carbs: 8, fat: 4 },
  { match: ["egg"], unit: "piece", protein: 6, carbs: 1, fat: 5 },
  { match: ["olive oil", "oil"], unit: "tbsp", protein: 0, carbs: 0, fat: 14 },
  { match: ["tomato paste"], unit: "tbsp", protein: 1, carbs: 3, fat: 0 },
  { match: ["tomato", "carrot", "zucchini", "capsicum", "lettuce", "green beans", "peas", "onion", "celery", "pineapple", "lemon", "garlic"], unit: "cup", protein: 1, carbs: 8, fat: 0 }
];

const ingredientNutritionDefaults = [
  { match: ["salmon fillets", "salmon"], label: "Protein", servingAmount: 150, servingUnit: "g", calories: 280, protein: 34, carbs: 0, sugar: 0, fibre: 0, fat: 16 },
  { match: ["chicken thighs", "chicken thigh"], label: "Protein", servingAmount: 160, servingUnit: "g", calories: 255, protein: 28, carbs: 0, sugar: 0, fibre: 0, fat: 16 },
  { match: ["chicken breast"], label: "Protein", servingAmount: 100, servingUnit: "g", calories: 165, protein: 31, carbs: 0, sugar: 0, fibre: 0, fat: 4 },
  { match: ["lean mince", "mince"], label: "Protein", servingAmount: 100, servingUnit: "g", calories: 250, protein: 26, carbs: 0, sugar: 0, fibre: 0, fat: 15 },
  { match: ["beef"], label: "Protein", servingAmount: 100, servingUnit: "g", calories: 250, protein: 26, carbs: 0, sugar: 0, fibre: 0, fat: 15 },
  { match: ["ham"], label: "Protein", servingAmount: 80, servingUnit: "g", calories: 145, protein: 20, carbs: 2, sugar: 1, fibre: 0, fat: 6 },
  { match: ["egg", "boiled egg"], label: "Protein", servingAmount: 1, servingUnit: "each", calories: 78, protein: 6, carbs: 1, sugar: 0, fibre: 0, fat: 5 },
  { match: ["greek yoghurt", "yoghurt", "yogurt"], label: "Dairy", servingAmount: 170, servingUnit: "g", calories: 120, protein: 15, carbs: 9, sugar: 7, fibre: 0, fat: 3 },
  { match: ["fruit yoghurt"], label: "Dairy", servingAmount: 100, servingUnit: "g", calories: 115, protein: 5, carbs: 18, sugar: 14, fibre: 0, fat: 3 },
  { match: ["cheese cubes", "cheese"], label: "Dairy", servingAmount: 30, servingUnit: "g", calories: 110, protein: 7, carbs: 1, sugar: 0, fibre: 0, fat: 9 },
  { match: ["parmesan"], label: "Dairy", servingAmount: 25, servingUnit: "g", calories: 110, protein: 10, carbs: 1, sugar: 0, fibre: 0, fat: 7 },
  { match: ["rice"], label: "Staples", servingAmount: 1, servingUnit: "cup", calories: 205, protein: 4, carbs: 45, sugar: 0, fibre: 1, fat: 0 },
  { match: ["pasta"], label: "Staples", servingAmount: 1, servingUnit: "cup", calories: 220, protein: 8, carbs: 43, sugar: 1, fibre: 3, fat: 1 },
  { match: ["wraps", "wrap"], label: "Staples", servingAmount: 1, servingUnit: "each", calories: 160, protein: 5, carbs: 30, sugar: 2, fibre: 2, fat: 4 },
  { match: ["potatoes", "potato"], label: "Staples", servingAmount: 1, servingUnit: "each", calories: 160, protein: 4, carbs: 37, sugar: 2, fibre: 4, fat: 0 },
  { match: ["black beans"], label: "Staples", servingAmount: 1, servingUnit: "cup", calories: 227, protein: 15, carbs: 41, sugar: 1, fibre: 15, fat: 1 },
  { match: ["lentils"], label: "Staples", servingAmount: 1, servingUnit: "cup", calories: 230, protein: 18, carbs: 40, sugar: 4, fibre: 16, fat: 1 },
  { match: ["olive oil", "oil"], label: "Staples", servingAmount: 1, servingUnit: "tbsp", calories: 119, protein: 0, carbs: 0, sugar: 0, fibre: 0, fat: 14 },
  { match: ["tomato paste"], label: "Staples", servingAmount: 1, servingUnit: "tbsp", calories: 30, protein: 1, carbs: 7, sugar: 4, fibre: 1, fat: 0 },
  { match: ["apple slices"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 70, protein: 0, carbs: 18, sugar: 14, fibre: 3, fat: 0 },
  { match: ["grapes"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 80, protein: 1, carbs: 21, sugar: 15, fibre: 1, fat: 0 },
  { match: ["banana bread"], label: "Snack", servingAmount: 1, servingUnit: "each", calories: 170, protein: 3, carbs: 28, sugar: 14, fibre: 1, fat: 6 },
  { match: ["pineapple"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 82, protein: 1, carbs: 22, sugar: 16, fibre: 2, fat: 0 },
  { match: ["lemons", "lemon"], label: "Produce", servingAmount: 1, servingUnit: "each", calories: 17, protein: 1, carbs: 5, sugar: 1, fibre: 2, fat: 0 },
  { match: ["carrot sticks", "carrot"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 35, protein: 1, carbs: 8, sugar: 4, fibre: 3, fat: 0 },
  { match: ["cucumber coins", "cucumber"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 16, protein: 1, carbs: 4, sugar: 2, fibre: 1, fat: 0 },
  { match: ["frozen peas", "peas"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 65, protein: 5, carbs: 11, sugar: 4, fibre: 4, fat: 0 },
  { match: ["green beans"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 31, protein: 2, carbs: 7, sugar: 3, fibre: 3, fat: 0 },
  { match: ["corn"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 143, protein: 5, carbs: 31, sugar: 6, fibre: 4, fat: 2 },
  { match: ["lettuce"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 8, protein: 1, carbs: 2, sugar: 1, fibre: 1, fat: 0 },
  { match: ["tomatoes", "tomato"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 32, protein: 2, carbs: 7, sugar: 5, fibre: 2, fat: 0 },
  { match: ["zucchini"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 20, protein: 1, carbs: 4, sugar: 3, fibre: 1, fat: 0 },
  { match: ["capsicum"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 31, protein: 1, carbs: 7, sugar: 5, fibre: 3, fat: 0 },
  { match: ["red onion", "onion"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 45, protein: 1, carbs: 11, sugar: 5, fibre: 2, fat: 0 },
  { match: ["celery"], label: "Produce", servingAmount: 1, servingUnit: "cup", calories: 14, protein: 1, carbs: 3, sugar: 1, fibre: 2, fat: 0 },
  { match: ["garlic"], label: "Produce", servingAmount: 1, servingUnit: "tbsp", calories: 13, protein: 1, carbs: 3, sugar: 0, fibre: 0, fat: 0 },
  { match: ["homemade muffin"], label: "Snack", servingAmount: 1, servingUnit: "each", calories: 180, protein: 4, carbs: 28, sugar: 14, fibre: 2, fat: 7 },
  { match: ["rice crackers"], label: "Snack", servingAmount: 1, servingUnit: "each", calories: 95, protein: 2, carbs: 18, sugar: 1, fibre: 1, fat: 2 },
  { match: ["mini cookie"], label: "Snack", servingAmount: 1, servingUnit: "each", calories: 80, protein: 1, carbs: 12, sugar: 6, fibre: 0, fat: 3 },
  { match: ["popcorn"], label: "Snack", servingAmount: 3, servingUnit: "cup", calories: 90, protein: 3, carbs: 15, sugar: 0, fibre: 3, fat: 3 },
  { match: ["tiny chocolate"], label: "Snack", servingAmount: 1, servingUnit: "each", calories: 55, protein: 1, carbs: 7, sugar: 6, fibre: 1, fat: 3 }
];

const ingredientUnits = ["each", "g", "ml", "cup", "tbsp", "tsp"];
const unitAliases = {
  g: "g",
  gram: "g",
  grams: "g",
  kg: "g",
  kilogram: "g",
  kilograms: "g",
  ml: "ml",
  millilitre: "ml",
  millilitres: "ml",
  milliliter: "ml",
  milliliters: "ml",
  l: "ml",
  litre: "ml",
  litres: "ml",
  liter: "ml",
  liters: "ml",
  cup: "cup",
  cups: "cup",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  each: "each",
  piece: "each",
  pieces: "each",
  slice: "each",
  slices: "each",
  clove: "each",
  cloves: "each",
  can: "each",
  cans: "each",
  packet: "each",
  packets: "each",
  bunch: "each",
  bunches: "each",
  fillet: "each",
  fillets: "each",
  breast: "each",
  breasts: "each",
  thigh: "each",
  thighs: "each",
  egg: "each",
  eggs: "each"
};

const defaultSnackRecipes = [
  { id: "drink-tea", name: "Tea", category: "hotBeverage", tags: ["hot drink", "tea"], ingredients: ["tea"], method: "Serve hot.", calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, favourite: false, art: "drink" },
  { id: "drink-coffee", name: "Coffee", category: "hotBeverage", tags: ["hot drink", "coffee"], ingredients: ["coffee"], method: "Serve hot.", calories: 0, macros: { protein: 0, carbs: 0, fat: 0 }, favourite: false, art: "drink" },
  { id: "drink-hot-chocolate", name: "Hot Chocolate", category: "hotBeverage", categories: ["hotBeverage", "afterDinnerTreat"], tags: ["hot drink", "treat"], ingredients: ["hot chocolate"], method: "Serve warm.", calories: 120, macros: { protein: 4, carbs: 22, fat: 3 }, favourite: false, art: "drink" },
  { id: "snack-apple-slices", name: "Apple Slices", category: "morningSnack", tags: ["snack", "fruit"], ingredients: ["apple slices"], method: "Slice and serve.", macros: { protein: 0, carbs: 18, fat: 0 }, favourite: false, art: "snack" },
  { id: "snack-carrot-sticks", name: "Carrot Sticks", category: "morningSnack", tags: ["snack", "vegetable"], ingredients: ["carrot sticks"], method: "Slice and serve.", macros: { protein: 1, carbs: 8, fat: 0 }, favourite: false, art: "snack" },
  { id: "snack-cucumber-coins", name: "Cucumber Coins", category: "morningSnack", tags: ["snack", "vegetable"], ingredients: ["cucumber"], method: "Slice into coins.", macros: { protein: 1, carbs: 4, fat: 0 }, favourite: false, art: "snack" },
  { id: "snack-frozen-peas-cup", name: "Frozen Peas Cup", category: "afternoonSnack", tags: ["snack", "vegetable"], ingredients: ["frozen peas"], method: "Serve chilled or lightly warmed.", macros: { protein: 5, carbs: 11, fat: 0 }, favourite: false, art: "snack" },
  { id: "snack-grapes", name: "Grapes", category: "morningSnack", tags: ["snack", "fruit"], ingredients: ["grapes"], method: "Wash and serve.", macros: { protein: 1, carbs: 21, fat: 0 }, favourite: false, art: "snack" },
  { id: "snack-greek-yoghurt", name: "Greek Yoghurt", category: "breakfast", tags: ["snack", "protein"], ingredients: ["Greek yoghurt"], method: "Serve chilled.", macros: { protein: 15, carbs: 9, fat: 3 }, favourite: false, art: "snack" },
  { id: "snack-cheese-cubes", name: "Cheese Cubes", category: "afternoonSnack", tags: ["snack", "protein"], ingredients: ["cheese cubes"], method: "Portion and serve.", macros: { protein: 7, carbs: 1, fat: 9 }, favourite: false, art: "snack" },
  { id: "snack-boiled-egg", name: "Boiled Egg", category: "breakfast", tags: ["snack", "protein"], ingredients: ["egg"], method: "Boil, cool, and peel.", macros: { protein: 6, carbs: 1, fat: 5 }, favourite: false, art: "snack" },
  { id: "snack-homemade-muffin", name: "Homemade Muffin", category: "afternoonSnack", tags: ["snack", "baking"], ingredients: ["homemade muffin"], method: "Serve one muffin.", macros: { protein: 4, carbs: 28, fat: 7 }, favourite: false, art: "snack" },
  { id: "snack-rice-crackers", name: "Rice Crackers", category: "afternoonSnack", tags: ["snack", "crunchy"], ingredients: ["rice crackers"], method: "Portion and serve.", macros: { protein: 2, carbs: 18, fat: 2 }, favourite: false, art: "snack" },
  { id: "snack-mini-cookie", name: "Mini Cookie", category: "afterDinnerTreat", tags: ["snack", "treat"], ingredients: ["mini cookie"], method: "Serve one small cookie.", macros: { protein: 1, carbs: 12, fat: 3 }, favourite: false, art: "snack" },
  { id: "snack-popcorn", name: "Popcorn", category: "afternoonSnack", tags: ["snack", "crunchy"], ingredients: ["popcorn"], method: "Portion and serve.", macros: { protein: 3, carbs: 15, fat: 3 }, favourite: false, art: "snack" },
  { id: "snack-fruit-yoghurt", name: "Fruit Yoghurt", category: "afterDinnerTreat", tags: ["snack", "dairy"], ingredients: ["fruit yoghurt"], method: "Serve chilled.", macros: { protein: 5, carbs: 18, fat: 3 }, favourite: false, art: "snack" },
  { id: "snack-banana-bread", name: "Banana Bread", category: "afterDinnerTreat", tags: ["snack", "baking"], ingredients: ["banana bread"], method: "Serve one slice.", macros: { protein: 3, carbs: 28, fat: 6 }, favourite: false, art: "snack" },
  { id: "snack-tiny-chocolate", name: "Tiny Chocolate", category: "afterDinnerTreat", tags: ["snack", "treat"], ingredients: ["tiny chocolate"], method: "Serve one small piece.", macros: { protein: 1, carbs: 7, fat: 3 }, favourite: false, art: "snack" }
];

const defaultMealRecipes = [
  {
    id: "lemon-salmon",
    name: "Lemon Garlic Salmon",
    category: "dinner",
    tags: ["20 minutes", "family favourite", "omega 3"],
    ingredients: ["salmon fillets", "lemons", "olive oil", "garlic", "green beans", "rice"],
    method: "Bake salmon with lemon, garlic, and olive oil. Serve with rice and green beans.",
    macros: { protein: 34, carbs: 42, fat: 18 },
    favourite: true,
    art: "salmon"
  },
  {
    id: "taco-bowls",
    name: "Build Your Own Taco Bowls",
    category: "dinner",
    tags: ["kid approved", "batch cook", "colourful"],
    ingredients: ["lean mince", "black beans", "corn", "lettuce", "tomatoes", "rice", "cheese"],
    method: "Cook mince with spices. Set out toppings so everyone builds their own bowl.",
    macros: { protein: 31, carbs: 55, fat: 17 },
    favourite: true,
    art: "taco"
  },
  {
    id: "hidden-veg-pasta",
    name: "Hidden Veg Pasta",
    category: "dinner",
    tags: ["meal prep", "budget", "freezer"],
    ingredients: ["pasta", "tomatoes", "carrot", "zucchini", "lentils", "cheese"],
    method: "Simmer vegetables and lentils into a sauce, blend until smooth, and toss with pasta.",
    macros: { protein: 21, carbs: 68, fat: 12 },
    favourite: true,
    art: "pasta"
  },
  {
    id: "chicken-traybake",
    name: "Chicken Traybake",
    category: "dinner",
    tags: ["one pan", "leftovers", "easy"],
    ingredients: ["chicken thighs", "potatoes", "capsicum", "red onion", "olive oil", "Greek yoghurt"],
    method: "Roast chicken and vegetables on one tray. Serve with yoghurt sauce.",
    macros: { protein: 38, carbs: 44, fat: 20 },
    favourite: false,
    art: "tray"
  },
  {
    id: "pizza-wraps",
    name: "Pizza Wraps",
    category: "lunch",
    tags: ["kid approved", "quick meal", "15 minutes"],
    ingredients: ["wraps", "tomato paste", "cheese", "ham", "capsicum", "pineapple"],
    method: "Top wraps, grill until bubbling, slice into wedges.",
    macros: { protein: 19, carbs: 48, fat: 16 },
    favourite: false,
    art: "pizza"
  },
  {
    id: "slow-cooker-beef",
    name: "Slow Cooker Beef Ragu",
    category: "dinner",
    tags: ["slow cooker", "freezer", "weekend"],
    ingredients: ["beef", "tomatoes", "carrot", "celery", "pasta", "parmesan"],
    method: "Slow cook beef with vegetables and tomatoes. Shred and serve with pasta.",
    macros: { protein: 36, carbs: 58, fat: 19 },
    favourite: false,
    art: "ragu"
  }
];

const defaultRecipeSeeds = [...defaultSnackRecipes, ...defaultMealRecipes];
const legacySnackNameToId = Object.fromEntries(defaultSnackRecipes.map((recipe) => [recipe.name.toLowerCase(), recipe.id]));
const defaultRecipeCategoryById = {
  "drink-tea": "hotBeverage",
  "drink-coffee": "hotBeverage",
  "drink-hot-chocolate": "hotBeverage",
  "snack-apple-slices": "morningSnack",
  "snack-carrot-sticks": "morningSnack",
  "snack-cucumber-coins": "morningSnack",
  "snack-frozen-peas-cup": "afternoonSnack",
  "snack-grapes": "morningSnack",
  "snack-greek-yoghurt": "breakfast",
  "snack-cheese-cubes": "afternoonSnack",
  "snack-boiled-egg": "breakfast",
  "snack-homemade-muffin": "afternoonSnack",
  "snack-rice-crackers": "afternoonSnack",
  "snack-mini-cookie": "afterDinnerTreat",
  "snack-popcorn": "afternoonSnack",
  "snack-fruit-yoghurt": "afterDinnerTreat",
  "snack-banana-bread": "afterDinnerTreat",
  "snack-tiny-chocolate": "afterDinnerTreat",
  "lemon-salmon": "dinner",
  "taco-bowls": "dinner",
  "hidden-veg-pasta": "dinner",
  "chicken-traybake": "dinner",
  "pizza-wraps": "lunch",
  "slow-cooker-beef": "dinner"
};

const sampleState = {
  activeTab: "dashboard",
  configuration: structuredClone(defaultConfiguration),
  consumed: {},
  ingredients: [],
  privatePerson: "Ashley",
  privateWeightGoals: {},
  privateWeights: [],
  bought: [],
  planner: {
    Monday: { dinner: "lemon-salmon" },
    Tuesday: { dinner: "taco-bowls" },
    Wednesday: { dinner: "hidden-veg-pasta" },
    Thursday: { dinner: "chicken-traybake" },
    Friday: { lunch: "pizza-wraps" },
    Saturday: {},
    Sunday: { dinner: "slow-cooker-beef" }
  },
  kids: structuredClone(defaultFamilyMembers),
  recipes: [
    ...defaultRecipeSeeds
  ]
};

let state = normalizeState(structuredClone(sampleState));

function applyGenericNutritionFromUrlRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("applyGenericNutrition") !== "1") return;
  backupCurrentStorage("before generic nutrition update");
  const changed = applyGenericNutritionToIngredients(state, { force: true, refreshRecipeNutrition: true });
  const saved = saveState();
  sessionStorage.setItem(`${STORAGE_KEY}.genericNutritionStatus`, JSON.stringify({
    ok: saved,
    changed,
    updatedAt: new Date().toISOString()
  }));
  url.searchParams.delete("applyGenericNutrition");
  window.history.replaceState({}, "", url);
}

const navTabs = document.querySelector("#navTabs");
const pageTitle = document.querySelector("#pageTitle");
const views = Object.fromEntries(tabs.map((tab) => [tab.id, document.querySelector(`#${tab.id}View`)]));
const recipeDialog = document.querySelector("#recipeDialog");
const recipeForm = document.querySelector("#recipeForm");
const recipeImportDialog = document.querySelector("#recipeImportDialog");
const recipeImportForm = document.querySelector("#recipeImportForm");
const ingredientDialog = document.querySelector("#ingredientDialog");
const ingredientForm = document.querySelector("#ingredientForm");
const barcodeDialog = document.querySelector("#barcodeDialog");
const syncStatus = document.querySelector("#syncStatus");
const syncStatusText = document.querySelector("#syncStatusText");
const toastRegion = document.querySelector("#toastRegion");
const uiDialog = document.querySelector("#uiDialog");
const uiDialogForm = document.querySelector("#uiDialogForm");
let uiDialogResolver = null;
let barcodeDetector = null;
let barcodeStream = null;
let barcodeScanTimer = null;
let barcodeScanBusy = false;
let barcodeZxingReader = null;
let barcodeZxingControls = null;
let pendingImportedRecipe = null;
let tesseractLoadPromise = null;

function setSyncStatus(status, message) {
  if (!syncStatus || !syncStatusText) return;
  syncStatus.dataset.state = status;
  syncStatusText.textContent = message;
}

function showToast(message, { type = "info", duration = 5000 } = {}) {
  if (!toastRegion || !message) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  if (type === "error") toast.setAttribute("role", "alert");
  const indicator = document.createElement("span");
  indicator.className = "toast-indicator";
  indicator.setAttribute("aria-hidden", "true");
  const copy = document.createElement("p");
  copy.textContent = message;
  const close = document.createElement("button");
  close.className = "toast-close";
  close.type = "button";
  close.setAttribute("aria-label", "Dismiss notification");
  close.innerHTML = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  close.addEventListener("click", () => toast.remove());
  toast.append(indicator, copy, close);
  toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 180);
  }, duration);
}

function openUiDialog({ title, message, confirmLabel = "Continue", cancelLabel = "Cancel", tone = "default", input = null }) {
  if (uiDialogResolver) uiDialogResolver(null);
  document.querySelector("#uiDialogTitle").textContent = title;
  document.querySelector("#uiDialogMessage").textContent = message;
  document.querySelector("#uiDialogConfirm").textContent = confirmLabel;
  document.querySelector("#uiDialogCancel").textContent = cancelLabel;
  document.querySelector("#uiDialogConfirm").classList.toggle("danger-button", tone === "danger");
  const inputWrap = document.querySelector("#uiDialogInputWrap");
  const inputElement = document.querySelector("#uiDialogInput");
  inputWrap.hidden = !input;
  if (input) {
    document.querySelector("#uiDialogInputLabel").textContent = input.label || "Value";
    inputElement.type = input.type || "text";
    inputElement.inputMode = input.inputMode || "";
    inputElement.min = input.min ?? "";
    inputElement.step = input.step ?? "";
    inputElement.value = input.value ?? "";
  }
  uiDialog.showModal();
  requestAnimationFrame(() => (input ? inputElement : document.querySelector("#uiDialogConfirm")).focus());
  return new Promise((resolve) => {
    uiDialogResolver = resolve;
  });
}

uiDialogForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const confirmed = event.submitter?.value === "confirm";
  const result = confirmed
    ? (document.querySelector("#uiDialogInputWrap").hidden ? true : document.querySelector("#uiDialogInput").value)
    : null;
  const resolve = uiDialogResolver;
  uiDialogResolver = null;
  uiDialog.close();
  resolve?.(result);
});

uiDialog.addEventListener("close", () => {
  if (!uiDialogResolver) return;
  const resolve = uiDialogResolver;
  uiDialogResolver = null;
  resolve(null);
});

function restoreBackupFromUrlRequest() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("restoreBackup") !== "1") return;
  const current = localStorage.getItem(STORAGE_KEY);
  const backup = localStorage.getItem(BACKUP_KEY);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (current) {
    localStorage.setItem(`${STORAGE_KEY}.preRestore.${timestamp}`, current);
  }
  if (backup) {
    localStorage.setItem(STORAGE_KEY, backup);
    sessionStorage.setItem(`${STORAGE_KEY}.restoreStatus`, JSON.stringify({
      ok: true,
      restoredAt: new Date().toISOString(),
      preRestoreKey: current ? `${STORAGE_KEY}.preRestore.${timestamp}` : ""
    }));
  } else {
    sessionStorage.setItem(`${STORAGE_KEY}.restoreStatus`, JSON.stringify({
      ok: false,
      restoredAt: new Date().toISOString(),
      message: "No browser backup was found."
    }));
  }
  url.searchParams.delete("restoreBackup");
  window.history.replaceState({}, "", url);
}

restoreBackupFromUrlRequest();

function todayDateKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function currentMonthKey() {
  return todayDateKey().slice(0, 7);
}

function normalizedMonthKey(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || "")) ? String(value) : currentMonthKey();
}

function familyMemberNames(nextState = state) {
  return Object.keys(nextState?.kids || {});
}

function primaryFamilyMember(nextState = state) {
  const names = familyMemberNames(nextState);
  return names.includes(nextState?.privatePerson) ? nextState.privatePerson : names[0] || "Household member";
}

function emptyFamilyHabits(name, member = null) {
  return Object.fromEntries(habitDefinitionsForMember(name, member).map((habit) => [
    habit.id,
    Array.from({ length: habitTargetForPerson(name, habit, member) }, () => false)
  ]));
}

function resetFamilyHabits(nextState) {
  Object.entries(nextState.kids || {}).forEach(([name, kid]) => {
    kid.habits = emptyFamilyHabits(name, kid);
  });
}

function familyHabitProgress(nextState, name) {
  const member = nextState.kids?.[name];
  if (!member) return { completed: 0, target: 0, earned: false };
  const habits = habitDefinitionsForMember(name, member);
  const completed = habits.reduce((sum, habit) => sum + (member.habits?.[habit.id] || []).filter(Boolean).length, 0);
  const target = habits.reduce((sum, habit) => sum + habitTargetForPerson(name, habit, member), 0);
  return { completed, target, earned: target > 0 && completed >= target };
}

function recordFamilyHabitDay(nextState, dateKey, { force = false } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))) return;
  nextState.familyHabitHistory ||= {};
  nextState.familyHabitHistory[dateKey] ||= {};
  Object.entries(nextState.kids || {}).forEach(([name, member]) => {
    if (member.role !== "child") return;
    if (nextState.familyHabitHistory[dateKey][name]?.manual && !force) return;
    nextState.familyHabitHistory[dateKey][name] = {
      ...familyHabitProgress(nextState, name),
      manual: false
    };
  });
}

function ensureHealthExerciseForToday(nextState = state) {
  const todayKey = todayDateKey();
  const previous = nextState.healthExercise?.date === todayKey ? nextState.healthExercise : {};
  const nextExercise = { date: todayKey };
  familyMemberNames(nextState).forEach((name) => {
    nextExercise[name] = Math.max(0, Number(previous[name]) || 0);
  });
  const changed = JSON.stringify(nextState.healthExercise || {}) !== JSON.stringify(nextExercise);
  nextState.healthExercise = nextExercise;
  return changed;
}

function ensureFamilyHabitsForToday(nextState = state) {
  const todayKey = todayDateKey();
  if (!nextState.familyHabitDate) {
    nextState.familyHabitDate = todayKey;
    ensureHealthExerciseForToday(nextState);
    return false;
  }
  if (nextState.familyHabitDate === todayKey) return false;
  recordFamilyHabitDay(nextState, nextState.familyHabitDate);
  nextState.familyHabitDate = todayKey;
  resetFamilyHabits(nextState);
  ensureHealthExerciseForToday(nextState);
  return true;
}

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return loadBackupState() || normalizeState(structuredClone(sampleState));
  try {
    return normalizeState({ ...structuredClone(sampleState), ...JSON.parse(saved) });
  } catch {
    return loadBackupState() || normalizeState(structuredClone(sampleState));
  }
}

function stateWithoutEmbeddedImageData(value) {
  const snapshot = structuredClone(value || {});
  snapshot.imageLibrary = Object.fromEntries(Object.entries(snapshot.imageLibrary || {}).map(([id, asset]) => [id, {
    id: asset.id || id,
    contentType: asset.contentType || "",
    sizeBytes: Number(asset.sizeBytes) || Math.round(((asset.data || "").length * 0.75)),
    createdAt: asset.createdAt || todayDateKey()
  }]));
  return snapshot;
}

function stripLocalImagesForBackup(value) {
  if (!value || typeof value !== "object") return value;
  const backup = structuredClone(value);
  delete backup.imageLibrary;
  backup.recipes = (backup.recipes || []).map((recipe) => ({
    ...recipe,
    imageUrl: isEmbeddedImage(recipe.imageUrl) || isImageAssetRef(recipe.imageUrl) ? "" : recipe.imageUrl
  }));
  backup.ingredients = (backup.ingredients || []).map((ingredient) => ({
    ...ingredient,
    imageUrl: isEmbeddedImage(ingredient.imageUrl) || isImageAssetRef(ingredient.imageUrl) ? "" : ingredient.imageUrl
  }));
  return backup;
}

function backupMetadata(backup, reason, type) {
  return {
    reason,
    type,
    createdAt: new Date().toISOString(),
    recipeCount: backup.recipes?.length || 0,
    ingredientCount: backup.ingredients?.length || 0,
    imageLibraryCount: Object.keys(backup.imageLibrary || {}).length,
    recipeImageCount: (backup.recipes || []).filter((recipe) => recipe.imageUrl).length,
    ingredientImageCount: (backup.ingredients || []).filter((ingredient) => ingredient.imageUrl).length
  };
}

function backupStateSnapshot(snapshot, reason = "save") {
  if (!snapshot) return false;
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
    localStorage.setItem(BACKUP_META_KEY, JSON.stringify(backupMetadata(snapshot, reason, "full")));
    return true;
  } catch (error) {
    try {
      const backup = stripLocalImagesForBackup(snapshot);
      localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
      localStorage.setItem(BACKUP_META_KEY, JSON.stringify(backupMetadata(backup, reason, "lightweight")));
      lastSaveWarning = "Browser storage was too full for an image backup, so MacroVault saved a text-only emergency backup. Export a full backup now to protect uploaded images.";
      console.warn("Created lightweight MacroVault backup without uploaded images", error);
      return true;
    } catch (fallbackError) {
      console.warn("Unable to create MacroVault backup", fallbackError);
      return false;
    }
  }
}

function backupCurrentStorage(reason = "save") {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return false;
  try {
    return backupStateSnapshot(JSON.parse(saved), reason);
  } catch (error) {
    console.warn("Unable to read MacroVault state for backup", error);
    return false;
  }
}

function loadBackupState() {
  const backup = localStorage.getItem(BACKUP_KEY);
  if (!backup) return null;
  try {
    return normalizeState({ ...structuredClone(sampleState), ...JSON.parse(backup) });
  } catch (error) {
    console.warn("Unable to load MacroVault backup", error);
    return null;
  }
}

async function loadServerState() {
  const response = await fetch(API_STATE_URL, {
    headers: { Accept: "application/json" },
    cache: "no-store"
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`MacroVault database returned ${response.status}`);
  const payload = await response.json();
  if (!payload?.state || typeof payload.state !== "object") return null;
  serverStorageAvailable = true;
  serverRevision = Number(payload.revision) || 0;
  return normalizeState({ ...structuredClone(sampleState), ...payload.state });
}

async function requestServerJson(path, { method = "GET", body, acceptedStatuses = [] } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new ServerRequestError(
      payload?.message || `MacroVault database request returned ${response.status}`,
      response.status,
      payload
    );
  }
  return payload;
}

async function saveStateToServer(snapshot) {
  const result = await requestServerJson(API_STATE_URL, {
    method: "PUT",
    body: { state: snapshot, expectedRevision: serverRevision }
  });
  serverRevision = Number(result?.revision) || serverRevision;
  serverStorageAvailable = true;
  return result;
}

async function resolveServerConflict(localSnapshot) {
  if (serverConflictInFlight) return serverConflictInFlight;
  serverConflictInFlight = (async () => {
    backupStateSnapshot(stateWithoutEmbeddedImageData(localSnapshot), "sync conflict");
    const response = await requestServerJson(API_STATE_URL);
    const remoteState = normalizeState({ ...structuredClone(sampleState), ...response.state });
    serverRevision = Number(response.revision) || 0;
    setSyncStatus("error", "Changes found on another device");
    const keepLocal = await openUiDialog({
      title: "Changes on another device",
      message: "MacroVault stopped this save so newer data was not silently overwritten. Keep this device's version, or use the latest Home Assistant version? Your local version has been placed in the browser backup.",
      confirmLabel: "Keep this device",
      cancelLabel: "Use Home Assistant"
    });
    if (keepLocal) {
      const saved = await requestServerJson(API_STATE_URL, {
        method: "PUT",
        body: { state: localSnapshot, expectedRevision: serverRevision }
      });
      serverRevision = Number(saved?.revision) || serverRevision;
      setSyncStatus("saved", "Saved to Home Assistant");
      showToast("This device's version was saved after resolving the conflict.", { type: "success" });
      return;
    }

    state = remoteState;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stateWithoutEmbeddedImageData(remoteState)));
    render();
    setSyncStatus("saved", "Using latest Home Assistant data");
    showToast("Loaded the newer Home Assistant version. Your previous local version remains in the browser backup.");
  })().finally(() => {
    serverConflictInFlight = null;
  });
  return serverConflictInFlight;
}

function queueServerStateSave(snapshot) {
  const serverSnapshot = structuredClone(snapshot);
  clearTimeout(serverSaveTimer);
  setSyncStatus("saving", "Saving…");
  serverSaveTimer = setTimeout(() => {
    serverSaveInFlight = (serverSaveInFlight || Promise.resolve())
      .catch(() => undefined)
      .then(() => saveStateToServer(serverSnapshot))
      .then(() => setSyncStatus("saved", "Saved to Home Assistant"))
      .catch(async (error) => {
        if (error instanceof ServerRequestError && error.status === 409) {
          await resolveServerConflict(serverSnapshot);
          return;
        }
        serverStorageAvailable = false;
        setSyncStatus("local", navigator.onLine ? "Saved in this browser" : "Offline — saved locally");
        console.warn("Unable to save MacroVault state to the server database", error);
      });
  }, 250);
}

async function initializeStateFromStorage() {
  const browserState = loadState();
  try {
    const serverState = await loadServerState();
    if (serverState) {
      state = serverState;
      setSyncStatus("saved", "Saved to Home Assistant");
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(serverState));
        backupStateSnapshot(serverState, "after server load");
      } catch (error) {
        console.warn("Unable to refresh browser backup from MacroVault database", error);
      }
      return;
    }
    state = browserState;
    queueServerStateSave(state);
  } catch (error) {
    serverStorageAvailable = false;
    setSyncStatus("local", navigator.onLine ? "Saved in this browser" : "Offline — saved locally");
    console.warn("Using browser storage because the MacroVault database is unavailable", error);
    state = browserState;
  }
}

function normalizeState(nextState) {
  delete nextState.pantry;
  delete nextState.lunchboxes;
  nextState.configuration = {
    ...defaultConfiguration,
    ...(nextState.configuration || {})
  };
  nextState.configuration.appName = String(nextState.configuration.appName || defaultConfiguration.appName).trim().slice(0, 40);
  nextState.configuration.householdName = String(nextState.configuration.householdName || defaultConfiguration.householdName).trim().slice(0, 60);
  nextState.configuration.profileName = String(nextState.configuration.profileName || defaultConfiguration.profileName).trim().slice(0, 40);
  nextState.imageLibrary ||= {};
  nextState.nutritionGoals = {
    ...defaultDailyNutritionGoals,
    ...(nextState.nutritionGoals || {})
  };
  nextState.nutritionGoals.calories = Math.max(0, Number(nextState.nutritionGoals.calories) || defaultDailyNutritionGoals.calories);
  nextState.nutritionGoals.protein = Math.max(0, Number(nextState.nutritionGoals.protein) || defaultDailyNutritionGoals.protein);
  if (!tabs.some((tab) => tab.id === nextState.activeTab)) {
    nextState.activeTab = "dashboard";
  }
  nextState.recipes = [...(nextState.recipes || [])];
  defaultRecipeSeeds.forEach((defaultRecipe) => {
    if (!nextState.recipes.some((recipe) => recipe.id === defaultRecipe.id)) {
      nextState.recipes.push(structuredClone(defaultRecipe));
    }
  });
  nextState.recipes = nextState.recipes.map((recipe) => {
    const normalizedRecipe = normalizeRecipeIngredientQuantities(recipe);
    return {
      ...normalizedRecipe,
      originalIngredients: Array.isArray(normalizedRecipe.originalIngredients)
        ? normalizedRecipe.originalIngredients.map((item) => String(item || "").trim()).filter(Boolean)
        : String(normalizedRecipe.originalIngredients || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
      imageUrl: normalizedRecipe.imageUrl || "",
      category: recipeCategory(normalizedRecipe),
      categories: recipeCategoriesForRecipe(normalizedRecipe),
      prepared: Boolean(normalizedRecipe.prepared),
      servings: Math.max(1, Number(normalizedRecipe.servings) || 1),
      calories: Number(normalizedRecipe.calories) || caloriesFromMacros(normalizedRecipe.macros)
    };
  });
  syncIngredientsAndRecipeLinks(nextState);
  normalizeImageAssets(nextState);
  nextState.kids = nextState.kids && typeof nextState.kids === "object" && Object.keys(nextState.kids).length
    ? { ...nextState.kids }
    : structuredClone(defaultFamilyMembers);
  Object.entries(nextState.kids).forEach(([name, member], index) => {
    member.role = member.role === "adult" || member.role === "child"
      ? member.role
      : (["Trevor", "Ashley"].includes(name) ? "adult" : "child");
    member.color = memberColorOptions.some((option) => option.value === member.color)
      ? member.color
      : memberColorOptions[index % memberColorOptions.length].value;
  });
  nextState.familyHabitHistory = nextState.familyHabitHistory && typeof nextState.familyHabitHistory === "object"
    ? nextState.familyHabitHistory
    : {};
  nextState.familyRewards = nextState.familyRewards && typeof nextState.familyRewards === "object"
    ? nextState.familyRewards
    : {};
  nextState.rewardChartMonth = normalizedMonthKey(nextState.rewardChartMonth);
  ensureHealthExerciseForToday(nextState);
  const memberNames = familyMemberNames(nextState);
  if (!memberNames.includes(nextState.privatePerson)) {
    nextState.privatePerson = memberNames[0];
  }
  const savedWeightGoals = nextState.privateWeightGoals && typeof nextState.privateWeightGoals === "object"
    ? nextState.privateWeightGoals
    : {};
  nextState.privateWeightGoals = Object.fromEntries(memberNames
    .map((name) => [name, Math.round((Number(savedWeightGoals[name]) || 0) * 10) / 10])
    .filter(([, goal]) => goal > 0));
  nextState.privateWeights = (nextState.privateWeights || [])
    .map((entry) => ({
      id: entry.id || `weight-${entry.date || todayDateKey()}-${Date.now().toString(36)}`,
      person: memberNames.includes(entry.person) ? entry.person : nextState.privatePerson,
      date: normalizeWeightDate(entry.date),
      weight: Number(entry.weight) || 0
    }))
    .filter((entry) => entry.date && entry.weight > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  nextState.planner ||= {};
  days.forEach((day) => {
    if (typeof nextState.planner[day] === "string") {
      nextState.planner[day] = { dinner: nextState.planner[day] };
    }
    nextState.planner[day] ||= {};
    if (!nextState.planner[day].afterLunchDrink && nextState.planner[day].beforeLunchDrink) {
      nextState.planner[day].afterLunchDrink = nextState.planner[day].beforeLunchDrink;
    }
    if (!nextState.planner[day].afterTreatDrink && nextState.planner[day].afterDinnerDrink) {
      nextState.planner[day].afterTreatDrink = nextState.planner[day].afterDinnerDrink;
    }
    mealPlanSlots.forEach((slot) => {
      const storedRecipeIds = Array.isArray(nextState.planner[day][slot.id])
        ? nextState.planner[day][slot.id]
        : nextState.planner[day][slot.id] ? [nextState.planner[day][slot.id]] : [];
      nextState.planner[day][slot.id] = [...new Set(storedRecipeIds
        .map((recipeId) => {
          if (!["morningSnack", "afternoonSnack", "afterDinnerTreat"].includes(slot.category)) return String(recipeId || "");
          return legacySnackNameToId[String(recipeId || "").toLowerCase()] || String(recipeId || "");
        })
        .filter((recipeId) => {
          const plannedRecipe = nextState.recipes.find((recipe) => recipe.id === recipeId);
          return plannedRecipe && recipeBelongsToCategory(plannedRecipe, slot.category);
        }))];
    });
  });
  nextState.consumed ||= {};
  days.forEach((day) => {
    nextState.consumed[day] ||= {};
    mealPlanSlots.forEach((slot) => {
      nextState.consumed[day][slot.id] = Boolean(nextState.consumed[day][slot.id]);
    });
  });
  ensureFamilyHabitsForToday(nextState);
  Object.entries(nextState.kids || {}).forEach(([name, kid]) => {
    kid.stars = Math.min(5, Math.max(0, Number(kid.stars) || 0));
    kid.goal = String(kid.goal || "");
    kid.habits ||= {};
    habitDefinitionsForMember(name, kid).forEach((habit) => {
      const target = habitTargetForPerson(name, habit, kid);
      kid.habits[habit.id] ||= Array.from({ length: target }, () => false);
      kid.habits[habit.id] = Array.from({ length: target }, (_, index) => Boolean(kid.habits[habit.id][index]));
    });
  });
  Object.entries(nextState.kids || {}).forEach(([name, kid]) => {
    if (kid.role !== "child") return;
    const reward = nextState.familyRewards[name] || {};
    nextState.familyRewards[name] = {
      monthlyTarget: Math.min(31, Math.max(1, Number(reward.monthlyTarget) || 20)),
      reward: String(reward.reward || "").trim().slice(0, 80)
    };
  });
  Object.keys(nextState.familyRewards).forEach((name) => {
    if (nextState.kids?.[name]?.role !== "child") delete nextState.familyRewards[name];
  });
  recordFamilyHabitDay(nextState, todayDateKey());
  delete nextState.calories;
  return nextState;
}

function isEmbeddedImage(value) {
  return String(value || "").startsWith("data:image/");
}

function isImageAssetRef(value) {
  return String(value || "").startsWith(IMAGE_ASSET_PREFIX);
}

function imageAssetIdFromRef(value) {
  return isImageAssetRef(value) ? String(value).slice(IMAGE_ASSET_PREFIX.length) : "";
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function storeImageAsset(nextState, imageUrl) {
  if (!isEmbeddedImage(imageUrl)) return imageUrl || "";
  nextState.imageLibrary ||= {};
  const existing = Object.values(nextState.imageLibrary).find((asset) => asset.data === imageUrl);
  if (existing) return `${IMAGE_ASSET_PREFIX}${existing.id}`;
  const id = `img-${hashString(imageUrl)}`;
  nextState.imageLibrary[id] ||= {
    id,
    data: imageUrl,
    createdAt: todayDateKey()
  };
  return `${IMAGE_ASSET_PREFIX}${id}`;
}

function resolveImageUrl(imageUrl, nextState = state) {
  if (!isImageAssetRef(imageUrl)) return safeImageUrl(imageUrl);
  const id = imageAssetIdFromRef(imageUrl);
  const asset = nextState?.imageLibrary?.[id];
  if (!asset) return "";
  return safeImageUrl(asset.data || `api/images/${encodeURIComponent(id)}`);
}

function normalizeImageAssets(nextState = state) {
  nextState.imageLibrary ||= {};
  nextState.recipes = (nextState.recipes || []).map((recipe) => ({
    ...recipe,
    imageUrl: storeImageAsset(nextState, recipe.imageUrl)
  }));
  nextState.ingredients = (nextState.ingredients || []).map((ingredient) => ({
    ...ingredient,
    imageUrl: storeImageAsset(nextState, ingredient.imageUrl)
  }));
  pruneUnusedImageAssets(nextState);
  return nextState;
}

function imageAssetUsages(nextState = state) {
  const usages = {};
  (nextState.recipes || []).forEach((recipe) => {
    const id = imageAssetIdFromRef(recipe.imageUrl);
    if (!id) return;
    usages[id] ||= [];
    usages[id].push({ type: "Recipe", name: recipe.name || "Recipe" });
  });
  (nextState.ingredients || []).forEach((ingredient) => {
    const id = imageAssetIdFromRef(ingredient.imageUrl);
    if (!id) return;
    usages[id] ||= [];
    usages[id].push({ type: "Ingredient", name: ingredient.name || "Ingredient" });
  });
  return usages;
}

function pruneUnusedImageAssets(nextState = state) {
  nextState.imageLibrary ||= {};
  const usedIds = new Set(Object.keys(imageAssetUsages(nextState)));
  Object.keys(nextState.imageLibrary).forEach((id) => {
    if (!usedIds.has(id)) delete nextState.imageLibrary[id];
  });
}

function imageStorageSummary(nextState = state) {
  const usages = imageAssetUsages(nextState);
  return Object.values(nextState.imageLibrary || {}).map((asset) => ({
    ...asset,
    uses: usages[asset.id] || [],
    sizeKb: Math.round(((Number(asset.sizeBytes) || ((asset.data || "").length * 0.75)) / 1024) * 10) / 10
  })).sort((a, b) => b.sizeKb - a.sizeKb);
}

function missingImageAssetUsages(nextState = state) {
  const library = nextState.imageLibrary || {};
  return Object.entries(imageAssetUsages(nextState))
    // Server-backed assets intentionally contain metadata only. A reference is
    // broken only when its asset is absent from the library altogether.
    .filter(([id]) => !library[id])
    .flatMap(([id, uses]) => uses.map((use) => ({ id, ...use })));
}

function removeBrokenImageReferences(nextState = state) {
  const brokenIds = new Set(missingImageAssetUsages(nextState).map((asset) => asset.id));
  if (!brokenIds.size) return 0;
  let removed = 0;
  nextState.recipes = (nextState.recipes || []).map((recipe) => {
    if (!brokenIds.has(imageAssetIdFromRef(recipe.imageUrl))) return recipe;
    removed += 1;
    return { ...recipe, imageUrl: "" };
  });
  nextState.ingredients = (nextState.ingredients || []).map((ingredient) => {
    if (!brokenIds.has(imageAssetIdFromRef(ingredient.imageUrl))) return ingredient;
    removed += 1;
    return { ...ingredient, imageUrl: "" };
  });
  return removed;
}

function saveState({ skipBackup = false } = {}) {
  lastSaveWarning = "";
  const nextState = normalizeImageAssets(structuredClone(state));
  state = nextState;
  queueServerStateSave(nextState);
  const browserSnapshot = stateWithoutEmbeddedImageData(nextState);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(browserSnapshot));
    if (!skipBackup) backupStateSnapshot(browserSnapshot, "after save");
    return true;
  } catch (error) {
    pruneUnusedImageAssets(nextState);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(browserSnapshot));
      if (!skipBackup) backupStateSnapshot(browserSnapshot, "after reduced save");
      return true;
    } catch {
      // Keep the original error in the console because it carries the quota detail.
    }
    console.error("Unable to save MacroVault state", error);
    if (serverStorageAvailable) {
      lastSaveWarning = "MacroVault saved to the server database, but this browser could not refresh its local backup.";
      return true;
    }
    setSyncStatus("error", "Could not save changes");
    return false;
  }
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function recipeImageMarkup(recipe) {
  const imageUrl = resolveImageUrl(recipe.imageUrl);
  const fallback = recipeFallbackArtMarkup(recipe);
  if (imageUrl) {
    return `
      ${fallback}
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name)}" data-hide-on-error>
    `;
  }
  return fallback;
}

function recipeFallbackArtMarkup(recipe) {
  return `
    <div class="recipe-fallback-art recipe-fallback-art-${recipeArtType(recipe)}" aria-hidden="true">
      <span class="recipe-art-shape primary"></span>
      <span class="recipe-art-shape secondary"></span>
      <span class="recipe-art-shape accent"></span>
    </div>
  `;
}

function recipeArtType(recipe) {
  const art = String(recipe?.art || "").toLowerCase();
  if (["drink", "snack", "salmon", "taco", "pasta", "tray", "pizza", "ragu"].includes(art)) return art;
  const category = recipeCategory(recipe);
  if (category === "hotBeverage") return "drink";
  if (["morningSnack", "afternoonSnack", "afterDinnerTreat"].includes(category)) return "snack";
  return "meal";
}

function recipeById(id) {
  return (state.recipes || []).find((recipe) => recipe.id === id);
}

function plannerRecipeIds(day, slotId, nextState = state) {
  const stored = nextState.planner?.[day]?.[slotId];
  return (Array.isArray(stored) ? stored : stored ? [stored] : [])
    .map((recipeId) => String(recipeId || ""))
    .filter(Boolean);
}

function plannerRecipes(day, slot, nextState = state) {
  return plannerRecipeIds(day, slot.id, nextState)
    .map((recipeId) => (nextState.recipes || []).find((recipe) => recipe.id === recipeId))
    .filter(Boolean);
}

function ingredientById(id) {
  return (state.ingredients || []).find((ingredient) => ingredient.id === id);
}

function isSnackRecipe(recipe) {
  return recipeCategoriesForRecipe(recipe).some((category) => ["hotBeverage", "morningSnack", "afternoonSnack", "afterDinnerTreat"].includes(category));
}

function recipesForSlot(slot) {
  return state.recipes.filter((recipe) => recipeBelongsToCategory(recipe, slot.category));
}

function validRecipeCategoryIds(values) {
  const validIds = new Set(recipeCategories.map((category) => category.id));
  return [...new Set((values || []).filter((value) => validIds.has(value)))];
}

function inferredRecipeCategory(recipe) {
  const category = recipe?.category;
  if (recipeCategories.some((candidate) => candidate.id === category)) return category;
  if (defaultRecipeCategoryById[recipe?.id]) return defaultRecipeCategoryById[recipe.id];
  const tags = (recipe?.tags || []).map((tag) => tag.toLowerCase());
  if (tags.includes("hot drink") || tags.includes("tea") || tags.includes("coffee")) return "hotBeverage";
  if (tags.includes("treat")) return "afterDinnerTreat";
  if (tags.includes("baking") || tags.includes("crunchy")) return "afternoonSnack";
  if (tags.includes("snack")) return "morningSnack";
  return "dinner";
}

function recipeCategoriesForRecipe(recipe) {
  const explicit = validRecipeCategoryIds(Array.isArray(recipe?.categories) ? recipe.categories : []);
  if (explicit.length) return explicit;
  const seed = defaultRecipeSeeds.find((candidate) => candidate.id === recipe?.id);
  const seeded = validRecipeCategoryIds(seed?.categories || [seed?.category].filter(Boolean));
  if (seeded.length) return seeded;
  return [inferredRecipeCategory(recipe)];
}

function recipeBelongsToCategory(recipe, categoryId) {
  return recipeCategoriesForRecipe(recipe).includes(categoryId);
}

function recipeCategory(recipe) {
  return recipeCategoriesForRecipe(recipe)[0] || "dinner";
}

function cleanIngredientName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^\s*(\d+\s+\d+\/\d+|\d+\/\d+)\s*/i, "")
    .replace(/^\s*\/\d+\s*/i, "")
    .replace(/^\s*(\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])\s*/i, "")
    .replace(/^(cups?|tbsp|tablespoons?|tsp|teaspoons?|g|grams?|kg|kilograms?|ml|litres?|liters?|oz|ounces?|lb|lbs|pounds?|pieces?|slices?|cloves?|cans?|packets?|bunches?|fillets?|breasts?|thighs?)\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(chopped|diced|sliced|minced|fresh|frozen|large|small|medium|cooked|uncooked|beaten|divided|peeled|grated|crushed)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseQuantityNumber(value) {
  const fractionMap = {
    "¼": 0.25,
    "½": 0.5,
    "¾": 0.75,
    "⅓": 1 / 3,
    "⅔": 2 / 3,
    "⅛": 0.125,
    "⅜": 0.375,
    "⅝": 0.625,
    "⅞": 0.875
  };
  const normalized = String(value || "").trim();
  if (fractionMap[normalized]) return fractionMap[normalized];
  if (/^\d+\/\d+$/.test(normalized)) {
    const [top, bottom] = normalized.split("/").map(Number);
    return bottom ? top / bottom : 0;
  }
  return Number(normalized) || 0;
}

function parseIngredientLine(line) {
  const original = stripIngredientBullet(line);
  const quantityMatch = original.match(/^((?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]))?)\s*(?:x\s*)?([a-zA-Z]+)?\.?\s+(.+)$/);
  if (!quantityMatch) {
    return {
      name: cleanIngredientName(original) || original,
      usedAmount: 1,
      usedUnit: "each",
      hasQuantity: false
    };
  }

  const [, amountText, rawUnit = "", rawName] = quantityMatch;
  const amount = amountText.split(/\s+/).reduce((sum, part) => sum + parseQuantityNumber(part), 0);
  const normalizedUnit = unitAliases[rawUnit.toLowerCase()];
  const usedUnit = normalizedUnit || "each";
  const name = cleanIngredientName(normalizedUnit ? rawName : `${rawUnit} ${rawName}`);

  return {
    name: name || cleanIngredientName(original) || original,
    usedAmount: Math.round((amount || 1) * 100) / 100,
    usedUnit,
    hasQuantity: true
  };
}

function normalizeRecipeIngredientQuantities(recipe) {
  const ingredients = recipe.ingredients || [];
  const servings = Math.max(1, Number(recipe.servings) || 1);
  return {
    ...recipe,
    ingredients: ingredients.map(stripIngredientBullet).filter(Boolean),
    ingredientRefs: ingredients.map((line, index) => {
      const parsed = parseIngredientLine(line);
      const existingRef = recipe.ingredientRefs?.[index] || {};
      const existingAmount = Number(existingRef.usedAmount) || 0;
      const existingUnit = existingRef.usedUnit || "each";
      const shouldUseParsedQuantity = parsed.hasQuantity
        && (!existingAmount || (existingAmount === 1 && existingUnit === "each") || (existingAmount === servings && existingUnit === "each"));
      return {
        ...existingRef,
        line: parsed.name,
        usedAmount: shouldUseParsedQuantity ? parsed.usedAmount : existingRef.usedAmount,
        usedUnit: shouldUseParsedQuantity ? parsed.usedUnit : existingRef.usedUnit
      };
    })
  };
}

function ingredientKey(value) {
  const normalized = cleanIngredientName(value);
  if (!normalized) return "";
  if (normalized.endsWith("ies")) return normalized.slice(0, -3) + "y";
  if (normalized.endsWith("atoes")) return normalized.slice(0, -2);
  if (normalized.endsWith("oes")) return normalized.slice(0, -2);
  if (normalized.endsWith("ses")) return normalized.slice(0, -2);
  if (normalized.endsWith("s") && !/(ss|us)$/.test(normalized)) return normalized.slice(0, -1);
  return normalized;
}

function ingredientMatchesLine(ingredient, line) {
  const lineKey = ingredientKey(line);
  if (!lineKey) return false;
  const keys = [ingredient.name, ingredient.plural, ...(ingredient.aliases || [])].map(ingredientKey).filter(Boolean);
  return keys.some((key) => key === lineKey);
}

function findIngredientForLine(line, ingredients = state.ingredients) {
  return ingredients.find((ingredient) => ingredientMatchesLine(ingredient, line));
}

function ingredientDefaultForName(name) {
  const normalized = cleanIngredientName(name);
  return ingredientNutritionDefaults.find((candidate) => candidate.match.some((term) => normalized.includes(term)));
}

function nutritionFromDefault(defaultNutrition) {
  if (!defaultNutrition) return null;
  return {
    calories: roundNutrition(defaultNutrition.calories),
    protein: roundNutrition(defaultNutrition.protein),
    carbs: roundNutrition(defaultNutrition.carbs),
    sugar: roundNutrition(defaultNutrition.sugar),
    fibre: roundNutrition(defaultNutrition.fibre),
    fat: roundNutrition(defaultNutrition.fat),
    sodium: roundNutrition(defaultNutrition.sodium)
  };
}

function servingFromDefault(defaultNutrition) {
  return {
    amount: Math.max(0.1, Number(defaultNutrition?.servingAmount) || 1),
    unit: defaultNutrition?.servingUnit || "each"
  };
}

function ingredientNutritionEstimate(name) {
  const defaultNutrition = ingredientDefaultForName(name);
  if (defaultNutrition) {
    return nutritionFromDefault(defaultNutrition);
  }
  const normalized = cleanIngredientName(name);
  const rule = macroRules.find((candidate) => candidate.match.some((term) => normalized.includes(term)));
  const macros = rule
    ? { protein: Math.round(rule.protein), carbs: Math.round(rule.carbs), fat: Math.round(rule.fat) }
    : { protein: 0, carbs: 0, fat: 0 };
  return { calories: caloriesFromMacros(macros), ...macros, sugar: 0, fibre: 0, sodium: 0 };
}

function ingredientFromName(name) {
  const cleaned = cleanIngredientName(name);
  const displayName = cleaned ? cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase()) : String(name || "Ingredient");
  const defaultNutrition = ingredientDefaultForName(cleaned);
  return {
    id: `ingredient-${slugify(displayName)}-${Date.now().toString(36)}`,
    name: displayName,
    plural: "",
    description: "",
    barcode: "",
    imageUrl: "",
    label: defaultNutrition?.label || categoryForIngredient(displayName),
    onHand: false,
    serving: defaultNutrition ? servingFromDefault(defaultNutrition) : { amount: 1, unit: "each" },
    nutrition: ingredientNutritionEstimate(displayName)
  };
}

function hasNutritionValues(nutrition) {
  return Boolean(Number(nutrition?.calories) || Number(nutrition?.protein) || Number(nutrition?.carbs) || Number(nutrition?.fat) || Number(nutrition?.sugar) || Number(nutrition?.fibre) || Number(nutrition?.sodium));
}

function shouldRefreshGenericNutrition(ingredient, defaultNutrition) {
  if (!defaultNutrition) return false;
  const nutrition = ingredient.nutrition || {};
  if (!hasNutritionValues(nutrition)) return true;
  if ((Number(nutrition.fibre) || 0) === 0 && (Number(defaultNutrition.fibre) || 0) > 0) return true;
  if ((Number(nutrition.sugar) || 0) === 0 && (Number(defaultNutrition.sugar) || 0) > 0 && !ingredient.barcode) return true;
  const serving = ingredient.serving || {};
  return (!serving.unit || serving.unit === "each") && defaultNutrition.servingUnit && defaultNutrition.servingUnit !== "each";
}

function applyGenericNutritionToIngredient(ingredient, options = {}) {
  const defaultNutrition = ingredientDefaultForName(ingredient.name || "");
  if (!defaultNutrition) return { ingredient, changed: false };
  if (!options.force && !shouldRefreshGenericNutrition(ingredient, defaultNutrition)) {
    return { ingredient, changed: false };
  }
  return {
    changed: true,
    ingredient: {
      ...ingredient,
      label: ingredient.label || defaultNutrition.label || categoryForIngredient(ingredient.name),
      serving: servingFromDefault(defaultNutrition),
      nutrition: nutritionFromDefault(defaultNutrition)
    }
  };
}

function applyGenericNutritionToIngredients(nextState = state, options = {}) {
  let changed = 0;
  nextState.ingredients = (nextState.ingredients || []).map((ingredient) => {
    const result = applyGenericNutritionToIngredient(ingredient, options);
    if (result.changed) changed += 1;
    return result.ingredient;
  });
  if (changed && options.refreshRecipeNutrition !== false) {
    refreshAllRecipeNutritionFromIngredients(nextState);
  }
  return changed;
}

function normalizeIngredients(existingIngredients, recipes) {
  const byName = new Map();
  existingIngredients.forEach((ingredient) => {
    const originalName = ingredient.name || "Ingredient";
    const cleanedName = cleanIngredientName(originalName) || originalName;
    const name = cleanedName.replace(/\b\w/g, (letter) => letter.toUpperCase());
    const normalized = ingredientKey(name);
    const estimated = ingredientNutritionEstimate(name);
    const nutrition = hasNutritionValues(ingredient.nutrition) ? ingredient.nutrition : estimated;
    const defaultNutrition = ingredientDefaultForName(name);
    byName.set(normalized, {
      id: ingredient.id || `ingredient-${slugify(name)}-${Date.now().toString(36)}`,
      name,
      plural: ingredient.plural || "",
      aliases: ingredient.aliases || [],
      description: ingredient.description || "",
      barcode: ingredient.barcode || "",
      imageUrl: ingredient.imageUrl || "",
      label: ingredient.label || defaultNutrition?.label || categoryForIngredient(name),
      onHand: Boolean(ingredient.onHand),
      serving: {
        amount: Math.max(0.1, Number(ingredient.serving?.amount) || 1),
        unit: ingredient.serving?.unit || "each"
      },
      nutrition: {
        calories: roundNutrition(nutrition?.calories),
        protein: roundNutrition(nutrition?.protein),
        carbs: roundNutrition(nutrition?.carbs),
        sugar: roundNutrition(nutrition?.sugar),
        fibre: roundNutrition(nutrition?.fibre),
        fat: roundNutrition(nutrition?.fat),
        sodium: roundNutrition(nutrition?.sodium)
      }
    });
  });

  recipes.flatMap((recipe) => recipe.ingredients || []).forEach((ingredientLine) => {
    const cleaned = cleanIngredientName(ingredientLine);
    const key = ingredientKey(ingredientLine);
    if (cleaned && !byName.has(key)) {
      const ingredient = ingredientFromName(cleaned);
      byName.set(key, ingredient);
    }
  });

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function linkRecipesToIngredients(recipes, ingredients) {
  return recipes.map((recipe) => ({
    ...recipe,
    ingredientRefs: (recipe.ingredients || []).map((line, index) => {
      const existingRef = recipe.ingredientRefs?.[index];
      const existingIngredient = existingRef?.ingredientId
        ? ingredients.find((ingredient) => ingredient.id === existingRef.ingredientId)
        : null;
      const matchedIngredient = existingIngredient && ingredientMatchesLine(existingIngredient, line)
        ? existingIngredient
        : findIngredientForLine(line, ingredients);
      return {
        ...existingRef,
        line,
        ingredientId: matchedIngredient?.id || ""
      };
    })
  }));
}

function syncIngredientsAndRecipeLinks(nextState = state, options = {}) {
  nextState.ingredients = normalizeIngredients(nextState.ingredients || [], nextState.recipes || []);
  nextState.recipes = linkRecipesToIngredients(nextState.recipes || [], nextState.ingredients);
  if (options.applyGenericNutrition) {
    applyGenericNutritionToIngredients(nextState, { refreshRecipeNutrition: false });
  }
  if (options.refreshRecipeNutrition) {
    refreshAllRecipeNutritionFromIngredients(nextState);
  }
  return nextState;
}

function ingredientUsageCount(ingredientId) {
  return state.recipes.reduce((count, recipe) => {
    return count + (recipe.ingredientRefs || []).filter((ref) => ref.ingredientId === ingredientId).length;
  }, 0);
}

function ingredientUsageRecipes(ingredientId) {
  return state.recipes.filter((recipe) => (recipe.ingredientRefs || []).some((ref) => ref.ingredientId === ingredientId));
}

function ingredientUsageMarkup(ingredientId) {
  const recipes = ingredientUsageRecipes(ingredientId);
  if (!recipes.length) return `<span class="ingredient-usage muted-usage">0 recipe uses</span>`;
  if (recipes.length === 1) {
    return `<button class="ingredient-usage" data-open-ingredient-recipe="${escapeHtml(recipes[0].id)}" type="button" title="Open ${escapeHtml(recipes[0].name)}">1 recipe use</button>`;
  }
  return `
    <details class="ingredient-usage-details">
      <summary>${recipes.length} recipe uses</summary>
      <div class="ingredient-usage-menu">
        ${recipes.map((recipe) => `<button type="button" data-open-ingredient-recipe="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)}</button>`).join("")}
      </div>
    </details>
  `;
}

function ingredientImageType(ingredient) {
  const normalized = cleanIngredientName(`${ingredient?.name || ""} ${ingredient?.label || ""}`);
  const matches = (terms) => terms.some((term) => normalized.includes(term));
  if (matches(["egg"])) return "egg";
  if (matches(["apple", "banana", "grape", "pineapple", "lemon", "fruit"])) return "fruit";
  if (matches(["carrot", "cucumber", "peas", "beans", "lettuce", "tomato", "zucchini", "capsicum", "onion", "celery", "corn", "vegetable", "produce"])) return "veg";
  if (matches(["yoghurt", "yogurt", "cheese", "parmesan", "dairy"])) return "dairy";
  if (matches(["salmon", "fish"])) return "fish";
  if (matches(["chicken", "beef", "ham", "mince", "protein"])) return "meat";
  if (matches(["rice", "pasta", "wrap", "bread", "cracker", "potato", "beans", "lentils", "staples"])) return "staple";
  if (matches(["oil"])) return "oil";
  if (matches(["chocolate", "cookie", "muffin", "popcorn", "treat", "snack"])) return "treat";
  return "generic";
}

function ingredientImageMarkup(ingredient) {
  const imageUrl = resolveImageUrl(ingredient?.imageUrl);
  if (imageUrl) {
    return `
      <span class="ingredient-image ingredient-image-custom">
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(ingredient.name)}">
      </span>
    `;
  }
  return `
    <span class="ingredient-image ingredient-image-${ingredientImageType(ingredient)}" aria-hidden="true">
      <span></span>
    </span>
  `;
}

function mealThumbnailMarkup(recipe, label) {
  const imageUrl = resolveImageUrl(recipe?.imageUrl);
  if (imageUrl) {
    return `
      <span class="meal-thumb has-image meal-thumb-${recipeArtType(recipe)}">
        ${recipeFallbackArtMarkup(recipe)}
        <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name)}" data-hide-on-error>
      </span>
    `;
  }
  return `
    <span class="meal-thumb meal-thumb-fallback meal-thumb-${recipeArtType(recipe)}" aria-label="${escapeHtml(recipe?.name || label)}">
      <span class="recipe-art-shape primary"></span>
      <span class="recipe-art-shape secondary"></span>
      <span class="recipe-art-shape accent"></span>
    </span>
  `;
}

function daysUntil(dateValue) {
  if (!dateValue) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${dateValue}T00:00:00`);
  return Math.round((expiry - today) / 86400000);
}

function expiryLabel(item) {
  const remaining = daysUntil(item.expiry);
  if (remaining === null) return "No expiry set";
  if (remaining < 0) return `Expired ${Math.abs(remaining)} day${Math.abs(remaining) === 1 ? "" : "s"} ago`;
  if (remaining === 0) return "Expires today";
  if (remaining === 1) return "Expires tomorrow";
  return `Expires in ${remaining} days`;
}

function expiryStatus(item) {
  const remaining = daysUntil(item.expiry);
  if (remaining === null) return "none";
  if (remaining < 0) return "expired";
  if (remaining <= 2) return "urgent";
  if (remaining <= 5) return "soon";
  return "fresh";
}

function categoryForIngredient(name) {
  const normalized = name.toLowerCase();
  return categoryRules.find((rule) => rule.matches.some((match) => normalized.includes(match)))?.category || "Other";
}

function parseNumber(value) {
  if (!value) return 1;
  if (value.includes("/")) {
    const [top, bottom] = value.split("/").map(Number);
    return bottom ? top / bottom : 1;
  }
  return Number(value) || 1;
}

function unitBaseFactor(unit) {
  const normalized = String(unit || "each").toLowerCase();
  const factors = {
    g: { group: "weight", factor: 1 },
    gram: { group: "weight", factor: 1 },
    grams: { group: "weight", factor: 1 },
    kg: { group: "weight", factor: 1000 },
    ml: { group: "volume", factor: 1 },
    millilitre: { group: "volume", factor: 1 },
    milliliter: { group: "volume", factor: 1 },
    l: { group: "volume", factor: 1000 },
    litre: { group: "volume", factor: 1000 },
    liter: { group: "volume", factor: 1000 },
    cup: { group: "volume", factor: 250 },
    cups: { group: "volume", factor: 250 },
    tbsp: { group: "volume", factor: 15 },
    tablespoon: { group: "volume", factor: 15 },
    tablespoons: { group: "volume", factor: 15 },
    tsp: { group: "volume", factor: 5 },
    teaspoon: { group: "volume", factor: 5 },
    teaspoons: { group: "volume", factor: 5 },
    each: { group: "count", factor: 1 },
    piece: { group: "count", factor: 1 },
    pieces: { group: "count", factor: 1 },
    slice: { group: "count", factor: 1 },
    slices: { group: "count", factor: 1 }
  };
  return factors[normalized] || factors.each;
}

function nutritionScale(usedAmount, usedUnit, serving = {}) {
  const used = unitBaseFactor(usedUnit);
  const base = unitBaseFactor(serving.unit);
  const baseAmount = Math.max(0.1, Number(serving.amount) || 1);
  if (used.group !== base.group) return Math.max(0, Number(usedAmount) || 0) / baseAmount;
  return (Math.max(0, Number(usedAmount) || 0) * used.factor) / (baseAmount * base.factor);
}

function scaleNutrition(nutrition = {}, scale = 1) {
  return {
    calories: roundNutrition((Number(nutrition.calories) || 0) * scale),
    protein: roundNutrition((Number(nutrition.protein) || 0) * scale),
    carbs: roundNutrition((Number(nutrition.carbs) || 0) * scale),
    sugar: roundNutrition((Number(nutrition.sugar) || 0) * scale),
    fibre: roundNutrition((Number(nutrition.fibre) || 0) * scale),
    fat: roundNutrition((Number(nutrition.fat) || 0) * scale),
    sodium: roundNutrition((Number(nutrition.sodium) || 0) * scale)
  };
}

function parseServings(value) {
  const match = String([value].flat()[0] || "").match(/\d+(?:\.\d+)?|\d+\/\d+/);
  return Math.max(1, Math.round(parseNumber(match?.[0] || "1")));
}

function quantityMultiplier(line, rule) {
  const normalized = line.toLowerCase();
  const mixed = normalized.match(/(\d+)\s+(\d+\/\d+)/);
  const simple = normalized.match(/(\d+(?:\.\d+)?|\d+\/\d+)/);
  const amount = mixed ? Number(mixed[1]) + parseNumber(mixed[2]) : parseNumber(simple?.[1]);

  if (/\bkg\b|kilogram/.test(normalized)) return amount * 1000 / (rule.serving || 100);
  if (/\bg\b|gram/.test(normalized)) return amount / (rule.serving || 100);
  if (/tablespoons?|\btbsp\b/.test(normalized)) return rule.unit === "tbsp" ? amount : amount / 16;
  if (/teaspoons?|\btsp\b/.test(normalized)) return rule.unit === "tbsp" ? amount / 3 : amount / 48;
  if (/cups?/.test(normalized)) return rule.unit === "cup" ? amount : amount;
  if (/fillets?|breasts?|thighs?|eggs?|wraps?/.test(normalized)) return amount;
  return amount || 1;
}

function estimateMacrosFromIngredients(ingredients) {
  const totals = ingredients.reduce((sum, ingredient) => {
    const normalized = ingredient.toLowerCase();
    const rule = macroRules.find((candidate) => candidate.match.some((term) => normalized.includes(term)));
    if (!rule) return sum;
    const multiplier = quantityMultiplier(normalized, rule);
    sum.protein += rule.protein * multiplier;
    sum.carbs += rule.carbs * multiplier;
    sum.fat += rule.fat * multiplier;
    return sum;
  }, { protein: 0, carbs: 0, fat: 0 });

  return {
    protein: roundNutrition(totals.protein),
    carbs: roundNutrition(totals.carbs),
    fat: roundNutrition(totals.fat)
  };
}

function hasMeaningfulMacros(macros) {
  return Boolean(macros && (Number(macros.protein) || Number(macros.carbs) || Number(macros.fat)));
}

function caloriesFromMacros(macros = {}) {
  return roundNutrition((Number(macros.protein) || 0) * 4 + (Number(macros.carbs) || 0) * 4 + (Number(macros.fat) || 0) * 9);
}

function roundNutrition(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function normalizeNutritionLabelText(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[|•]/g, " ")
    .replace(/\bO(?=\d)/g, "0")
    .replace(/\s+/g, " ")
    .trim();
}

function nutritionLabelLines(text) {
  return String(text || "")
    .split(/\n|(?=\b(?:energy|calories|protein|total fat|fat|carbohydrate|carbohydrates|carbs|sugars?|dietary fibre|fiber|fibre|sodium)\b)/i)
    .map(normalizeNutritionLabelText)
    .filter(Boolean);
}

function numberFromText(value) {
  const match = String(value || "").match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : 0;
}

function unitFromText(value) {
  const normalized = String(value || "").toLowerCase();
  if (/\bml\b|millil/.test(normalized)) return "ml";
  if (/\bcups?\b/.test(normalized)) return "cup";
  if (/\btbsp\b|tablespoon/.test(normalized)) return "tbsp";
  if (/\btsp\b|teaspoon/.test(normalized)) return "tsp";
  if (/\beach\b|pieces?|slices?|servings?\b/.test(normalized)) return "each";
  return "g";
}

function parseServingFromNutritionText(text) {
  const normalized = normalizeNutritionLabelText(text);
  const servingMatch = normalized.match(/(?:serving size|per serving|serving)\D{0,28}(\d+(?:[.,]\d+)?)\s*(g|grams?|ml|millilit(?:re|er)s?|cups?|tbsp|tablespoons?|tsp|teaspoons?|pieces?|slices?|servings?)?/i);
  if (servingMatch) {
    return {
      amount: Math.max(0.1, numberFromText(servingMatch[1])),
      unit: unitFromText(servingMatch[2] || servingMatch[0])
    };
  }
  const per100Match = normalized.match(/\bper\s+100\s*(g|ml)\b/i);
  if (per100Match) return { amount: 100, unit: unitFromText(per100Match[1]) };
  return { amount: 100, unit: "g" };
}

function nutrientValueFromLine(line, type) {
  const normalized = normalizeNutritionLabelText(line).toLowerCase();
  if (type === "calories") {
    const calorieMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(?:kcal|cal\b)/i)
      || normalized.match(/(?:calories|energy)[^\d]*(\d+(?:[.,]\d+)?)/i);
    if (calorieMatch) return numberFromText(calorieMatch[1]);
    return 0;
  }
  if (type === "sodium") {
    const sodiumMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*(mg|g)\b/i);
    if (!sodiumMatch) return numberFromText(normalized);
    const value = numberFromText(sodiumMatch[1]);
    return sodiumMatch[2].toLowerCase() === "g" ? value * 1000 : value;
  }
  const gramsMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*g\b/i);
  if (gramsMatch) return numberFromText(gramsMatch[1]);
  return numberFromText(normalized);
}

function findNutrientValue(lines, type) {
  const aliases = {
    calories: [/calories/i, /energy/i, /\bkcal\b/i],
    protein: [/\bprotein\b/i],
    carbs: [/\btotal\s+carbohydrate\b/i, /\bcarbohydrates?\b/i, /\bcarbs?\b/i],
    sugar: [/\bsugars?\b/i],
    fibre: [/\bdietary\s+fib(?:er|re)\b/i, /\bfib(?:er|re)\b/i],
    fat: [/\btotal\s+fat\b/i, /\bfat\b/i],
    sodium: [/\bsodium\b/i]
  };
  const blockers = {
    carbs: [/\bsugars?\b/i],
    fat: [/\bsaturates?\b/i, /\bsaturated\b/i, /\btrans\b/i]
  };
  const line = lines.find((candidate) => {
    const matchesAlias = aliases[type].some((alias) => alias.test(candidate));
    const isBlocked = (blockers[type] || []).some((blocker) => blocker.test(candidate));
    return matchesAlias && !isBlocked;
  });
  return line ? nutrientValueFromLine(line, type) : 0;
}

function parseNutritionLabelText(text) {
  const lines = nutritionLabelLines(text);
  const serving = parseServingFromNutritionText(text);
  const nutrition = {
    calories: roundNutrition(findNutrientValue(lines, "calories")),
    protein: roundNutrition(findNutrientValue(lines, "protein")),
    carbs: roundNutrition(findNutrientValue(lines, "carbs")),
    sugar: roundNutrition(findNutrientValue(lines, "sugar")),
    fibre: roundNutrition(findNutrientValue(lines, "fibre")),
    fat: roundNutrition(findNutrientValue(lines, "fat")),
    sodium: roundNutrition(findNutrientValue(lines, "sodium"))
  };
  return { serving, nutrition, lines };
}

function nutritionLabelStatus(message) {
  const status = document.querySelector("#nutritionLabelStatus");
  if (status) status.textContent = message;
}

function resetNutritionLabelScan() {
  document.querySelector("#nutritionLabelPhotoInput").value = "";
  const result = document.querySelector("#nutritionLabelResult");
  if (result) {
    result.hidden = true;
    result.innerHTML = "";
  }
  nutritionLabelStatus("Use a clear photo of the nutrition panel to fill the fields below.");
}

function fillIngredientNutritionFromScan(scan) {
  document.querySelector("#ingredientServingAmount").value = scan.serving.amount;
  document.querySelector("#ingredientServingUnit").value = scan.serving.unit;
  document.querySelector("#ingredientCalories").value = scan.nutrition.calories;
  document.querySelector("#ingredientProtein").value = scan.nutrition.protein;
  document.querySelector("#ingredientCarbs").value = scan.nutrition.carbs;
  document.querySelector("#ingredientSugar").value = scan.nutrition.sugar;
  document.querySelector("#ingredientFibre").value = scan.nutrition.fibre;
  document.querySelector("#ingredientFat").value = scan.nutrition.fat;
  document.querySelector("#ingredientSodium").value = scan.nutrition.sodium;
}

function renderNutritionLabelResult(scan) {
  const result = document.querySelector("#nutritionLabelResult");
  if (!result) return;
  const foundValues = Object.values(scan.nutrition).filter((value) => Number(value) > 0).length;
  result.hidden = false;
  result.innerHTML = `
    <strong>${foundValues ? "Nutrition fields filled from photo" : "Scan finished, but values need review"}</strong>
    <div class="ingredient-nutrition barcode-result-nutrition">
      <span>per ${scan.serving.amount}${scan.serving.unit}</span>
      <span>${scan.nutrition.calories} kcal</span>
      <span>${scan.nutrition.protein}g P</span>
      <span>${scan.nutrition.carbs}g C</span>
      <span>${scan.nutrition.sugar}g sugar</span>
      <span>${scan.nutrition.fibre}g fibre</span>
      <span>${scan.nutrition.fat}g F</span>
      <span>${scan.nutrition.sodium}mg sodium</span>
    </div>
    <p class="muted">Review the numbers before saving. OCR can misread small print.</p>
  `;
}

function loadNutritionOcrLibrary() {
  if (window.Tesseract?.recognize) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;
  tesseractLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = TESSERACT_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", () => {
      if (window.Tesseract?.recognize) {
        resolve(window.Tesseract);
        return;
      }
      reject(new Error("Nutrition label scanning loaded, but OCR was unavailable."));
    }, { once: true });
    script.addEventListener("error", () => {
      tesseractLoadPromise = null;
      reject(new Error("Nutrition label scanning could not load. Check the internet connection, then try again."));
    }, { once: true });
    document.head.append(script);
  });
  return tesseractLoadPromise;
}

async function scanNutritionLabelPhoto(file) {
  nutritionLabelStatus("Loading nutrition label scanner...");
  const tesseract = await loadNutritionOcrLibrary();
  nutritionLabelStatus("Reading nutrition label...");
  const result = await tesseract.recognize(file, "eng", {
    logger: (progress) => {
      if (progress.status === "recognizing text") {
        nutritionLabelStatus(`Reading nutrition label... ${Math.round((progress.progress || 0) * 100)}%`);
      }
    }
  });
  const scan = parseNutritionLabelText(result.data?.text || "");
  fillIngredientNutritionFromScan(scan);
  renderNutritionLabelResult(scan);
  nutritionLabelStatus("Fields filled from photo. Please review the values before saving.");
}

function recipeTotalCalories(recipe) {
  return roundNutrition(Number(recipe?.calories) || caloriesFromMacros(recipe?.macros));
}

function recipeServings(recipe) {
  return Math.max(1, Number(recipe?.servings) || 1);
}

function macrosPerServing(recipe) {
  const servings = recipeServings(recipe);
  return {
    protein: roundNutrition((Number(recipe?.macros?.protein) || 0) / servings),
    carbs: roundNutrition((Number(recipe?.macros?.carbs) || 0) / servings),
    fat: roundNutrition((Number(recipe?.macros?.fat) || 0) / servings)
  };
}

function caloriesPerServing(recipe) {
  return roundNutrition(recipeTotalCalories(recipe) / recipeServings(recipe));
}

function recipeNutritionTotals(recipe) {
  return {
    calories: recipeTotalCalories(recipe),
    protein: roundNutrition(Number(recipe?.macros?.protein) || 0),
    carbs: roundNutrition(Number(recipe?.macros?.carbs) || 0),
    fat: roundNutrition(Number(recipe?.macros?.fat) || 0),
    sugar: roundNutrition(Number(recipe?.nutrition?.sugar) || 0),
    fibre: roundNutrition(Number(recipe?.nutrition?.fibre) || 0),
    sodium: roundNutrition(Number(recipe?.nutrition?.sodium) || 0)
  };
}

function recipeNutritionPerServing(recipe) {
  const servings = recipeServings(recipe);
  const totals = recipeNutritionTotals(recipe);
  return {
    calories: roundNutrition(totals.calories / servings),
    protein: roundNutrition(totals.protein / servings),
    carbs: roundNutrition(totals.carbs / servings),
    fat: roundNutrition(totals.fat / servings),
    sugar: roundNutrition(totals.sugar / servings),
    fibre: roundNutrition(totals.fibre / servings),
    sodium: roundNutrition(totals.sodium / servings)
  };
}

function recipeNutritionFromLinkedIngredients(recipe, ingredients = state.ingredients || []) {
  const totals = (recipe?.ingredients || []).reduce((sum, line, index) => {
    const ref = recipe.ingredientRefs?.[index] || {};
    const ingredient = ref.ingredientId
      ? ingredients.find((item) => item.id === ref.ingredientId)
      : findIngredientForLine(line, ingredients);
    if (!ingredient) return sum;
    const parsed = parseIngredientLine(line);
    const usedAmount = ref.usedAmount ?? parsed.usedAmount ?? ingredient.serving?.amount ?? 1;
    const usedUnit = ref.usedUnit || parsed.usedUnit || ingredient.serving?.unit || "each";
    const usedNutrition = scaleNutrition(
      ingredient.nutrition || {},
      nutritionScale(usedAmount, usedUnit, ingredient.serving || { amount: 1, unit: "each" })
    );
    sum.calories += usedNutrition.calories;
    sum.protein += usedNutrition.protein;
    sum.carbs += usedNutrition.carbs;
    sum.sugar += usedNutrition.sugar;
    sum.fibre += usedNutrition.fibre;
    sum.fat += usedNutrition.fat;
    sum.sodium += usedNutrition.sodium;
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, sugar: 0, fibre: 0, fat: 0, sodium: 0 });

  return {
    calories: roundNutrition(totals.calories),
    macros: {
      protein: roundNutrition(totals.protein),
      carbs: roundNutrition(totals.carbs),
      fat: roundNutrition(totals.fat)
    },
    nutrition: {
      sugar: roundNutrition(totals.sugar),
      fibre: roundNutrition(totals.fibre),
      sodium: roundNutrition(totals.sodium)
    }
  };
}

function refreshRecipeNutritionFromIngredients(recipe, ingredients = state.ingredients || []) {
  const nutrition = recipeNutritionFromLinkedIngredients(recipe, ingredients);
  if (!nutrition.calories && !hasMeaningfulMacros(nutrition.macros)) return recipe;
  return {
    ...recipe,
    calories: nutrition.calories,
    macros: nutrition.macros,
    nutrition: {
      ...(recipe.nutrition || {}),
      ...(nutrition.nutrition || {})
    }
  };
}

function refreshAllRecipeNutritionFromIngredients(nextState = state) {
  nextState.recipes = (nextState.recipes || []).map((recipe) => refreshRecipeNutritionFromIngredients(recipe, nextState.ingredients || []));
  return nextState;
}

function formatScaledNumber(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}

function scaleIngredientLine(line, factor) {
  if (!line || factor === 1) return line;
  return line.replace(/^(\s*)(\d+(?:\.\d+)?|\d+\/\d+)(\s+)/, (match, prefix, amount, gap) => {
    return `${prefix}${formatScaledNumber(parseNumber(amount) * factor)}${gap}`;
  });
}

function ingredientsForServing(recipe) {
  const factor = 1 / recipeServings(recipe);
  return (recipe.ingredients || []).map((ingredient) => scaleIngredientLine(ingredient, factor));
}

function mealSlotCalories(day, slot) {
  return roundNutrition(plannerRecipes(day, slot)
    .reduce((sum, recipe) => sum + caloriesPerServing(recipe), 0));
}

function mealSlotProtein(day, slot) {
  return roundNutrition(plannerRecipes(day, slot)
    .reduce((sum, recipe) => sum + macrosPerServing(recipe).protein, 0));
}

function plannedCaloriesForDay(day) {
  return roundNutrition(mealPlanSlots.reduce((sum, slot) => sum + mealSlotCalories(day, slot), 0));
}

function plannedProteinForDay(day) {
  return roundNutrition(mealPlanSlots.reduce((sum, slot) => sum + mealSlotProtein(day, slot), 0));
}

function currentNutritionGoals() {
  return {
    ...defaultDailyNutritionGoals,
    ...(state.nutritionGoals || {})
  };
}

function formatPlannerNumber(value, unit) {
  const normalized = roundNutrition(value);
  const maximumFractionDigits = unit === "kcal" ? 0 : 1;
  const label = unit === "protein" ? "g protein" : unit;
  return `${normalized.toLocaleString(undefined, { maximumFractionDigits })}${unit === "protein" ? "" : " "}${label}`;
}

function nutritionGoalRemainingForDay(day) {
  const goals = currentNutritionGoals();
  const caloriesRemaining = Math.max(0, goals.calories - plannedCaloriesForDay(day));
  const proteinRemaining = Math.max(0, goals.protein - plannedProteinForDay(day));
  return {
    calories: roundNutrition(caloriesRemaining),
    protein: roundNutrition(proteinRemaining),
    met: caloriesRemaining <= 0 && proteinRemaining <= 0
  };
}

function mealIsConsumed(day, slotId) {
  return Boolean(state.consumed?.[day]?.[slotId]);
}

function consumedCaloriesForDay(day) {
  return mealPlanSlots.reduce((sum, slot) => mealIsConsumed(day, slot.id) ? sum + mealSlotCalories(day, slot) : sum, 0);
}

function consumedProteinForDay(day) {
  return mealPlanSlots.reduce((sum, slot) => mealIsConsumed(day, slot.id) ? sum + mealSlotProtein(day, slot) : sum, 0);
}

function fillEstimatedMacros() {
  const ingredients = recipeIngredientLinesFromForm();
  const estimated = estimateMacrosFromIngredients(ingredients);
  const servings = Math.max(1, Number(document.querySelector("#recipeServings").value) || 1);
  document.querySelector("#recipeCalories").value = roundNutrition(caloriesFromMacros(estimated) / servings);
  document.querySelector("#recipeProtein").value = roundNutrition(estimated.protein / servings);
  document.querySelector("#recipeCarbs").value = roundNutrition(estimated.carbs / servings);
  document.querySelector("#recipeFat").value = roundNutrition(estimated.fat / servings);
  document.querySelector("#recipeFibre").value = 0;
  document.querySelector("#recipeSodium").value = 0;
  renderRecipeNutritionSummary();
  document.querySelector("#macroEstimateNote").textContent = hasMeaningfulMacros(estimated)
    ? "Estimated per serve from recognized ingredients. Adjust if needed."
    : "No known ingredients found yet. Add quantities for a better estimate.";
}

function setTab(tabId) {
  state.activeTab = tabId;
  saveState();
  render();
}

function renderNav() {
  navTabs.innerHTML = tabs.map((tab) => `
    <button class="nav-button ${state.activeTab === tab.id ? "active" : ""}" data-tab="${tab.id}" type="button" ${state.activeTab === tab.id ? 'aria-current="page"' : ""}>
      <span class="nav-icon">${iconMarkup(tab.icon)}</span>
      <span>${tab.label}</span>
    </button>
  `).join("");
}

function applyConfigurationToLayout() {
  const configuration = state.configuration || defaultConfiguration;
  const appName = configuration.appName || defaultConfiguration.appName;
  const householdName = configuration.householdName || defaultConfiguration.householdName;
  const profileName = configuration.profileName || defaultConfiguration.profileName;
  document.title = appName;
  document.querySelector("#householdBrand").textContent = householdName;
  document.querySelector("#appBrand").textContent = appName;
  document.querySelector(".eyebrow").textContent = `${householdName} dashboard`;
  const avatar = document.querySelector("#profileAvatar");
  avatar.textContent = profileName.slice(0, 1).toUpperCase() || "H";
  avatar.setAttribute("aria-label", `${profileName} profile`);
}

function renderLayout() {
  tabs.forEach((tab) => views[tab.id].classList.toggle("active", state.activeTab === tab.id));
  const current = tabs.find((tab) => tab.id === state.activeTab);
  pageTitle.textContent = current.label;
}
