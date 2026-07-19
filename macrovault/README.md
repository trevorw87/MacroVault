# MacroVault

MacroVault is a local-first family meal planning app for Home Assistant.

## Install

1. Add this git repository to Home Assistant:
   - Settings
   - Add-ons
   - Add-on Store
   - Three-dot menu
   - Repositories
2. Paste the repository URL.
3. Install the MacroVault add-on.
4. Start the add-on.
5. Open the Web UI.

## Data

MacroVault stores shared app data in SQLite inside the add-on at `/data/macrovault.db`.

Recipes, ingredients, recipe links, tags, and uploaded images are stored in dedicated tables. Existing installations migrate automatically from the original JSON state, which is retained as a rollback copy. Uploaded images are served from SQLite to every device using the app.

The browser keeps a lightweight local backup with `localStorage`. **Export full backup** embeds the server images in the JSON file so it can restore the complete app elsewhere.

To add MacroVault to the Home Assistant sidebar, open its App page and enable **Show in sidebar**.
