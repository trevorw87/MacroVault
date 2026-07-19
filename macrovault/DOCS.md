# MacroVault Add-on Documentation

MacroVault runs as a Python-served Home Assistant add-on with ingress enabled.

The app stores its canonical state in SQLite at `/data/macrovault.db`.

- `GET /api/state` returns the current app state.
- `PUT /api/state` saves the current app state.
- The browser still keeps a local backup in `localStorage` for resilience.

Future versions can split the JSON state into relational recipe, ingredient, planner, pantry, and family tables.
