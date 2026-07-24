const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assets = [
  "app-core.js",
  "app-editors.js",
  "app-features.js",
  "app-views.js",
  "app.js",
  "barcode-nutrition.js",
  "frontend-utils.js",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "styles-content.css",
  "styles-core.css",
  "styles-family.css",
  "styles-responsive.css",
  "styles.css",
  "zxing-browser.min.js",
  "ZXING-LICENSE.txt"
];

function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

for (const asset of assets) {
  const source = path.join(root, asset);
  const packaged = path.join(root, "macrovault", "app", asset);
  assert.ok(fs.existsSync(packaged), `${asset} must be included in the Home Assistant package`);
  assert.equal(digest(packaged), digest(source), `${asset} package copy is stale; run pnpm sync:addon`);
}

const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptOrder = [
  "frontend-utils.js",
  "app-core.js",
  "app-views.js",
  "app-editors.js",
  "app-features.js",
  "app.js"
];
let previousScriptPosition = -1;
for (const script of scriptOrder) {
  const position = index.indexOf(`src="${script}`);
  assert.ok(position > previousScriptPosition, `${script} must load in the expected frontend module order`);
  previousScriptPosition = position;
}

const stylesheet = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const stylesheetOrder = [
  "styles-core.css",
  "styles-content.css",
  "styles-family.css",
  "styles-responsive.css"
];
let previousStylesheetPosition = -1;
for (const moduleName of stylesheetOrder) {
  const position = stylesheet.indexOf(moduleName);
  assert.ok(position > previousStylesheetPosition, `${moduleName} must load in the expected stylesheet module order`);
  previousStylesheetPosition = position;
}

const serviceWorker = fs.readFileSync(path.join(root, "service-worker.js"), "utf8");
for (const moduleName of [...scriptOrder.slice(1), ...stylesheetOrder]) {
  assert.ok(serviceWorker.includes(`./${moduleName}`), `${moduleName} must be available in the offline cache`);
}

console.log("Home Assistant asset packaging: PASS");
