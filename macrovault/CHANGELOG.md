# Changelog

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
