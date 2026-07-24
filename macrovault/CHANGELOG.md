# Changelog

## 0.9.5

- Split the large frontend JavaScript and stylesheet files into ordered feature modules for safer maintenance and testing.
- Added packaging checks for module load order, Home Assistant synchronization, and offline availability.

## 0.9.4

- Added monthly child reward charts with full-day stars, partial progress, configurable targets and rewards, retained history, and parent corrections.
- Reworked the mobile planner into collapsible day cards, compacted mobile navigation and dashboard cards, and improved tablet and desktop overflow handling.
- Moved planner assignments and shopping checks into authoritative relational SQLite tables with automatic schema migration and complete rollback snapshots.
- Moved website and YouTube recipe importing into the Home Assistant add-on with private-network protection, redirect validation, timeouts, and page-size limits.
- Expanded browser and server coverage for responsive layouts, planner-to-shopping generation, relational migration, and server-side imports.

## 0.9.3

- Added child-only routines for making the bed, morning and night tooth brushing, showering or bathing, and a goodnight story.
- Removed common bullet and numbered-list markers from imported ingredient lines.
- Added multiple dishes per planner meal with combined nutrition, shopping, dashboard, and print output.
- Added full recipe duplication for quickly creating flavour and ingredient variations.

## 0.9.2

- Fixed child family cards collapsing and habit controls overflowing at responsive widths.
- Consolidated duplicate shopping ingredients while preserving quantities from different unit groups.
- Added per-person target weights with progress summaries and a target line on the weight chart.
- Fixed recipe editor cancel controls when required fields are empty.

## 0.9.1

- Fixed the image-storage cleanup action so it reports whether unused uploads were removed.
- Added the missing action for removing broken recipe and ingredient image links.
- Prevented valid server-backed images from being incorrectly reported as missing.

## 0.9.0

- Added a Settings page for app, household, profile, nutrition-goal, and family-member configuration.
- Replaced hardcoded family-member behavior with configurable adult and child roles.
- Migrated weight history, selected-person state, exercise data, habits, ratings, and goals when members are renamed.
- Prevented removal of a family member while weight-history records still depend on that member.
- Added responsive configuration layouts and browser coverage for configuration persistence and member migration.

## 0.8.0

- Added revision-based optimistic concurrency so stale devices cannot silently overwrite newer Home Assistant data.
- Added an explicit sync-conflict choice and preserved the local version as a browser backup.
- Hardened dynamic HTML, external URLs, image URLs, and server response headers.
- Added frontend safety tests and a Playwright browser smoke and injection suite.
- Extracted shared frontend safety utilities and automated add-on asset synchronization.
- Corrected documentation for the features currently present in the app.

## 0.7.5

- Added an editable recipe-source URL field directly below the method.
- Prefilled the source field with the website or video URL captured during recipe import.

## 0.7.4

- Increased recipe-card image height while preserving proportional center-cropping.

## 0.7.3

- Added a separate original-ingredients reference field above the recipe method.
- Populated both working and original ingredient lists when importing recipes.
- Preserved original ingredients independently when the working list is edited for linking and nutrition.

## 0.7.2

- Standardized the dashboard snack cards and their image frames to a consistent height.
- Center-cropped portrait and landscape snack photos without changing the larger meal cards.

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
