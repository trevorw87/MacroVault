const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assets = [
  "app.js",
  "barcode-nutrition.js",
  "frontend-utils.js",
  "icon.svg",
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
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

console.log("Home Assistant asset packaging: PASS");
