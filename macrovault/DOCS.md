# MacroVault Add-on Documentation

MacroVault runs as a Python-served Home Assistant add-on with ingress enabled.

The app stores its canonical state in SQLite at `/data/macrovault.db`.

Version 0.3.0 adds relational tables for recipes, ingredients, recipe ingredient links, and tags. On first startup, the app automatically projects the existing JSON state into those tables in the same transaction. The original JSON state and its revision history remain available for compatibility and rollback.

- `GET /api/state` returns the current app state.
- `PUT /api/state` saves the complete state for backward compatibility and backup restoration.
- `PATCH /api/state` replaces non-resource state while preserving recipes and ingredients.
- `PUT /api/resources` transactionally replaces recipe and ingredient collections for imports and large changes.
- `GET /api/schema` returns the schema version, row counts, and migration warnings.
- `GET|POST /api/recipes` lists or creates recipes.
- `GET|PUT|DELETE /api/recipes/{id}` reads, updates, or deletes a recipe.
- `GET|POST /api/ingredients` lists or creates ingredients.
- `GET|PUT|DELETE /api/ingredients/{id}` reads, updates, or deletes an ingredient.
- The browser still keeps a local backup in `localStorage` for resilience.

## Home Assistant Sidebar

MacroVault includes a Home Assistant menu title and silverware icon. To enable its shortcut for your account, open the MacroVault App page and turn on **Show in sidebar**. Home Assistant stores this as a per-install setting, so an App update cannot enable it automatically.

Home Assistant backups include the database stored in the add-on data directory. The in-app JSON export remains useful as a portable backup before major upgrades.
