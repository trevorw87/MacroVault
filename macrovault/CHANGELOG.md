# Changelog

## 0.7.1

- Automatically recalculated imported nutrition when the reviewed serving amount changes.
- Prevented silent mass-to-volume conversions and prompted for package-label correction instead.

## 0.7.0

- Added sodium in milligrams throughout ingredient, recipe, nutrition-label, and barcode workflows.
- Made imported barcode product names, serving sizes, and nutrition values editable before applying them.
- Bumped the offline cache so installed and Home Assistant clients receive the updated forms.

## 0.6.4

- Normalized Open Food Facts v3 and legacy nutrition without mixing per-100 and per-serving values.
- Preserved the nutrition basis supplied by the product instead of scaling it a second time.
- Added confidence checks and an explicit review step before importing barcode nutrition.
- Added regression tests for per-100g, per-serving, structured v3, and invalid nutrition data.

## 0.6.3

- Bundled the barcode decoder locally instead of loading a broken external CDN URL.
- Added the decoder to the offline app cache for reliable camera and photo scanning.
- Changed Upload photo to open the iPad photo picker instead of forcing camera capture.

## 0.6.2

- Allowed Add Ingredient to close or cancel without satisfying required fields.
- Made the ingredient barcode action start scanning when no barcode has been typed.
- Improved iPad and Safari scanning with rear-camera constraints, scan cleanup, and actionable camera errors.
- Bumped the offline cache so installed clients receive the fixes immediately.

## 0.5.0

- Added dedicated SQLite BLOB storage and HTTP delivery for uploaded images.
- Added automatic migration of embedded images from live state and revision history.
- Reduced browser backups to image metadata while keeping full JSON exports portable.
- Updated the image storage screen to report server-managed storage accurately.

## 0.4.0

- Routed recipe and ingredient saves through dedicated resource APIs.
- Added idempotent resource upserts, transactional bulk resource sync, and partial app-state saves.
- Preserved the legacy whole-state API for backup imports and rollback compatibility.
- Documented the Home Assistant sidebar shortcut setting.

## 0.3.0

- Added versioned relational SQLite tables for recipes, ingredients, recipe links, and tags.
- Added automatic, transactional migration from the existing JSON app state.
- Added recipe and ingredient CRUD APIs plus schema diagnostics.
- Kept the original app state and revision history for rollback and compatibility.

## 0.2.0

- Added SQLite-backed state storage and API inside the add-on.

## 0.1.0

- Initial Home Assistant add-on wrapper for MacroVault.
