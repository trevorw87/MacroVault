# MacroVault Add-on Documentation

MacroVault runs as an nginx-served Home Assistant add-on with ingress enabled.

The app is currently local-first:

- Recipes, pantry, planner, shopping list, lunchbox plans, and family data are stored in browser `localStorage`.
- Home Assistant hosts the app shell, but it does not yet provide shared server-side storage.
- Use the app's export/import controls to move data between devices.

Future shared-data hosting should add a small API and SQLite database inside the add-on.
