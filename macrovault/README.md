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

The browser keeps a local backup with `localStorage`, and the in-app JSON export/import buttons are still available for manual backups.
