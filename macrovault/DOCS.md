# MacroVault Add-on Documentation

MacroVault runs as a Python-served Home Assistant add-on with ingress enabled.

The app stores its canonical state in SQLite at `/data/macrovault.db`.

Version 0.3.0 adds relational tables for recipes, ingredients, recipe ingredient links, and tags. On first startup, the app automatically projects the existing JSON state into those tables in the same transaction. The original JSON state and its revision history remain available for compatibility and rollback.

Version 0.5.0 adds the `image_assets` table. Uploaded recipe and ingredient images are stored as SQLite BLOBs and served by `GET /api/images/{id}`. On first startup after upgrading, embedded images are automatically extracted from the live state and revision history. Browser storage retains only lightweight state and image metadata.

Version 0.8.0 adds a monotonically increasing state revision. Browser saves include the revision they loaded, and stale writes receive HTTP 409 instead of silently replacing changes from another device. The browser then asks which version to retain and keeps the local version in its resilience backup.

Version 0.9.0 adds in-app household configuration. The Settings page controls the visible app and household names, profile identity, planner nutrition defaults, and the family-member roster. Member renames migrate linked exercise and weight records; members with weight history cannot be removed until those records are handled.

Schema version 4 adds authoritative `planner_entries` and `shopping_checks` tables. Existing `planner` and `bought` values migrate automatically out of the live state document on startup. `GET /api/state` hydrates these tables back into the existing frontend state shape, and revision snapshots continue to contain the complete state for rollback.

- `GET /api/state` returns the current app state.
- `PUT /api/state` saves the complete state. Pass `expectedRevision` to reject stale writes; successful responses include the new `revision`.
- `PATCH /api/state` replaces non-resource state while preserving recipes and ingredients.
- `PUT /api/resources` transactionally replaces recipe and ingredient collections for imports and large changes.
- `GET /api/schema` returns the schema version, row counts, and migration warnings.
- `GET|POST /api/recipes` lists or creates recipes.
- `GET|PUT|DELETE /api/recipes/{id}` reads, updates, or deletes a recipe.
- `GET|POST /api/ingredients` lists or creates ingredients.
- `GET|PUT|DELETE /api/ingredients/{id}` reads, updates, or deletes an ingredient.
- `GET /api/images/{id}` serves a stored image asset.
- `POST /api/import/recipe` securely fetches a public recipe URL through the add-on and returns a structured review draft.
- The browser still keeps a local backup in `localStorage` for resilience.

## Home Assistant Sidebar

MacroVault includes a Home Assistant menu title and silverware icon. To enable its shortcut for your account, open the MacroVault App page and turn on **Show in sidebar**. Home Assistant stores this as a per-install setting, so an App update cannot enable it automatically.

Home Assistant backups include the database stored in the add-on data directory. The in-app JSON export remains useful as a portable backup before major upgrades.
