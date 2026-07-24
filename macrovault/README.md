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

Recipes, ingredients, recipe links, tags, planner assignments, shopping checks, and uploaded images are stored in dedicated tables. Existing planner and shopping data migrates automatically out of the live JSON document, while complete revision snapshots remain available for rollback. The state API hydrates the relational data into the same browser-compatible shape, and uploaded images are served from SQLite to every device using the app.

The browser keeps a lightweight local backup with `localStorage`. **Export full backup** embeds the server images in the JSON file so it can restore the complete app elsewhere.

Recipe website imports are fetched and parsed by the add-on through `POST /api/import/recipe`; the browser does not send recipe URLs through public CORS proxy services. Import requests are limited to public HTTP/HTTPS destinations and capped in size to protect the Home Assistant network.

To add MacroVault to the Home Assistant sidebar, open its App page and enable **Show in sidebar**.
