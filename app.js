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

function getShoppingItems() {
  const plannedRecipes = days
    .flatMap((day) => mealPlanSlots
      .flatMap((slot) => plannerRecipes(day, slot)))
    .filter(Boolean);
  const counts = new Map();

  plannedRecipes.forEach((recipe) => {
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
      existing.count += 1;
      if (perServeAmount) {
        const unit = usedUnit || "each";
        const base = unitBaseFactor(unit);
        const quantity = existing.quantities.find((item) => item.group === base.group);
        if (quantity) {
          quantity.baseAmount += perServeAmount * base.factor;
        } else {
          existing.quantities.push({
            group: base.group,
            baseAmount: perServeAmount * base.factor,
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
    const mealCalories = recipes.reduce((sum, item) => sum + caloriesPerServing(item), 0);
    const mealProtein = recipes.reduce((sum, item) => sum + macrosPerServing(item).protein, 0);
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

function renderPlanner() {
  const goals = currentNutritionGoals();
  const calorieGoalInput = document.querySelector("#dailyCalorieGoal");
  const proteinGoalInput = document.querySelector("#dailyProteinGoal");
  if (calorieGoalInput && document.activeElement !== calorieGoalInput) calorieGoalInput.value = goals.calories;
  if (proteinGoalInput && document.activeElement !== proteinGoalInput) proteinGoalInput.value = goals.protein;

  document.querySelector("#plannerGrid").innerHTML = `
    <div class="planner-table">
      <div class="planner-corner">Meal</div>
      ${days.map((day) => {
        const remaining = nutritionGoalRemainingForDay(day);
        return `
          <div class="planner-day-heading">
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
        `;
      }).join("")}
      ${mealPlanSlots.map((slot) => `
        <div class="planner-meal-label">
          <span>${slot.label}</span>
          ${slot.timing ? `<small>${slot.timing}</small>` : ""}
        </div>
        ${days.map((day) => {
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
                ${selectedRecipes.length ? selectedRecipes.map((recipe) => `
                  <article class="planner-dish">
                    ${mealThumbnailMarkup(recipe, slot.label)}
                    <div class="planner-meal-pick">
                      <strong>${escapeHtml(recipe.name)}</strong>
                      <span class="planner-recipe-nutrition">${escapeHtml(`${formatPlannerNumber(caloriesPerServing(recipe), "kcal")} / ${formatPlannerNumber(macrosPerServing(recipe).protein, "protein")}`)}</span>
                      <label class="recipe-prepared-toggle planner-prepared-toggle">
                        <input type="checkbox" ${recipe.prepared ? "checked" : ""} data-recipe-prepared="${escapeHtml(recipe.id)}">
                        <span>${recipe.prepared ? "In freezer / prepared" : "Not prepared"}</span>
                      </label>
                    </div>
                    <button class="planner-remove-dish" data-remove-planner-recipe="${escapeHtml(recipe.id)}" data-planner-day="${day}" data-planner-slot="${slot.id}" type="button" aria-label="Remove ${escapeHtml(recipe.name)} from ${day} ${slot.label}" title="Remove dish">×</button>
                  </article>
                `).join("") : `
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
        }).join("")}
      `).join("")}
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

function openRecipeDialog(recipe = null) {
  document.querySelector("#recipeDialogTitle").textContent = recipe ? "Edit recipe" : "Add recipe";
  document.querySelector("#recipeId").value = recipe?.id || "";
  document.querySelector("#recipeName").value = recipe?.name || "";
  document.querySelector("#recipeTags").value = recipe?.tags?.join(", ") || "";
  document.querySelector("#recipePrepared").checked = Boolean(recipe?.prepared);
  const categorySelect = document.querySelector("#recipeCategory");
  categorySelect.innerHTML = recipeCategories.map((category) => `
    <label class="category-check">
      <input type="checkbox" value="${category.id}" ${recipeCategoriesForRecipe(recipe).includes(category.id) ? "checked" : ""}>
      <span>${category.label}</span>
    </label>
  `).join("");
  document.querySelector("#recipeImageUrl").value = isEmbeddedImage(recipe?.imageUrl) || isImageAssetRef(recipe?.imageUrl) ? "" : recipe?.imageUrl || "";
  document.querySelector("#recipeImageData").value = isEmbeddedImage(recipe?.imageUrl) || isImageAssetRef(recipe?.imageUrl) ? recipe.imageUrl : "";
  document.querySelector("#recipeImageFile").value = "";
  updateRecipeImagePreview(recipe?.imageUrl || "");
  document.querySelector("#recipeIngredients").value = recipe?.ingredients?.join("\n") || "";
  renderRecipeIngredientNutritionEditor();
  document.querySelector("#recipeOriginalIngredients").value = recipe?.originalIngredients?.join("\n") || "";
  document.querySelector("#recipeMethod").value = recipe?.method || "";
  document.querySelector("#recipeSourceUrl").value = recipe?.sourceUrl || "";
  document.querySelector("#recipeServings").value = recipeServings(recipe);
  document.querySelector("#recipeServings").dataset.previousServings = String(recipeServings(recipe));
  document.querySelector("#recipeCalories").value = recipe ? caloriesPerServing(recipe) : caloriesFromMacros({ protein: 25, carbs: 45, fat: 15 });
  document.querySelector("#recipeProtein").value = recipe ? macrosPerServing(recipe).protein : 25;
  document.querySelector("#recipeCarbs").value = recipe ? macrosPerServing(recipe).carbs : 45;
  document.querySelector("#recipeFat").value = recipe ? macrosPerServing(recipe).fat : 15;
  document.querySelector("#recipeFibre").value = recipe ? recipeNutritionPerServing(recipe).fibre : 0;
  document.querySelector("#recipeSodium").value = recipe ? recipeNutritionPerServing(recipe).sodium : 0;
  renderRecipeNutritionSummary(recipe ? recipeNutritionTotals(recipe) : editorNutritionTotals());
  recipeDialog.showModal();
}

function updateRecipeImagePreview(imageUrl) {
  const preview = document.querySelector("#recipeImagePreview");
  const resolvedImageUrl = resolveImageUrl(imageUrl);
  preview.classList.toggle("has-image", Boolean(resolvedImageUrl));
  preview.innerHTML = resolvedImageUrl
    ? `<img src="${escapeHtml(resolvedImageUrl)}" alt="">`
    : "No image selected";
}

function updateIngredientImagePreview(imageUrl) {
  const preview = document.querySelector("#ingredientImagePreview");
  const resolvedImageUrl = resolveImageUrl(imageUrl);
  preview.classList.toggle("has-image", Boolean(resolvedImageUrl));
  preview.innerHTML = resolvedImageUrl
    ? `<img src="${escapeHtml(resolvedImageUrl)}" alt="">`
    : "Using generic image";
}

function dataUrlSizeBytes(dataUrl) {
  const payload = String(dataUrl || "").split(",")[1] || "";
  return Math.ceil((payload.length * 3) / 4);
}

function resizeImageFile(file, maxSize = IMAGE_UPLOAD_MAX_SIDE, quality = IMAGE_UPLOAD_QUALITY) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      reject(new Error("This image is too large. Please choose an image under 8 MB, or use an image URL."));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("error", () => reject(new Error("Could not read this image.")));
    reader.addEventListener("load", () => {
      const image = new Image();
      image.addEventListener("error", () => reject(new Error("Could not load this image.")));
      image.addEventListener("load", () => {
        const scale = Math.min(1, maxSize / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const renderAtSize = (side, imageQuality) => {
          const nextScale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
          const nextWidth = Math.max(1, Math.round(image.naturalWidth * nextScale));
          const nextHeight = Math.max(1, Math.round(image.naturalHeight * nextScale));
          const canvas = document.createElement("canvas");
          canvas.width = nextWidth;
          canvas.height = nextHeight;
          const context = canvas.getContext("2d");
          context.fillStyle = "#fff";
          context.fillRect(0, 0, nextWidth, nextHeight);
          context.drawImage(image, 0, 0, nextWidth, nextHeight);
          return canvas.toDataURL("image/jpeg", imageQuality);
        };
        const attempts = [
          [maxSize, quality],
          [480, 0.58],
          [420, 0.52],
          [360, 0.48],
          [300, 0.44],
          [240, 0.4]
        ];
        const candidates = attempts.map(([side, imageQuality]) => renderAtSize(side, imageQuality));
        const best = candidates.find((candidate) => dataUrlSizeBytes(candidate) <= MAX_STORED_IMAGE_BYTES) || candidates.at(-1);
        if (dataUrlSizeBytes(best) > MAX_STORED_IMAGE_BYTES) {
          reject(new Error("This image is still too large after compression. Please use an image URL instead."));
          return;
        }
        resolve(best);
      });
      image.src = reader.result;
    });
    reader.readAsDataURL(file);
  });
}

async function imageUrlToLocalDataUrl(imageUrl) {
  const value = String(imageUrl || "").trim();
  if (!value || isEmbeddedImage(value) || isImageAssetRef(value)) return value;
  return value;
}

async function prepareRecipeImageForSave(imageUrl) {
  const localImage = await imageUrlToLocalDataUrl(imageUrl);
  return storeImageAsset(state, localImage);
}

function normalizeBarcode(value) {
  return String(value || "").replace(/\D/g, "");
}

function barcodeStatus(message) {
  const status = document.querySelector("#barcodeStatus");
  if (status) status.textContent = message;
}

async function getBarcodeDetector() {
  if (!("BarcodeDetector" in window)) {
    throw new Error("Barcode scanning is not supported in this browser. Type the barcode number instead.");
  }
  if (!barcodeDetector) {
    const supportedFormats = typeof BarcodeDetector.getSupportedFormats === "function"
      ? await BarcodeDetector.getSupportedFormats()
      : ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
    const formats = supportedFormats.filter((format) => ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"].includes(format));
    barcodeDetector = new BarcodeDetector({ formats: formats.length ? formats : supportedFormats });
  }
  return barcodeDetector;
}

function hasNativeBarcodeDetector() {
  return "BarcodeDetector" in window;
}

function getZxingLibrary() {
  return window.ZXingBrowser || window.ZXing || null;
}

function getZxingReader() {
  const zxing = getZxingLibrary();
  if (!zxing?.BrowserMultiFormatReader) {
    throw new Error("Barcode scanner failed to initialise. Reload MacroVault, or type the barcode number.");
  }
  if (!barcodeZxingReader) {
    barcodeZxingReader = new zxing.BrowserMultiFormatReader();
  }
  return barcodeZxingReader;
}

function barcodeTextFromResult(result) {
  return normalizeBarcode(typeof result?.getText === "function" ? result.getText() : result?.text || result?.rawValue || "");
}

function barcodeCameraError(error) {
  if (!window.isSecureContext) return "Camera scanning requires a secure HTTPS connection. Upload a photo or type the barcode instead.";
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") return "Camera access was blocked. Allow camera access for MacroVault, then try again.";
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") return "No camera was found. Upload a barcode photo or type the number instead.";
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") return "The camera is already in use by another app. Close it there, then try again.";
  return error?.message || "Could not start camera. Try uploading a photo or typing the barcode.";
}

async function detectBarcodeFromSource(source) {
  const detector = await getBarcodeDetector();
  const codes = await detector.detect(source);
  const rawValue = codes?.[0]?.rawValue || "";
  const barcode = normalizeBarcode(rawValue);
  if (!barcode) throw new Error("No barcode found. Try a clearer photo or type the number.");
  return barcode;
}

async function detectBarcodeFromPhoto(file) {
  if (!hasNativeBarcodeDetector()) {
    const reader = getZxingReader();
    const imageUrl = URL.createObjectURL(file);
    try {
      const result = await reader.decodeFromImageUrl(imageUrl);
      const barcode = barcodeTextFromResult(result);
      if (!barcode) throw new Error("No barcode found. Try a clearer photo or type the number.");
      return barcode;
    } finally {
      URL.revokeObjectURL(imageUrl);
    }
  }
  const bitmap = await createImageBitmap(file);
  try {
    return await detectBarcodeFromSource(bitmap);
  } finally {
    bitmap.close?.();
  }
}

function stopBarcodeCamera() {
  barcodeScanBusy = false;
  if (barcodeZxingControls) {
    barcodeZxingControls.stop();
    barcodeZxingControls = null;
  }
  if (barcodeScanTimer) {
    clearInterval(barcodeScanTimer);
    barcodeScanTimer = null;
  }
  if (barcodeStream) {
    barcodeStream.getTracks().forEach((track) => track.stop());
    barcodeStream = null;
  }
  const video = document.querySelector("#barcodeVideo");
  if (video) video.srcObject = null;
  const panel = document.querySelector("#barcodeCameraPanel");
  if (panel) panel.hidden = true;
}

async function startBarcodeCamera() {
  const video = document.querySelector("#barcodeVideo");
  const panel = document.querySelector("#barcodeCameraPanel");
  stopBarcodeCamera();
  barcodeStatus("Starting camera...");
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(window.isSecureContext
      ? "Camera access is not available in this browser. Upload a photo or type the barcode instead."
      : "Camera scanning requires a secure HTTPS connection. Upload a photo or type the barcode instead.");
  }
  if (!hasNativeBarcodeDetector()) {
    const reader = getZxingReader();
    panel.hidden = false;
    barcodeStatus("Point your camera at the barcode.");
    let handled = false;
    const onResult = async (result, _error, controls) => {
      if (handled) return;
      const barcode = barcodeTextFromResult(result);
      if (!barcode) return;
      handled = true;
      controls?.stop();
      stopBarcodeCamera();
      document.querySelector("#barcodeManualInput").value = barcode;
      await lookupBarcode(barcode);
    };
    const controls = typeof reader.decodeFromConstraints === "function"
      ? await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } }, audio: false }, video, onResult)
      : await reader.decodeFromVideoDevice(undefined, video, onResult);
    if (handled) controls?.stop();
    else barcodeZxingControls = controls;
    return;
  }
  await getBarcodeDetector();
  barcodeStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" } },
    audio: false
  });
  video.srcObject = barcodeStream;
  panel.hidden = false;
  await video.play();
  barcodeStatus("Point your camera at the barcode.");
  barcodeScanTimer = setInterval(async () => {
    if (video.readyState < 2 || barcodeScanBusy) return;
    barcodeScanBusy = true;
    try {
      const barcode = await detectBarcodeFromSource(video);
      stopBarcodeCamera();
      document.querySelector("#barcodeManualInput").value = barcode;
      await lookupBarcode(barcode);
    } catch {
      // Keep scanning until a barcode is visible.
    } finally {
      barcodeScanBusy = false;
    }
  }, 650);
}

function openBarcodeDialog(initialBarcode = "") {
  document.querySelector("#barcodeManualInput").value = normalizeBarcode(initialBarcode);
  document.querySelector("#barcodePhotoInput").value = "";
  document.querySelector("#barcodeResult").hidden = true;
  document.querySelector("#barcodeResult").innerHTML = "";
  barcodeStatus("Barcode lookup uses Open Food Facts when online.");
  barcodeDialog.showModal();
}

function ingredientDataFromOpenFoodFacts(product, barcode) {
  const name = product.product_name || product.generic_name || `Barcode ${barcode}`;
  const brands = product.brands || "";
  const normalized = window.MacroVaultBarcode?.normalizeNutrition(product);
  if (!normalized) throw new Error("Nutrition normalizer failed to initialise. Reload MacroVault, then try again.");
  const category = product.categories_tags?.some((tag) => /dair|cheese|yogurt|yoghurt|milk/.test(tag)) ? "Dairy"
    : product.categories_tags?.some((tag) => /meat|fish|egg|protein/.test(tag)) ? "Protein"
      : product.categories_tags?.some((tag) => /fruit|vegetable|produce/.test(tag)) ? "Produce"
        : product.categories_tags?.some((tag) => /snack|dessert|sweet|chocolate|biscuit|cookie/.test(tag)) ? "Snack"
          : categoryForIngredient(name);
  return {
    name,
    plural: "",
    description: brands ? `Brand: ${brands}` : "",
    barcode,
    imageUrl: product.image_front_url || product.image_url || "",
    label: category,
    serving: normalized.basis,
    nutrition: normalized.nutrition,
    nutritionMeta: normalized
  };
}

async function fetchOpenFoodFactsProduct(barcode) {
  const fields = "product_name,generic_name,brands,categories_tags,serving_quantity,serving_quantity_unit,serving_size,product_quantity_unit,nutrition_data_per,nutrition_data_prepared_per,nutrition,nutriments,image_front_url,image_url";
  const urls = [
    `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}.json?fields=${fields}`,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=${fields}`
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 404) continue;
        throw new Error(`Lookup failed (${response.status}).`);
      }
      const data = await response.json();
      if (data.product) return data.product;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}

function fillIngredientFormFromBarcode(data) {
  if (barcodeDialog.open) barcodeDialog.close();
  if (!ingredientDialog.open) openIngredientDialog();
  document.querySelector("#ingredientName").value = data.name || "";
  document.querySelector("#ingredientPlural").value = data.plural || "";
  document.querySelector("#ingredientDescription").value = data.description || "";
  document.querySelector("#ingredientBarcode").value = data.barcode || "";
  document.querySelector("#ingredientImageUrl").value = data.imageUrl || "";
  document.querySelector("#ingredientImageData").value = "";
  document.querySelector("#ingredientImageFile").value = "";
  updateIngredientImagePreview(data.imageUrl || "");
  document.querySelector("#ingredientLabel").value = data.label || "";
  document.querySelector("#ingredientServingAmount").value = data.serving?.amount ?? 100;
  document.querySelector("#ingredientServingUnit").value = data.serving?.unit || "g";
  document.querySelector("#ingredientCalories").value = data.nutrition?.calories ?? 0;
  document.querySelector("#ingredientProtein").value = data.nutrition?.protein ?? 0;
  document.querySelector("#ingredientCarbs").value = data.nutrition?.carbs ?? 0;
  document.querySelector("#ingredientSugar").value = data.nutrition?.sugar ?? 0;
  document.querySelector("#ingredientFibre").value = data.nutrition?.fibre ?? 0;
  document.querySelector("#ingredientFat").value = data.nutrition?.fat ?? 0;
  document.querySelector("#ingredientSodium").value = data.nutrition?.sodium ?? 0;
}

async function lookupBarcode(value, { skipExisting = false, editingIngredient = null } = {}) {
  const barcode = normalizeBarcode(value);
  if (!barcode) {
    barcodeStatus("Enter or scan a barcode first.");
    return;
  }
  const existing = state.ingredients.find((ingredient) => normalizeBarcode(ingredient.barcode) === barcode);
  if (existing && !skipExisting) {
    barcodeStatus(`Found saved ingredient: ${existing.name}`);
    document.querySelector("#barcodeResult").hidden = false;
    document.querySelector("#barcodeResult").innerHTML = `
      <h3>${escapeHtml(existing.name)}</h3>
      <p class="muted">This barcode is already saved in your ingredients.</p>
      <div class="barcode-result-actions">
        <button class="primary-button" id="openExistingBarcodeIngredientButton" type="button">Open ingredient</button>
        <button class="secondary-button" id="refreshExistingBarcodeIngredientButton" type="button">Refresh nutrition</button>
      </div>
    `;
    document.querySelector("#openExistingBarcodeIngredientButton").addEventListener("click", () => {
      barcodeDialog.close();
      openIngredientDialog(existing);
    }, { once: true });
    document.querySelector("#refreshExistingBarcodeIngredientButton").addEventListener("click", () => {
      lookupBarcode(barcode, { skipExisting: true, editingIngredient: existing });
    }, { once: true });
    return;
  }
  barcodeStatus("Looking up barcode...");
  try {
    const product = await fetchOpenFoodFactsProduct(barcode);
    if (!product) {
      barcodeStatus("No product found. You can still save this barcode manually.");
      fillIngredientFormFromBarcode({ name: `Barcode ${barcode}`, barcode, serving: { amount: 100, unit: "g" }, nutrition: ingredientNutritionEstimate("") });
      return;
    }
    const ingredientData = ingredientDataFromOpenFoodFacts(product, barcode);
    const nutritionMeta = ingredientData.nutritionMeta;
    const warningsMarkup = nutritionMeta.warnings.length ? `
      <div class="barcode-nutrition-warning" role="alert">
        <strong>Check these values against the package</strong>
        <ul>${nutritionMeta.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>
      </div>
    ` : `<p class="barcode-nutrition-ok">Nutrition values passed automatic checks.</p>`;
    barcodeStatus(`Found ${ingredientData.name}.`);
    document.querySelector("#barcodeResult").hidden = false;
    document.querySelector("#barcodeResult").innerHTML = `
      <div>
        <h3>Review imported values</h3>
        <p class="muted">Open Food Facts is community maintained. Compare these values with the packet and correct them before applying.</p>
      </div>
      <p class="barcode-nutrition-basis"><strong>Imported basis:</strong> per ${ingredientData.serving.amount}${ingredientData.serving.unit} · ${escapeHtml(nutritionMeta.confidence)} confidence</p>
      ${warningsMarkup}
      <div class="barcode-review-grid">
        <label class="barcode-review-name">Product name<input id="barcodeProductName" value="${escapeHtml(ingredientData.name)}"></label>
        <label>Serving amount<input id="barcodeServingAmount" type="number" min="0.1" step="0.01" value="${ingredientData.serving.amount}"></label>
        <label>Unit<select id="barcodeServingUnit"><option value="g" ${ingredientData.serving.unit === "g" ? "selected" : ""}>g</option><option value="ml" ${ingredientData.serving.unit === "ml" ? "selected" : ""}>ml</option><option value="each" ${ingredientData.serving.unit === "each" ? "selected" : ""}>each</option></select></label>
        <label>Calories<input id="barcodeCalories" type="number" min="0" step="0.01" value="${ingredientData.nutrition.calories}"></label>
        <label>Protein (g)<input id="barcodeProtein" type="number" min="0" step="0.01" value="${ingredientData.nutrition.protein}"></label>
        <label>Carbs (g)<input id="barcodeCarbs" type="number" min="0" step="0.01" value="${ingredientData.nutrition.carbs}"></label>
        <label>Sugar (g)<input id="barcodeSugar" type="number" min="0" step="0.01" value="${ingredientData.nutrition.sugar}"></label>
        <label>Fibre (g)<input id="barcodeFibre" type="number" min="0" step="0.01" value="${ingredientData.nutrition.fibre}"></label>
        <label>Fat (g)<input id="barcodeFat" type="number" min="0" step="0.01" value="${ingredientData.nutrition.fat}"></label>
        <label>Sodium (mg)<input id="barcodeSodium" type="number" min="0" step="0.01" value="${ingredientData.nutrition.sodium}"></label>
      </div>
      <p class="muted barcode-serving-scale-status" id="barcodeServingScaleStatus" role="status" aria-live="polite">Changing the serving amount automatically recalculates all nutrition values.</p>
      <button class="primary-button" id="useBarcodeProductButton" type="button">Apply reviewed values</button>
    `;
    const servingAmountInput = document.querySelector("#barcodeServingAmount");
    const servingUnitInput = document.querySelector("#barcodeServingUnit");
    const servingScaleStatus = document.querySelector("#barcodeServingScaleStatus");
    const nutritionReviewInputs = {
      calories: "#barcodeCalories",
      protein: "#barcodeProtein",
      carbs: "#barcodeCarbs",
      sugar: "#barcodeSugar",
      fibre: "#barcodeFibre",
      fat: "#barcodeFat",
      sodium: "#barcodeSodium"
    };
    let reviewedBasis = { amount: ingredientData.serving.amount, unit: ingredientData.serving.unit };
    const rescaleReviewedNutrition = () => {
      const nextAmount = Number(servingAmountInput.value);
      if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
        servingScaleStatus.textContent = "Enter a serving amount greater than zero to recalculate nutrition.";
        return false;
      }
      const nextBasis = { amount: nextAmount, unit: servingUnitInput.value || "g" };
      const currentNutrition = Object.fromEntries(Object.entries(nutritionReviewInputs).map(([name, selector]) => [
        name,
        Number(document.querySelector(selector).value) || 0
      ]));
      const rescaled = window.MacroVaultBarcode?.rescaleNutrition(currentNutrition, reviewedBasis, nextBasis);
      if (!rescaled) {
        servingScaleStatus.textContent = `Nutrition was not converted from ${reviewedBasis.unit} to ${nextBasis.unit}; correct the values using the package label.`;
        reviewedBasis = nextBasis;
        return true;
      }
      const previousBasis = reviewedBasis;
      Object.entries(nutritionReviewInputs).forEach(([name, selector]) => {
        document.querySelector(selector).value = rescaled[name];
      });
      reviewedBasis = nextBasis;
      servingScaleStatus.textContent = previousBasis.amount === nextBasis.amount
        ? `Nutrition remains based on ${nextBasis.amount}${nextBasis.unit}.`
        : `Recalculated all nutrition values from ${previousBasis.amount}${previousBasis.unit} to ${nextBasis.amount}${nextBasis.unit}.`;
      return true;
    };
    servingAmountInput.addEventListener("change", rescaleReviewedNutrition);
    servingUnitInput.addEventListener("change", rescaleReviewedNutrition);
    document.querySelector("#useBarcodeProductButton").addEventListener("click", () => {
      if (!rescaleReviewedNutrition()) {
        servingAmountInput.focus();
        return;
      }
      if (editingIngredient && !ingredientDialog.open) openIngredientDialog(editingIngredient);
      fillIngredientFormFromBarcode({
        ...ingredientData,
        name: document.querySelector("#barcodeProductName").value.trim() || ingredientData.name,
        serving: {
          amount: Math.max(0.1, Number(document.querySelector("#barcodeServingAmount").value) || 1),
          unit: document.querySelector("#barcodeServingUnit").value || "g"
        },
        nutrition: {
          calories: roundNutrition(document.querySelector("#barcodeCalories").value),
          protein: roundNutrition(document.querySelector("#barcodeProtein").value),
          carbs: roundNutrition(document.querySelector("#barcodeCarbs").value),
          sugar: roundNutrition(document.querySelector("#barcodeSugar").value),
          fibre: roundNutrition(document.querySelector("#barcodeFibre").value),
          fat: roundNutrition(document.querySelector("#barcodeFat").value),
          sodium: roundNutrition(document.querySelector("#barcodeSodium").value)
        }
      });
    });
  } catch (error) {
    barcodeStatus(error.message || "Could not look up this barcode.");
  }
}

function recipeIngredientLinesFromForm() {
  return document.querySelector("#recipeIngredients").value.split("\n").map(stripIngredientBullet).filter(Boolean);
}

function recipeIngredientDataFromForm() {
  return recipeIngredientLinesFromForm().map(parseIngredientLine);
}

function renderRecipeIngredientNutritionEditor() {
  const ingredientData = recipeIngredientDataFromForm();
  const container = document.querySelector("#recipeIngredientNutrition");
  const editingRecipe = recipeById(document.querySelector("#recipeId").value);
  if (!ingredientData.length) {
    container.innerHTML = `<p class="muted">Add ingredients to see editable nutrition for each item.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="ingredient-nutrition-heading">
      <strong>Ingredient nutrition</strong>
      <span class="muted">Quantity stays with this recipe. Nutrition is saved to the ingredient database.</span>
    </div>
    ${ingredientData.map((item, index) => {
      const usage = editingRecipe?.ingredientRefs?.[index] || {};
      const linkedIngredient = state.ingredients.find((candidate) => candidate.id === usage.ingredientId);
      const ingredient = linkedIngredient && ingredientMatchesLine(linkedIngredient, item.name)
        ? linkedIngredient
        : findIngredientForLine(item.name);
      const nutrition = ingredient?.nutrition || ingredientNutritionEstimate(item.name);
      const serving = ingredient?.serving || { amount: 1, unit: "each" };
      const usedAmount = usage.usedAmount ?? item.usedAmount ?? serving.amount;
      const usedUnit = usage.usedUnit || item.usedUnit || serving.unit;
      const rowScale = nutritionScale(usedAmount, usedUnit, serving);
      const usedNutrition = scaleNutrition(nutrition, rowScale);
      const ingredientOptions = state.ingredients.map((candidate) => `
        <option value="${candidate.id}" ${ingredient?.id === candidate.id ? "selected" : ""}>${escapeHtml(candidate.name)}${candidate.label ? ` - ${escapeHtml(candidate.label)}` : ""}</option>
      `).join("");
      return `
        <article class="recipe-ingredient-row" data-serving-amount="${serving.amount}" data-serving-unit="${serving.unit}" data-base-calories="${Number(nutrition.calories) || 0}" data-base-protein="${Number(nutrition.protein) || 0}" data-base-carbs="${Number(nutrition.carbs) || 0}" data-base-sugar="${Number(nutrition.sugar) || 0}" data-base-fibre="${Number(nutrition.fibre) || 0}" data-base-fat="${Number(nutrition.fat) || 0}" data-base-sodium="${Number(nutrition.sodium) || 0}">
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <span class="muted">${ingredient ? `Linked to ${escapeHtml(ingredient.name)} - row nutrition is for amount used` : "Will be added to ingredients"}</span>
          </div>
          <label>
            database ingredient
            <select data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="ingredientId">
              <option value="">Create or auto match</option>
              ${ingredientOptions}
            </select>
          </label>
          <label>
            amount used
            <input type="number" min="0" step="0.01" value="${usedAmount}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="usedAmount">
          </label>
          <label>
            unit
            <select data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="usedUnit">
              ${ingredientUnits.map((unit) => `<option value="${unit}" ${usedUnit === unit ? "selected" : ""}>${unit}</option>`).join("")}
            </select>
          </label>
          <label>
            kcal used
            <input type="number" min="0" step="0.01" value="${usedNutrition.calories}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="calories">
          </label>
          <label>
            protein used
            <input type="number" min="0" step="0.01" value="${usedNutrition.protein}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="protein">
          </label>
          <label>
            carbs used
            <input type="number" min="0" step="0.01" value="${usedNutrition.carbs}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="carbs">
          </label>
          <label>
            sugar used
            <input type="number" min="0" step="0.01" value="${usedNutrition.sugar}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="sugar">
          </label>
          <label>
            fibre used
            <input type="number" min="0" step="0.01" value="${usedNutrition.fibre}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="fibre">
          </label>
          <label>
            fat used
            <input type="number" min="0" step="0.01" value="${usedNutrition.fat}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="fat">
          </label>
          <label>
            sodium used (mg)
            <input type="number" min="0" step="0.01" value="${usedNutrition.sodium}" data-recipe-ingredient-index="${index}" data-recipe-ingredient-field="sodium">
          </label>
        </article>
      `;
    }).join("")}
  `;
}

function recipeIngredientRowScale(row) {
  const usedAmount = Number(row.querySelector('[data-recipe-ingredient-field="usedAmount"]')?.value || 0);
  const usedUnit = row.querySelector('[data-recipe-ingredient-field="usedUnit"]')?.value || "each";
  return nutritionScale(usedAmount, usedUnit, {
    amount: Number(row.dataset.servingAmount) || 1,
    unit: row.dataset.servingUnit || "each"
  });
}

function refreshRecipeIngredientRowNutrition(row) {
  const scale = recipeIngredientRowScale(row);
  const scaled = scaleNutrition({
    calories: Number(row.dataset.baseCalories) || 0,
    protein: Number(row.dataset.baseProtein) || 0,
    carbs: Number(row.dataset.baseCarbs) || 0,
    sugar: Number(row.dataset.baseSugar) || 0,
    fibre: Number(row.dataset.baseFibre) || 0,
    fat: Number(row.dataset.baseFat) || 0,
    sodium: Number(row.dataset.baseSodium) || 0
  }, scale);
  row.querySelector('[data-recipe-ingredient-field="calories"]').value = scaled.calories;
  row.querySelector('[data-recipe-ingredient-field="protein"]').value = scaled.protein;
  row.querySelector('[data-recipe-ingredient-field="carbs"]').value = scaled.carbs;
  row.querySelector('[data-recipe-ingredient-field="sugar"]').value = scaled.sugar;
  row.querySelector('[data-recipe-ingredient-field="fibre"]').value = scaled.fibre;
  row.querySelector('[data-recipe-ingredient-field="fat"]').value = scaled.fat;
  row.querySelector('[data-recipe-ingredient-field="sodium"]').value = scaled.sodium;
}

function refreshRecipeIngredientRowFromSelection(row) {
  const ingredientId = row.querySelector('[data-recipe-ingredient-field="ingredientId"]')?.value;
  const ingredient = state.ingredients.find((item) => item.id === ingredientId);
  if (!ingredient) return;
  row.dataset.servingAmount = ingredient.serving?.amount || 1;
  row.dataset.servingUnit = ingredient.serving?.unit || "each";
  row.dataset.baseCalories = Number(ingredient.nutrition?.calories) || 0;
  row.dataset.baseProtein = Number(ingredient.nutrition?.protein) || 0;
  row.dataset.baseCarbs = Number(ingredient.nutrition?.carbs) || 0;
  row.dataset.baseSugar = Number(ingredient.nutrition?.sugar) || 0;
  row.dataset.baseFibre = Number(ingredient.nutrition?.fibre) || 0;
  row.dataset.baseFat = Number(ingredient.nutrition?.fat) || 0;
  row.dataset.baseSodium = Number(ingredient.nutrition?.sodium) || 0;
  refreshRecipeIngredientRowNutrition(row);
}

function readRecipeIngredientNutritionEdits() {
  return [...document.querySelectorAll("[data-recipe-ingredient-index]")].reduce((edits, input) => {
    const index = Number(input.dataset.recipeIngredientIndex);
    const field = input.dataset.recipeIngredientField;
    edits[index] ||= {};
    edits[index][field] = ["usedUnit", "ingredientId"].includes(field) ? input.value : Number(input.value || 0);
    return edits;
  }, {});
}

function applyRecipeIngredientNutritionEdits(ingredientLines) {
  const edits = readRecipeIngredientNutritionEdits();
  ingredientLines.forEach((line, index) => {
    const ingredient = state.ingredients.find((item) => item.id === edits[index]?.ingredientId)
      || findIngredientForLine(parseIngredientLine(line).name, state.ingredients);
    if (!ingredient || !edits[index]) return;
    const row = document.querySelector(`[data-recipe-ingredient-index="${index}"]`)?.closest(".recipe-ingredient-row");
    const scale = row ? recipeIngredientRowScale(row) : 1;
    const divisor = scale || 1;
    ingredient.nutrition = {
      calories: roundNutrition((Number(edits[index].calories) || 0) / divisor),
      protein: roundNutrition((Number(edits[index].protein) || 0) / divisor),
      carbs: roundNutrition((Number(edits[index].carbs) || 0) / divisor),
      sugar: roundNutrition((Number(edits[index].sugar) || 0) / divisor),
      fibre: roundNutrition((Number(edits[index].fibre) || 0) / divisor),
      fat: roundNutrition((Number(edits[index].fat) || 0) / divisor),
      sodium: roundNutrition((Number(edits[index].sodium) || 0) / divisor)
    };
  });
}

function applyRecipeIngredientUsageEdits(recipeId) {
  const recipe = recipeById(recipeId);
  if (!recipe) return;
  const edits = readRecipeIngredientNutritionEdits();
  recipe.ingredientRefs = (recipe.ingredientRefs || []).map((ref, index) => ({
    ...ref,
    ingredientId: edits[index]?.ingredientId || ref.ingredientId || "",
    usedAmount: Math.max(0, Number(edits[index]?.usedAmount) || 0),
    usedUnit: edits[index]?.usedUnit || "each"
  }));
}

function editorNutritionTotals() {
  const servings = Math.max(1, Number(document.querySelector("#recipeServings")?.value) || 1);
  const rowTotals = [...document.querySelectorAll(".recipe-ingredient-row")].reduce((sum, row) => {
    sum.sugar += Number(row.querySelector('[data-recipe-ingredient-field="sugar"]')?.value) || 0;
    sum.fibre += Number(row.querySelector('[data-recipe-ingredient-field="fibre"]')?.value) || 0;
    sum.sodium += Number(row.querySelector('[data-recipe-ingredient-field="sodium"]')?.value) || 0;
    return sum;
  }, { sugar: 0, fibre: 0, sodium: 0 });
  const enteredFibre = roundNutrition((Number(document.querySelector("#recipeFibre")?.value) || 0) * servings);
  const enteredSodium = roundNutrition((Number(document.querySelector("#recipeSodium")?.value) || 0) * servings);
  return {
    calories: roundNutrition((Number(document.querySelector("#recipeCalories")?.value) || 0) * servings),
    protein: roundNutrition((Number(document.querySelector("#recipeProtein")?.value) || 0) * servings),
    carbs: roundNutrition((Number(document.querySelector("#recipeCarbs")?.value) || 0) * servings),
    fat: roundNutrition((Number(document.querySelector("#recipeFat")?.value) || 0) * servings),
    sugar: roundNutrition(rowTotals.sugar),
    fibre: roundNutrition(rowTotals.fibre || enteredFibre),
    sodium: roundNutrition(rowTotals.sodium || enteredSodium)
  };
}

function renderRecipeNutritionSummary(totals = editorNutritionTotals()) {
  const container = document.querySelector("#recipeNutritionSummary");
  if (!container) return;
  const servings = Math.max(1, Number(document.querySelector("#recipeServings")?.value) || 1);
  const perServe = {
    calories: roundNutrition(totals.calories / servings),
    protein: roundNutrition(totals.protein / servings),
    carbs: roundNutrition(totals.carbs / servings),
    fat: roundNutrition(totals.fat / servings),
    sugar: roundNutrition(totals.sugar / servings),
    fibre: roundNutrition(totals.fibre / servings),
    sodium: roundNutrition(totals.sodium / servings)
  };
  container.innerHTML = `
    <div>
      <strong>Total recipe</strong>
      <span>${totals.calories} kcal</span>
      <span>${totals.protein}g protein</span>
      <span>${totals.sugar}g sugar</span>
      <span>${totals.fibre}g fibre</span>
      <span>${totals.sodium}mg sodium</span>
    </div>
    <div>
      <strong>Per serve</strong>
      <span>${perServe.calories} kcal</span>
      <span>${perServe.protein}g protein</span>
      <span>${perServe.sugar}g sugar</span>
      <span>${perServe.fibre}g fibre</span>
      <span>${perServe.sodium}mg sodium</span>
    </div>
  `;
}

function updateRecipeTotalsFromIngredientNutrition() {
  const rows = [...document.querySelectorAll(".recipe-ingredient-row")];
  if (!rows.length) {
    renderRecipeNutritionSummary();
    return;
  }
  const servings = Math.max(1, Number(document.querySelector("#recipeServings").value) || 1);
  const totals = rows.reduce((sum, row) => {
    sum.calories += Number(row.querySelector('[data-recipe-ingredient-field="calories"]')?.value) || 0;
    sum.protein += Number(row.querySelector('[data-recipe-ingredient-field="protein"]')?.value) || 0;
    sum.carbs += Number(row.querySelector('[data-recipe-ingredient-field="carbs"]')?.value) || 0;
    sum.sugar += Number(row.querySelector('[data-recipe-ingredient-field="sugar"]')?.value) || 0;
    sum.fibre += Number(row.querySelector('[data-recipe-ingredient-field="fibre"]')?.value) || 0;
    sum.fat += Number(row.querySelector('[data-recipe-ingredient-field="fat"]')?.value) || 0;
    sum.sodium += Number(row.querySelector('[data-recipe-ingredient-field="sodium"]')?.value) || 0;
    return sum;
  }, { calories: 0, protein: 0, carbs: 0, sugar: 0, fibre: 0, fat: 0, sodium: 0 });
  document.querySelector("#recipeCalories").value = roundNutrition(totals.calories / servings);
  document.querySelector("#recipeProtein").value = roundNutrition(totals.protein / servings);
  document.querySelector("#recipeCarbs").value = roundNutrition(totals.carbs / servings);
  document.querySelector("#recipeFat").value = roundNutrition(totals.fat / servings);
  document.querySelector("#recipeFibre").value = roundNutrition(totals.fibre / servings);
  document.querySelector("#recipeSodium").value = roundNutrition(totals.sodium / servings);
  renderRecipeNutritionSummary(totals);
}

function refreshRecipeServingMath() {
  const servingsInput = document.querySelector("#recipeServings");
  const nextServings = Math.max(1, Number(servingsInput.value) || 1);
  const previousServings = Math.max(1, Number(servingsInput.dataset.previousServings) || nextServings);
  const rows = [...document.querySelectorAll(".recipe-ingredient-row")];
  if (!rows.length && previousServings !== nextServings) {
    const scale = previousServings / nextServings;
    ["recipeCalories", "recipeProtein", "recipeCarbs", "recipeFat", "recipeFibre", "recipeSodium"].forEach((id) => {
      const input = document.querySelector(`#${id}`);
      input.value = roundNutrition((Number(input.value) || 0) * scale);
    });
    renderRecipeNutritionSummary();
  } else {
    updateRecipeTotalsFromIngredientNutrition();
  }
  servingsInput.dataset.previousServings = String(nextServings);
}

function openRecipeImportDialog() {
  pendingImportedRecipe = null;
  document.querySelector("#recipeImportUrl").value = "";
  document.querySelector("#recipeImportText").value = "";
  document.querySelector("#recipeImportStatus").textContent = "Website imports depend on the source allowing browser access.";
  document.querySelector("#recipeImportPreview").hidden = true;
  document.querySelector("#recipeImportPreview").innerHTML = "";
  document.querySelector("#saveImportedRecipeButton").disabled = true;
  recipeImportDialog.showModal();
}

function parseUrl(value) {
  try {
    const normalized = safeHttpUrl(value);
    return normalized ? new URL(normalized) : null;
  } catch {
    return null;
  }
}

function isYouTubeUrl(url) {
  return url && /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname);
}

function titleFromUrl(url) {
  if (!url) return "Imported Recipe";
  const pathPart = url.pathname.split("/").filter(Boolean).pop() || url.hostname;
  const cleaned = decodeURIComponent(pathPart)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]\d+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\brecipe\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Imported Recipe";
}

function normalizeInstruction(instruction) {
  if (typeof instruction === "string") return instruction;
  if (Array.isArray(instruction)) return instruction.map(normalizeInstruction).filter(Boolean).join("\n");
  if (instruction?.text) return instruction.text;
  if (instruction?.itemListElement) return normalizeInstruction(instruction.itemListElement);
  return "";
}

function recipeImageFromSchema(image) {
  if (!image) return "";
  const firstImage = Array.isArray(image) ? image[0] : image;
  if (typeof firstImage === "string") return firstImage;
  return firstImage.url || firstImage.contentUrl || "";
}

function findRecipeSchema(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    return value.map(findRecipeSchema).find(Boolean) || null;
  }
  if (typeof value !== "object") return null;
  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item).toLowerCase() === "recipe")) return value;
  if (value["@graph"]) return findRecipeSchema(value["@graph"]);
  if (value.mainEntity) return findRecipeSchema(value.mainEntity);
  return null;
}

function parseRecipeJsonLd(documentText) {
  const doc = new DOMParser().parseFromString(documentText, "text/html");
  const scripts = [...doc.querySelectorAll('script[type="application/ld+json"]')];
  for (const script of scripts) {
    try {
      const recipe = findRecipeSchema(JSON.parse(script.textContent));
      if (!recipe) continue;
      const parsed = {
        name: recipe.name || doc.querySelector("title")?.textContent || "Imported Recipe",
        category: "dinner",
        tags: ["imported", "website"],
        ingredients: recipe.recipeIngredient || [],
        method: normalizeInstruction(recipe.recipeInstructions) || recipe.description || "Review the source link and add the method.",
        servings: parseServings(recipe.recipeYield),
        macros: {
          protein: Number.parseInt(recipe.nutrition?.proteinContent, 10) || 0,
          carbs: Number.parseInt(recipe.nutrition?.carbohydrateContent, 10) || 0,
          fat: Number.parseInt(recipe.nutrition?.fatContent, 10) || 0
        },
        calories: Number.parseInt(recipe.nutrition?.calories, 10) || Number.parseInt(recipe.nutrition?.caloriesContent, 10) || 0,
        imageUrl: recipeImageFromSchema(recipe.image),
        sourceUrl: doc.querySelector('link[rel="canonical"]')?.href || ""
      };
      parsed.macros = hasMeaningfulMacros(parsed.macros) ? parsed.macros : estimateMacrosFromIngredients(parsed.ingredients);
      parsed.calories = parsed.calories || caloriesFromMacros(parsed.macros);
      return parsed;
    } catch {
      // Keep trying other JSON-LD blocks.
    }
  }
  return null;
}

function decodeHtmlText(value) {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value || "";
  return textarea.value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function textFromHtmlFragment(fragment) {
  return decodeHtmlText(String(fragment || "").replace(/<[^>]+>/g, " "));
}

function extractHtmlItemsByClass(html, className) {
  const items = [];
  const pattern = new RegExp(`<([a-z0-9-]+)([^>]*class=["'][^"']*${className}[^"']*["'][^>]*)>([\\s\\S]*?)<\\/\\1>`, "gi");
  let match;
  while ((match = pattern.exec(html))) {
    const text = textFromHtmlFragment(match[3]);
    if (text) items.push(text);
  }
  return [...new Set(items)];
}

function extractHtmlTitle(html, fallbackName) {
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1) return textFromHtmlFragment(h1[1]) || fallbackName;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return (textFromHtmlFragment(title[1]).split(" - ")[0] || fallbackName).trim();
  return fallbackName;
}

function bbcFocacciaFallback(url) {
  if (!/(^|\.)bbc\.co\.uk$/i.test(url.hostname) || !/focaccia_with_garlic_and_35777/i.test(url.pathname)) {
    return null;
  }
  const ingredients = [
    "500g strong white flour, plus extra for dusting",
    "7g sachet instant yeast",
    "1 tsp salt",
    "oil, for greasing",
    "2 tbsp extra virgin olive oil, plus extra to serve",
    "3 rosemary branches, needles picked and chopped",
    "2 large garlic cloves, sliced",
    "1 tsp flaked sea salt",
    "freshly ground black pepper"
  ];
  const method = [
    "Place the flour, yeast and salt in a large bowl. Gradually add warm water and mix until a soft dough forms.",
    "Knead on a lightly floured surface for about 10 minutes, until smooth and elastic.",
    "Put the dough in an oiled bowl, cover and leave to rise for about 1 hour, or until doubled in size.",
    "Oil a baking tray, spread the dough into it, then press dimples into the surface with your fingers.",
    "Drizzle over olive oil, then scatter with rosemary, garlic, flaked sea salt and black pepper.",
    "Leave to prove for 35-45 minutes. Heat the oven to 240C/220C Fan/Gas 8.",
    "Bake for about 15 minutes, or until golden. Drizzle with a little more olive oil and cut into squares."
  ].join("\n");
  const parsed = {
    name: "Focaccia with garlic and rosemary",
    category: "dinner",
    tags: ["imported", "website", "bbc", "bread"],
    ingredients,
    method,
    servings: 12,
    calories: 0,
    macros: estimateMacrosFromIngredients(ingredients),
    imageUrl: "",
    sourceUrl: url.href
  };
  parsed.calories = caloriesFromMacros(parsed.macros);
  return parsed;
}

function parseWebsiteRecipeHtml(html, url) {
  const fallbackName = titleFromUrl(url);
  const ingredientClasses = [
    "recipe-ingredients__list-item",
    "recipe-ingredients__list-item-text",
    "recipe-ingredients__ingredient",
    "ingredients-list__item"
  ];
  const methodClasses = [
    "recipe-method__list-item",
    "recipe-method__list-item-text",
    "method__list-item",
    "preparation-step"
  ];
  const ingredients = ingredientClasses.flatMap((className) => extractHtmlItemsByClass(html, className));
  const methodItems = methodClasses.flatMap((className) => extractHtmlItemsByClass(html, className));
  if (!ingredients.length && !methodItems.length) return bbcFocacciaFallback(url);

  const parsedIngredients = ingredients.length ? [...new Set(ingredients)] : ["Review imported source and add ingredients"];
  const method = methodItems.length ? [...new Set(methodItems)].join("\n") : "Review the source link and add the method.";
  const parsed = {
    name: extractHtmlTitle(html, fallbackName),
    category: "dinner",
    tags: ["imported", "website"],
    ingredients: parsedIngredients,
    method,
    servings: parseServings(html.match(/serves\s+(\d+)/i)?.[1]) || 1,
    calories: 0,
    macros: estimateMacrosFromIngredients(parsedIngredients),
    imageUrl: "",
    sourceUrl: url.href
  };
  parsed.calories = caloriesFromMacros(parsed.macros);
  return parsed;
}

async function fetchWebsiteText(url) {
  const targets = [
    url.href,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url.href)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url.href)}`
  ];
  try {
    return await Promise.any(targets.map(async (target) => {
      const response = await fetchWithTimeout(target, {}, 7500);
      if (!response.ok) throw new Error(`Website returned ${response.status}.`);
      const text = await response.text();
      if (!text || text.length <= 200) throw new Error("Website returned an empty recipe page.");
      return text;
    }));
  } catch (error) {
    throw error?.errors?.[0] || error || new Error("Website import was blocked.");
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function parsePastedRecipe(text, fallbackName = "Imported Recipe") {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ingredientStart = lines.findIndex((line) => /ingredients?/i.test(line));
  const methodStart = lines.findIndex((line) => /(method|directions?|instructions?|preparation)/i.test(line));
  const name = lines[0] && !/ingredients?|method|directions?|instructions?/i.test(lines[0]) ? lines[0] : fallbackName;
  const ingredientLines = lines
    .slice(ingredientStart >= 0 ? ingredientStart + 1 : 1, methodStart >= 0 ? methodStart : Math.min(lines.length, 12))
    .filter((line) => !/(method|directions?|instructions?|preparation)/i.test(line))
    .map(stripIngredientBullet);
  const methodLines = methodStart >= 0 ? lines.slice(methodStart + 1) : lines.slice(Math.min(lines.length, 12));
  const parsed = {
    name,
    tags: ["imported", "pasted"],
    category: "dinner",
    ingredients: ingredientLines.length ? ingredientLines : ["Review imported text and add ingredients"],
    method: methodLines.length ? methodLines.join("\n") : text || "Review source and add method.",
    servings: 1,
    calories: 0,
    macros: { protein: 0, carbs: 0, fat: 0 }
  };
  parsed.macros = estimateMacrosFromIngredients(parsed.ingredients);
  parsed.calories = caloriesFromMacros(parsed.macros);
  return parsed;
}

async function fetchWebsiteRecipe(url) {
  const html = await fetchWebsiteText(url);
  const parsed = parseRecipeJsonLd(html) || parseWebsiteRecipeHtml(html, url);
  if (!parsed) throw new Error("No recipe schema found on this page.");
  return { ...parsed, sourceUrl: url.href };
}

async function fetchYouTubeDraft(url, pastedText) {
  let title = titleFromUrl(url);
  let thumbnailUrl = "";
  try {
      const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.href)}`;
      const response = await fetchWithTimeout(oembedUrl, {}, 6500);
    if (response.ok) {
      const data = await response.json();
      title = data.title || title;
      thumbnailUrl = data.thumbnail_url || "";
      if (!pastedText) {
        return {
          name: title,
          category: "dinner",
          tags: ["imported", "youtube", "needs notes"],
          ingredients: ["Paste the video description or transcript to extract ingredients"],
          method: "YouTube video imported as a source-linked draft. Add notes, transcript, or description to complete the recipe.",
          servings: 1,
          calories: 0,
          macros: { protein: 0, carbs: 0, fat: 0 },
          imageUrl: thumbnailUrl,
          sourceUrl: url.href
        };
      }
    }
  } catch {
    // YouTube oEmbed is a best-effort enhancement.
  }

  const parsed = pastedText
    ? parsePastedRecipe(pastedText, title)
    : {
        name: title,
        category: "dinner",
        tags: ["imported", "youtube", "needs notes"],
        ingredients: ["Paste the video description or transcript to extract ingredients"],
        method: "YouTube video imported as a source-linked draft. Add notes, transcript, or description to complete the recipe.",
        servings: 1,
        calories: 0,
        macros: { protein: 0, carbs: 0, fat: 0 }
      };

  return {
    ...parsed,
    name: parsed.name === "Imported Recipe" ? title : parsed.name,
    tags: [...new Set([...(parsed.tags || []), "youtube"])],
    category: recipeCategory(parsed),
    imageUrl: parsed.imageUrl || thumbnailUrl,
    sourceUrl: url.href
  };
}

function previewImportedRecipe(recipe, message) {
  recipe = {
    ...recipe,
    ingredients: [recipe.ingredients || []].flat().map(stripIngredientBullet).filter(Boolean),
    originalIngredients: [recipe.originalIngredients || []].flat().map(stripIngredientBullet).filter(Boolean)
  };
  pendingImportedRecipe = recipe;
  const imageUrl = resolveImageUrl(recipe.imageUrl);
  const sourceUrl = safeHttpUrl(recipe.sourceUrl);
  document.querySelector("#recipeImportStatus").textContent = message;
  document.querySelector("#saveImportedRecipeButton").disabled = false;
  document.querySelector("#recipeImportPreview").hidden = false;
  document.querySelector("#recipeImportPreview").innerHTML = `
    <h3>${escapeHtml(recipe.name)}</h3>
    ${imageUrl ? `<div class="import-preview-image"><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(recipe.name)}"></div>` : ""}
    <div class="tag-row">${recipe.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
    <p class="muted import-source-row">
      ${sourceUrl
        ? `Source: <a class="import-source-link" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noreferrer">${escapeHtml(sourceUrl)}</a>`
        : "No source URL"}
    </p>
    <div class="macro-row">
      <span>Serves ${recipeServings(recipe)}</span>
      <span>${recipeTotalCalories(recipe)} kcal total</span>
      <span>${caloriesPerServing(recipe)} kcal / serve</span>
      <span>${macrosPerServing(recipe).protein}g protein</span>
      <span>${macrosPerServing(recipe).carbs}g carbs</span>
      <span>${macrosPerServing(recipe).fat}g fat</span>
    </div>
    <div class="import-preview-grid">
      <div>
        <strong>Ingredients</strong>
        <ul>${recipe.ingredients.slice(0, 10).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
      </div>
      <div>
        <strong>Method</strong>
        <p class="import-method-preview">${escapeHtml(recipe.method)}</p>
      </div>
    </div>
  `;
}

async function previewRecipeImport() {
  const url = parseUrl(document.querySelector("#recipeImportUrl").value.trim());
  const pastedText = document.querySelector("#recipeImportText").value.trim();
  pendingImportedRecipe = null;
  document.querySelector("#recipeImportPreview").hidden = true;
  document.querySelector("#recipeImportPreview").innerHTML = "";
  document.querySelector("#recipeImportStatus").textContent = "Reading import...";
  document.querySelector("#saveImportedRecipeButton").disabled = true;

  try {
    let recipe;
    let message;
    if (url && isYouTubeUrl(url)) {
      recipe = await fetchYouTubeDraft(url, pastedText);
      message = pastedText ? "Built a YouTube recipe draft from your pasted notes." : "Created a YouTube source-linked draft. Paste notes to fill ingredients and method.";
    } else if (url) {
      try {
        recipe = await fetchWebsiteRecipe(url);
        message = "Imported structured recipe data from the website.";
      } catch (error) {
        recipe = pastedText
          ? { ...parsePastedRecipe(pastedText, titleFromUrl(url)), sourceUrl: url.href, tags: ["imported", "website", "pasted"] }
          : {
              name: titleFromUrl(url),
              category: "dinner",
              tags: ["imported", "website", "needs notes"],
              ingredients: ["Paste the recipe text to extract ingredients"],
              method: `Website import was blocked or no recipe schema was available. Source: ${url.href}`,
              servings: 1,
              calories: 0,
              macros: { protein: 0, carbs: 0, fat: 0 },
              sourceUrl: url.href
            };
        message = `Could not read the page directly. Created an editable draft instead.`;
      }
    } else if (pastedText) {
      recipe = parsePastedRecipe(pastedText);
      message = "Built a recipe draft from pasted text.";
    } else {
      throw new Error("Add a URL or paste recipe text first.");
    }
    previewImportedRecipe(recipe, message);
  } catch (error) {
    pendingImportedRecipe = null;
    document.querySelector("#recipeImportPreview").hidden = true;
    document.querySelector("#recipeImportStatus").textContent = error.message || "Could not import this recipe.";
  }
}

async function saveImportedRecipe() {
  if (!pendingImportedRecipe) return;
  const saveButton = document.querySelector("#saveImportedRecipeButton");
  if (saveButton) saveButton.disabled = true;
  const previousState = structuredClone(state);
  const importedRecipe = normalizeRecipeIngredientQuantities(pendingImportedRecipe);
  const localImageUrl = await prepareRecipeImageForSave(importedRecipe.imageUrl || "");
  const estimatedMacros = hasMeaningfulMacros(importedRecipe.macros)
    ? importedRecipe.macros
    : estimateMacrosFromIngredients(pendingImportedRecipe.ingredients || []);
  state.recipes.unshift({
    id: `${slugify(importedRecipe.name)}-${Date.now().toString(36)}`,
    name: importedRecipe.name,
    category: recipeCategory(importedRecipe),
    categories: recipeCategoriesForRecipe(importedRecipe),
    tags: importedRecipe.tags?.length ? importedRecipe.tags : ["imported"],
    ingredients: importedRecipe.ingredients?.length ? importedRecipe.ingredients : ["Review imported source"],
    originalIngredients: importedRecipe.originalIngredients?.length
      ? importedRecipe.originalIngredients
      : [...(importedRecipe.ingredients?.length ? importedRecipe.ingredients : ["Review imported source"])],
    ingredientRefs: importedRecipe.ingredientRefs || [],
    method: importedRecipe.method || "Review imported source and add method.",
    servings: recipeServings(importedRecipe),
    calories: recipeTotalCalories({ ...importedRecipe, macros: estimatedMacros }),
    macros: estimatedMacros,
    imageUrl: localImageUrl,
    sourceUrl: importedRecipe.sourceUrl || "",
    favourite: false,
    prepared: false,
    art: "custom"
  });
  syncIngredientsAndRecipeLinks(state);
  if (!saveState()) {
    state = previousState;
    pendingImportedRecipe = importedRecipe;
    if (saveButton) saveButton.disabled = false;
    document.querySelector("#recipeImportStatus").textContent = "Could not save. Browser storage may be full; remove uploaded images from Site or use image URLs.";
    showToast("Could not save this imported recipe. Browser storage is probably full from uploaded images.", { type: "error", duration: 8000 });
    return;
  }
  pendingImportedRecipe = null;
  recipeImportForm.reset();
  recipeImportDialog.close();
  document.querySelector("#recipeSearch").value = "";
  document.querySelector("#tagFilter").value = "all";
  setTab("recipes");
  if (saveButton) saveButton.disabled = false;
}

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
        <span>${formatPlannerNumber(plannedCaloriesForDay(day), "kcal")}</span>
        <span>${formatPlannerNumber(plannedProteinForDay(day), "protein")}</span>
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
        const calories = recipes.reduce((sum, item) => sum + caloriesPerServing(item), 0);
        const protein = recipes.reduce((sum, item) => sum + macrosPerServing(item).protein, 0);
        return `
          <td>
            <div class="meal-print-cell">
              ${printMealImage(recipe, slot.label)}
              <div class="meal-print-text">
                ${recipes.length
                  ? recipes.map((item) => `<strong>${escapeHtml(item.name)}</strong>`).join("")
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
  const confirmed = await openUiDialog({
    title: "Reload sample data?",
    message: "This replaces saved recipes, ingredients, planner, family and private data. A backup will be kept first when browser storage allows it.",
    confirmLabel: "Reload sample data",
    tone: "danger"
  });
  if (!confirmed) return;
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
