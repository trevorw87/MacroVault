// MacroVault recipe, ingredient, image, barcode, and import editors.
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
  document.querySelector("#recipeImportStatus").textContent = "Website recipes are imported securely through Home Assistant.";
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
  const result = await requestServerJson("api/import/recipe", {
    method: "POST",
    body: { url: url.href }
  });
  if (!result?.recipe) throw new Error("Home Assistant did not return a recipe draft.");
  return result;
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
    if (url) {
      try {
        const imported = await fetchWebsiteRecipe(url);
        recipe = imported.recipe;
        message = imported.message || "Imported structured recipe data through Home Assistant.";
        if (isYouTubeUrl(url) && pastedText) {
          const pasted = parsePastedRecipe(pastedText, recipe.name);
          recipe = {
            ...recipe,
            ...pasted,
            name: pasted.name === "Imported Recipe" ? recipe.name : pasted.name,
            tags: [...new Set([...(recipe.tags || []), ...(pasted.tags || []), "youtube"])],
            imageUrl: recipe.imageUrl || "",
            sourceUrl: recipe.sourceUrl || url.href
          };
          message = "Built a YouTube recipe draft from server details and your pasted notes.";
        }
      } catch (error) {
        if (!pastedText) {
          throw new Error(`${error.message || "Home Assistant could not import this page."} You can paste the recipe text instead.`);
        }
        recipe = { ...parsePastedRecipe(pastedText, titleFromUrl(url)), sourceUrl: url.href, tags: ["imported", "website", "pasted"] };
        message = "The website could not be read, so an editable draft was built from your pasted text.";
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
