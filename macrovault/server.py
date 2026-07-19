#!/usr/bin/env python3
import json
import mimetypes
import os
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


APP_DIR = Path(os.environ.get("MACROVAULT_APP_DIR", "/app")).resolve()
DATA_DIR = Path(os.environ.get("MACROVAULT_DATA_DIR", "/data")).resolve()
DB_PATH = DATA_DIR / "macrovault.db"
PORT = int(os.environ.get("MACROVAULT_PORT", "8099"))
MAX_BODY_BYTES = 25 * 1024 * 1024
SCHEMA_VERSION = 1
STATE_LOCK = threading.RLock()


class MacroVaultConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def compact_json(value):
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def number(value, default=0):
    if isinstance(value, bool):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def connect_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10, factory=MacroVaultConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    return connection


def create_document_tables(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS app_state (
            id TEXT PRIMARY KEY,
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS state_revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            state_id TEXT NOT NULL,
            state_json TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )


def apply_schema_migrations(db):
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TEXT NOT NULL
        )
        """
    )
    applied = {
        row["version"]
        for row in db.execute("SELECT version FROM schema_migrations").fetchall()
    }
    if 1 not in applied:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS recipes (
                id TEXT PRIMARY KEY,
                position INTEGER NOT NULL,
                name TEXT NOT NULL,
                category TEXT NOT NULL DEFAULT '',
                method TEXT NOT NULL DEFAULT '',
                servings REAL NOT NULL DEFAULT 1,
                calories REAL NOT NULL DEFAULT 0,
                protein REAL NOT NULL DEFAULT 0,
                carbs REAL NOT NULL DEFAULT 0,
                fat REAL NOT NULL DEFAULT 0,
                sugar REAL NOT NULL DEFAULT 0,
                fibre REAL NOT NULL DEFAULT 0,
                image_url TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                favourite INTEGER NOT NULL DEFAULT 0,
                prepared INTEGER NOT NULL DEFAULT 0,
                art TEXT NOT NULL DEFAULT '',
                raw_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ingredients (
                id TEXT PRIMARY KEY,
                position INTEGER NOT NULL,
                name TEXT NOT NULL,
                plural TEXT NOT NULL DEFAULT '',
                aliases_json TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL DEFAULT '',
                barcode TEXT NOT NULL DEFAULT '',
                image_url TEXT NOT NULL DEFAULT '',
                label TEXT NOT NULL DEFAULT '',
                on_hand INTEGER NOT NULL DEFAULT 0,
                serving_amount REAL NOT NULL DEFAULT 1,
                serving_unit TEXT NOT NULL DEFAULT 'each',
                calories REAL NOT NULL DEFAULT 0,
                protein REAL NOT NULL DEFAULT 0,
                carbs REAL NOT NULL DEFAULT 0,
                fat REAL NOT NULL DEFAULT 0,
                sugar REAL NOT NULL DEFAULT 0,
                fibre REAL NOT NULL DEFAULT 0,
                raw_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS ingredients_barcode_unique
                ON ingredients(barcode) WHERE barcode <> '';
            CREATE INDEX IF NOT EXISTS ingredients_name_idx ON ingredients(name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS recipe_ingredients (
                recipe_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                ingredient_id TEXT,
                line TEXT NOT NULL,
                used_amount REAL NOT NULL DEFAULT 0,
                used_unit TEXT NOT NULL DEFAULT '',
                PRIMARY KEY (recipe_id, position),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
                FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE SET NULL
            );
            CREATE INDEX IF NOT EXISTS recipe_ingredients_ingredient_idx
                ON recipe_ingredients(ingredient_id);

            CREATE TABLE IF NOT EXISTS tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE
            );

            CREATE TABLE IF NOT EXISTS recipe_tags (
                recipe_id TEXT NOT NULL,
                tag_id INTEGER NOT NULL,
                position INTEGER NOT NULL,
                PRIMARY KEY (recipe_id, tag_id),
                FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS projection_warnings (
                code TEXT NOT NULL,
                record_id TEXT NOT NULL,
                details_json TEXT NOT NULL,
                detected_at TEXT NOT NULL,
                PRIMARY KEY (code, record_id)
            );
            """
        )
        db.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            (1, "recipes, ingredients, and tags", utc_now()),
        )


def add_projection_warning(db, code, record_id, details, detected_at):
    db.execute(
        """
        INSERT OR REPLACE INTO projection_warnings
            (code, record_id, details_json, detected_at)
        VALUES (?, ?, ?, ?)
        """,
        (code, record_id, compact_json(details), detected_at),
    )


def sync_state_projection(db, state, now=None):
    now = now or utc_now()
    ingredient_created = {
        row["id"]: row["created_at"]
        for row in db.execute("SELECT id, created_at FROM ingredients").fetchall()
    }
    recipe_created = {
        row["id"]: row["created_at"]
        for row in db.execute("SELECT id, created_at FROM recipes").fetchall()
    }
    db.execute("DELETE FROM projection_warnings")
    db.execute("DELETE FROM recipe_ingredients")
    db.execute("DELETE FROM recipe_tags")
    db.execute("DELETE FROM tags")
    db.execute("DELETE FROM recipes")
    db.execute("DELETE FROM ingredients")

    ingredient_ids = set()
    for position, ingredient in enumerate(state.get("ingredients") or []):
        if not isinstance(ingredient, dict):
            add_projection_warning(db, "invalid_ingredient", str(position), {"position": position}, now)
            continue
        ingredient_id = str(ingredient.get("id") or "").strip()
        name = str(ingredient.get("name") or "").strip()
        if not ingredient_id or not name:
            add_projection_warning(
                db,
                "invalid_ingredient",
                ingredient_id or str(position),
                {"position": position, "name": name},
                now,
            )
            continue
        if ingredient_id in ingredient_ids:
            add_projection_warning(
                db,
                "duplicate_ingredient_id",
                ingredient_id,
                {"position": position, "name": name, "resolution": "first record retained"},
                now,
            )
            continue
        ingredient_ids.add(ingredient_id)
        serving = ingredient.get("serving") if isinstance(ingredient.get("serving"), dict) else {}
        nutrition = ingredient.get("nutrition") if isinstance(ingredient.get("nutrition"), dict) else {}
        aliases = ingredient.get("aliases") if isinstance(ingredient.get("aliases"), list) else []
        db.execute(
            """
            INSERT INTO ingredients (
                id, position, name, plural, aliases_json, description, barcode,
                image_url, label, on_hand, serving_amount, serving_unit,
                calories, protein, carbs, fat, sugar, fibre,
                raw_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ingredient_id,
                position,
                name,
                str(ingredient.get("plural") or ""),
                compact_json(aliases),
                str(ingredient.get("description") or ""),
                str(ingredient.get("barcode") or "").strip(),
                str(ingredient.get("imageUrl") or ""),
                str(ingredient.get("label") or ""),
                int(bool(ingredient.get("onHand"))),
                number(serving.get("amount"), 1),
                str(serving.get("unit") or "each"),
                number(nutrition.get("calories")),
                number(nutrition.get("protein")),
                number(nutrition.get("carbs")),
                number(nutrition.get("fat")),
                number(nutrition.get("sugar")),
                number(nutrition.get("fibre")),
                compact_json(ingredient),
                ingredient_created.get(ingredient_id, now),
                now,
            ),
        )

    recipe_ids = set()
    for position, recipe in enumerate(state.get("recipes") or []):
        if not isinstance(recipe, dict):
            add_projection_warning(db, "invalid_recipe", str(position), {"position": position}, now)
            continue
        recipe_id = str(recipe.get("id") or "").strip()
        name = str(recipe.get("name") or "").strip()
        if not recipe_id or not name:
            add_projection_warning(
                db,
                "invalid_recipe",
                recipe_id or str(position),
                {"position": position, "name": name},
                now,
            )
            continue
        if recipe_id in recipe_ids:
            add_projection_warning(
                db,
                "duplicate_recipe_id",
                recipe_id,
                {"position": position, "name": name, "resolution": "first record retained"},
                now,
            )
            continue
        recipe_ids.add(recipe_id)
        macros = recipe.get("macros") if isinstance(recipe.get("macros"), dict) else {}
        nutrition = recipe.get("nutrition") if isinstance(recipe.get("nutrition"), dict) else {}
        db.execute(
            """
            INSERT INTO recipes (
                id, position, name, category, method, servings, calories,
                protein, carbs, fat, sugar, fibre, image_url, source_url,
                favourite, prepared, art, raw_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                recipe_id,
                position,
                name,
                str(recipe.get("category") or ""),
                str(recipe.get("method") or ""),
                number(recipe.get("servings"), 1),
                number(recipe.get("calories")),
                number(macros.get("protein")),
                number(macros.get("carbs")),
                number(macros.get("fat")),
                number(nutrition.get("sugar")),
                number(nutrition.get("fibre")),
                str(recipe.get("imageUrl") or ""),
                str(recipe.get("sourceUrl") or ""),
                int(bool(recipe.get("favourite"))),
                int(bool(recipe.get("prepared"))),
                str(recipe.get("art") or ""),
                compact_json(recipe),
                recipe_created.get(recipe_id, now),
                now,
            ),
        )

        lines = recipe.get("ingredients") if isinstance(recipe.get("ingredients"), list) else []
        refs = recipe.get("ingredientRefs") if isinstance(recipe.get("ingredientRefs"), list) else []
        for line_position, line in enumerate(lines):
            ref = refs[line_position] if line_position < len(refs) and isinstance(refs[line_position], dict) else {}
            linked_id = str(ref.get("ingredientId") or "").strip() or None
            if linked_id not in ingredient_ids:
                if linked_id:
                    add_projection_warning(
                        db,
                        "dangling_ingredient_ref",
                        f"{recipe_id}:{line_position}",
                        {"ingredientId": linked_id, "line": str(line)},
                        now,
                    )
                linked_id = None
            db.execute(
                """
                INSERT INTO recipe_ingredients
                    (recipe_id, position, ingredient_id, line, used_amount, used_unit)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    recipe_id,
                    line_position,
                    linked_id,
                    str(line),
                    number(ref.get("usedAmount")),
                    str(ref.get("usedUnit") or ""),
                ),
            )

        tags = recipe.get("tags") if isinstance(recipe.get("tags"), list) else []
        seen_tags = set()
        for tag_position, tag in enumerate(tags):
            tag_name = str(tag).strip()
            tag_key = tag_name.casefold()
            if not tag_name or tag_key in seen_tags:
                continue
            seen_tags.add(tag_key)
            db.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (tag_name,))
            tag_row = db.execute(
                "SELECT id FROM tags WHERE name = ? COLLATE NOCASE",
                (tag_name,),
            ).fetchone()
            db.execute(
                "INSERT INTO recipe_tags (recipe_id, tag_id, position) VALUES (?, ?, ?)",
                (recipe_id, tag_row["id"], tag_position),
            )


def init_db():
    with STATE_LOCK, connect_db() as db:
        create_document_tables(db)
        apply_schema_migrations(db)
        row = db.execute(
            "SELECT state_json FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
        if row:
            sync_state_projection(db, json.loads(row["state_json"]))


def read_state():
    with connect_db() as db:
        row = db.execute(
            "SELECT state_json, created_at, updated_at FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
    if not row:
        return None
    return {
        "state": json.loads(row["state_json"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def write_state(state):
    serialized = compact_json(state)
    now = utc_now()
    with STATE_LOCK, connect_db() as db:
        current = db.execute(
            "SELECT state_json, created_at FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
        if current:
            db.execute(
                "INSERT INTO state_revisions (state_id, state_json, created_at) VALUES (?, ?, ?)",
                ("default", current["state_json"], now),
            )
            db.execute(
                "UPDATE app_state SET state_json = ?, updated_at = ? WHERE id = ?",
                (serialized, now, "default"),
            )
            created_at = current["created_at"]
        else:
            db.execute(
                "INSERT INTO app_state (id, state_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
                ("default", serialized, now, now),
            )
            created_at = now
        sync_state_projection(db, state, now)
        db.execute(
            """
            DELETE FROM state_revisions
            WHERE id NOT IN (
                SELECT id FROM state_revisions
                WHERE state_id = ?
                ORDER BY id DESC
                LIMIT 25
            )
            """,
            ("default",),
        )
    return {"createdAt": created_at, "updatedAt": now}


def schema_status():
    with connect_db() as db:
        version_row = db.execute("SELECT MAX(version) AS version FROM schema_migrations").fetchone()
        counts = {
            "recipes": db.execute("SELECT COUNT(*) AS count FROM recipes").fetchone()["count"],
            "ingredients": db.execute("SELECT COUNT(*) AS count FROM ingredients").fetchone()["count"],
            "recipeIngredients": db.execute("SELECT COUNT(*) AS count FROM recipe_ingredients").fetchone()["count"],
            "tags": db.execute("SELECT COUNT(*) AS count FROM tags").fetchone()["count"],
        }
        warnings = [
            {
                "code": row["code"],
                "recordId": row["record_id"],
                "details": json.loads(row["details_json"]),
                "detectedAt": row["detected_at"],
            }
            for row in db.execute(
                "SELECT code, record_id, details_json, detected_at FROM projection_warnings ORDER BY code, record_id"
            ).fetchall()
        ]
    return {"version": version_row["version"] or 0, "counts": counts, "warnings": warnings}


def read_resources(resource, resource_id=None):
    table = "recipes" if resource == "recipes" else "ingredients"
    with connect_db() as db:
        if resource_id is None:
            rows = db.execute(f"SELECT raw_json FROM {table} ORDER BY position").fetchall()
            return [json.loads(row["raw_json"]) for row in rows]
        row = db.execute(
            f"SELECT raw_json FROM {table} WHERE id = ?",
            (resource_id,),
        ).fetchone()
    return json.loads(row["raw_json"]) if row else None


def mutate_resource(resource, operation, resource_id, item=None, position=None):
    state_key = resource
    singular = "recipe" if resource == "recipes" else "ingredient"
    with STATE_LOCK:
        stored = read_state()
        if not stored:
            raise LookupError("No MacroVault state stored yet")
        state = stored["state"]
        collection = state.get(state_key)
        if not isinstance(collection, list):
            collection = []
            state[state_key] = collection
        index = next((i for i, value in enumerate(collection) if isinstance(value, dict) and value.get("id") == resource_id), None)

        if operation == "create":
            if index is not None:
                raise FileExistsError(f"{singular.title()} already exists")
            insert_at = max(0, min(position, len(collection))) if isinstance(position, int) else 0
            collection.insert(insert_at, item)
        elif operation == "upsert":
            if index is None:
                insert_at = max(0, min(position, len(collection))) if isinstance(position, int) else len(collection)
                collection.insert(insert_at, item)
            elif isinstance(position, int):
                collection.pop(index)
                collection.insert(max(0, min(position, len(collection))), item)
            else:
                collection[index] = item
        elif operation == "delete":
            if index is None:
                raise LookupError(f"{singular.title()} not found")
            collection.pop(index)
            if resource == "ingredients":
                for recipe in state.get("recipes") or []:
                    for ref in recipe.get("ingredientRefs") or []:
                        if isinstance(ref, dict) and ref.get("ingredientId") == resource_id:
                            ref["ingredientId"] = None
            else:
                for day in (state.get("planner") or {}).values():
                    if isinstance(day, dict):
                        for slot, planned_id in day.items():
                            if planned_id == resource_id:
                                day[slot] = ""
        write_state(state)
    return None if operation == "delete" else item


def replace_resources(recipes, ingredients):
    if not isinstance(recipes, list) or not isinstance(ingredients, list):
        raise ValueError("Recipes and ingredients must be arrays")
    for resource, collection in (("recipe", recipes), ("ingredient", ingredients)):
        for position, item in enumerate(collection):
            if not isinstance(item, dict):
                raise ValueError(f"{resource.title()} at position {position} must be an object")
            if not str(item.get("id") or "").strip() or not str(item.get("name") or "").strip():
                raise ValueError(f"{resource.title()} at position {position} requires id and name")
    with STATE_LOCK:
        stored = read_state()
        state = stored["state"] if stored else {}
        state["recipes"] = recipes
        state["ingredients"] = ingredients
        return write_state(state)


def replace_state_metadata(metadata):
    if not isinstance(metadata, dict):
        raise ValueError("State metadata must be an object")
    with STATE_LOCK:
        stored = read_state()
        current = stored["state"] if stored else {}
        merged = dict(metadata)
        merged["recipes"] = current.get("recipes") or []
        merged["ingredients"] = current.get("ingredients") or []
        return write_state(merged)


def parse_resource_path(path):
    parts = [unquote(part) for part in path.strip("/").split("/")]
    if len(parts) not in (2, 3) or parts[0] != "api" or parts[1] not in ("recipes", "ingredients"):
        return None
    return parts[1], parts[2] if len(parts) == 3 else None


class MacroVaultHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def read_json_body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid content length") from error
        if length <= 0:
            raise ValueError("Request body is required")
        if length > MAX_BODY_BYTES:
            raise OverflowError("Request payload is too large")
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ValueError("Invalid JSON") from error

    def resource_payload(self, payload, resource, resource_id=None):
        singular = "recipe" if resource == "recipes" else "ingredient"
        item = payload.get(singular) if isinstance(payload, dict) and singular in payload else payload
        if not isinstance(item, dict):
            raise ValueError(f"{singular.title()} must be an object")
        item = dict(item)
        item_id = str(resource_id or item.get("id") or f"{singular}-{uuid.uuid4().hex}").strip()
        name = str(item.get("name") or "").strip()
        if not item_id or not name:
            raise ValueError(f"{singular.title()} id and name are required")
        item["id"] = item_id
        item["name"] = name
        return item

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "schemaVersion": SCHEMA_VERSION})
            return
        if parsed.path == "/api/schema":
            self.send_json(HTTPStatus.OK, {"ok": True, **schema_status()})
            return
        if parsed.path == "/api/state":
            stored = read_state()
            if not stored:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "No MacroVault state stored yet."})
                return
            self.send_json(HTTPStatus.OK, {"ok": True, **stored})
            return
        resource_path = parse_resource_path(parsed.path)
        if resource_path:
            resource, resource_id = resource_path
            result = read_resources(resource, resource_id)
            if resource_id and result is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
                return
            self.send_json(HTTPStatus.OK, {"ok": True, resource: result} if resource_id is None else {"ok": True, resource[:-1]: result})
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        resource_path = parse_resource_path(urlparse(self.path).path)
        if not resource_path or resource_path[1] is not None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        self.handle_resource_write("create", resource_path[0], None)

    def do_PUT(self):
        parsed_path = urlparse(self.path).path
        if parsed_path == "/api/state":
            try:
                payload = self.read_json_body()
                state = payload.get("state") if isinstance(payload, dict) else None
                if not isinstance(state, dict):
                    raise ValueError("State must be an object")
                metadata = write_state(state)
            except OverflowError as error:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
                return
            except (ValueError, sqlite3.IntegrityError) as error:
                self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": str(error)})
                return
            self.send_json(HTTPStatus.OK, {"ok": True, **metadata})
            return
        if parsed_path == "/api/resources":
            self.handle_resource_replace()
            return
        resource_path = parse_resource_path(parsed_path)
        if not resource_path or resource_path[1] is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        self.handle_resource_write("upsert", *resource_path)

    def do_PATCH(self):
        if urlparse(self.path).path != "/api/state":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        try:
            payload = self.read_json_body()
            metadata = payload.get("state") if isinstance(payload, dict) else None
            result = replace_state_metadata(metadata)
        except OverflowError as error:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
            return
        except (ValueError, sqlite3.IntegrityError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": str(error)})
            return
        self.send_json(HTTPStatus.OK, {"ok": True, **result})

    def do_DELETE(self):
        resource_path = parse_resource_path(urlparse(self.path).path)
        if not resource_path or resource_path[1] is None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        resource, resource_id = resource_path
        try:
            mutate_resource(resource, "delete", resource_id)
        except LookupError as error:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": str(error)})
            return
        self.send_json(HTTPStatus.OK, {"ok": True})

    def handle_resource_write(self, operation, resource, resource_id):
        try:
            payload = self.read_json_body()
            item = self.resource_payload(payload, resource, resource_id)
            position = payload.get("position") if isinstance(payload, dict) else None
            if position is not None and (isinstance(position, bool) or not isinstance(position, int)):
                raise ValueError("Resource position must be an integer")
            result = mutate_resource(resource, operation, item["id"], item, position)
        except OverflowError as error:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
            return
        except FileExistsError as error:
            self.send_json(HTTPStatus.CONFLICT, {"ok": False, "message": str(error)})
            return
        except LookupError as error:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": str(error)})
            return
        except (ValueError, sqlite3.IntegrityError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": str(error)})
            return
        singular = "recipe" if resource == "recipes" else "ingredient"
        status = HTTPStatus.CREATED if operation == "create" else HTTPStatus.OK
        self.send_json(status, {"ok": True, singular: result})

    def handle_resource_replace(self):
        try:
            payload = self.read_json_body()
            recipes = payload.get("recipes") if isinstance(payload, dict) else None
            ingredients = payload.get("ingredients") if isinstance(payload, dict) else None
            result = replace_resources(recipes, ingredients)
        except OverflowError as error:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
            return
        except (ValueError, sqlite3.IntegrityError) as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": str(error)})
            return
        self.send_json(HTTPStatus.OK, {"ok": True, **result})

    def serve_static(self, request_path):
        clean_path = unquote(request_path).split("?", 1)[0]
        if clean_path in ("", "/"):
            clean_path = "/index.html"
        target = (APP_DIR / clean_path.lstrip("/")).resolve()
        if APP_DIR not in target.parents and target != APP_DIR:
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.exists():
            target = APP_DIR / "index.html"
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        if target.name == "service-worker.js":
            self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    init_db()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), MacroVaultHandler)
    print(
        f"MacroVault listening on port {PORT}; database at {DB_PATH}; schema v{SCHEMA_VERSION}",
        flush=True,
    )
    server.serve_forever()
