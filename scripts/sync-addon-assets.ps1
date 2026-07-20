$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$destination = Join-Path $root "macrovault\app"
$assets = @(
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
)

foreach ($asset in $assets) {
  Copy-Item -LiteralPath (Join-Path $root $asset) -Destination (Join-Path $destination $asset) -Force
}

Write-Output "Synchronized $($assets.Count) frontend assets into macrovault/app."
