# Changelog

## 0.9.23

- Added kilograms (`kg`) to recipe ingredient quantity options.
- Preserved kilogram quantities when parsing recipe ingredient lines instead of treating them as grams.
- Converted kilogram quantities correctly against gram-based nutrition servings.
- Added browser regression coverage for kilogram parsing and nutrition scaling.

## 0.9.22

- Added a Print action to every recipe card.
- Created an A4 recipe sheet with the recipe image, servings, ingredients, instructions, and per-serving nutrition.
- Used clear fallback artwork when a recipe does not have a saved image.
- Added browser regression coverage for printable recipe content.

## 0.9.21

- Preserved explicitly selected database ingredients when their names differ from recipe ingredient text.
- Restored saved database ingredient selections when recipes are reopened for editing.
- Added browser regression coverage for saving and reopening explicit ingredient links.

## 0.9.20

- Preserved manually added and edited ingredients when recipe-generated orphan ingredients are cleaned up.
- Treated existing ingredients from earlier releases as manually saved to prevent accidental data loss.
- Added compact ingredient thumbnails to recipe nutrition rows using saved images or category artwork.
- Updated thumbnails immediately when a different database ingredient is selected.
- Added browser regression coverage for ingredient persistence and recipe-row thumbnails.

## 0.9.19

- Kept manually created ingredients across reloads even when they are not yet linked to a recipe.
- Tracked pending browser changes until Home Assistant confirms the matching server save.
- Recovered unsynced local changes after quick reloads, interrupted uploads, and offline sessions without silently replacing them with older server data.
- Preserved revision conflict protection and retried pending changes when connectivity returns.
- Reported browser storage failures instead of treating an unconfirmed asynchronous server save as successful.
- Added browser regression coverage for standalone ingredient persistence and interrupted-sync recovery.

## 0.9.18

- Automatically removed ingredients with zero recipe uses after recipe links are rebuilt.
- Applied orphan cleanup when recipes are saved, imported, deleted, or ingredients are resynchronized.
- Kept newly added ingredients available during editing until the next recipe-link cleanup.
- Added browser regression coverage for automatic zero-use ingredient removal.

## 0.9.17

- Made ingredient deletion records authoritative over stale server, backup, and synchronization copies.
- Prevented deleted ingredient names and aliases such as Onion and Red Kidney Beans from returning.
- Added a Today badge and stronger highlighting across the current day’s planner category headers and meal boxes.
- Limited current-day highlighting to the actual current week.
- Added browser regression coverage for stale deleted ingredients and current-day planner styling.

## 0.9.16

- Added independently saved, date-based planner weeks with Previous week, Next week, and This week navigation.
- Added rotating Auto-fill that randomly chooses among the least-used eligible recipes and preserves existing selections.
- Added an advance month calendar whose dates open their editable saved week.
- Kept Dashboard meals on the current week while Shopping follows the selected planner week.
- Added the selected date range to printed weekly planners.
- Accelerated ingredient alias consolidation and recipe-usage lookup for faster ingredient searching.
- Added an explicit ingredient Search button and a clearer responsive action toolbar.
- Added browser coverage for future-week persistence, rotation, non-destructive auto-fill, month navigation, and toolbar layout.

## 0.9.15

- Parsed recipe continuation lines beginning with “and” or “plus” without treating quantities and units as ingredient names.
- Decoded punctuation and consolidated malformed flour and confectioners’ sugar ingredient records automatically.
- Merged existing ingredients whose names overlap another ingredient’s aliases, preserving the alias-rich canonical record.
- Redirected recipe ingredient links to the canonical merged ingredient.
- Added browser regression coverage for continuation parsing, malformed-record cleanup, alias merging, and recipe relinking.

## 0.9.14

- Moved Brush teeth (morning) directly after Breakfast in child routines.
- Kept deleted ingredients removed across reloads and add-on updates, including duplicate copies of the same ingredient.
- Made the recipe Ingredients field narrower, taller, and left-aligned beside the image on desktop.
- Cleaned Markdown links, emphasis, and HTML entities from website and pasted recipe ingredients.
- Added browser, responsive layout, frontend utility, and server importer regression coverage.

## 0.9.13

- Added full mixed-number ingredient parsing and scaling for quantities such as 2 1/2 cups.
- Added comma-separated alternate names to the ingredient editor.
- Used ingredient aliases for recipe linking, search, shopping consolidation, and synchronization.
- Prevented alias names from creating duplicate ingredients during recipe synchronization.
- Added browser coverage for mixed measurements, alias persistence, matching, and deduplication.

## 0.9.12

- Reordered child habits with Make bed first, Breakfast second, and Goodnight story last.
- Renamed Yoghurt to Yoghurt / Milk and added a breakfast bowl visual.
- Gave every habit a distinct pastel colour and made each card a large touch and keyboard target.
- Added tap-to-advance behavior for multi-tick habits and tap-to-clear for completed cards.
- Persisted daily habit rollover immediately so completed days keep their reward star and new days start clear.
- Added browser coverage for habit order, colours, touch behavior, rollover clearing, and reward history.

## 0.9.11

- Added household and per-person nutrition totals to each planner day and the printed weekly planner.
- Used per-person nutrition for daily calorie and protein goal progress.
- Gave planner categories distinct pastel colours and centered their headings across responsive layouts.
- Added an In Freezer / Prepared navigation page that automatically tracks recipes marked as prepared.
- Added browser coverage for prepared-meal tracking, category styling, and daily total labels.

## 0.9.10

- Kept deleted built-in recipes removed across reloads and Home Assistant synchronization.
- Limited sample-recipe restoration to new installations and the explicit sample-data reset.
- Changed planner nutrition badges to show calories and protein per serve regardless of the people count.
- Added browser coverage for persistent deletion, sample reset restoration, and per-serve nutrition labels.

## 0.9.9

- Enlarged planner meal thumbnails to make recipe images easier to recognize.
- Added a per-dish people count that defaults to the household size and supports guests.
- Scaled planned nutrition, printed meal plans, and shopping quantities to each dish's people count.
- Added browser coverage for serving-count persistence, shopping scaling, and thumbnail sizing.

## 0.9.8

- Aligned planner meal headings, recipe cards, prepared controls, and add-dish selectors across each day.
- Reserved consistent space for wrapped recipe names and nutrition badges while allowing multiple dishes to expand naturally.
- Added browser geometry checks that prevent wide-screen planner alignment regressions.

## 0.9.7

- Replaced the horizontally scrolling planner table with collapsible full-width day sections.
- Added responsive nine-column, 3-by-3, and single-column meal layouts for wide screens, standard desktops and tablets, and phones.
- Preserved chronological meal progression while removing planner and page overflow.

## 0.9.6

- Moved the sample-data reset into a Settings danger zone with an initial warning and exact typed confirmation.
- Reoriented the desktop and tablet planner so days are rows and meals progress left-to-right, with a pinned day column and preserved mobile day cards.
- Added browser coverage for safe reset cancellation, confirmation, planner axis order, and responsive overflow.

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
