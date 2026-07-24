#!/usr/bin/env python3
import base64
import binascii
import ipaddress
import json
import mimetypes
import os
import re
import socket
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener


APP_DIR = Path(os.environ.get("MACROVAULT_APP_DIR", "/app")).resolve()
DATA_DIR = Path(os.environ.get("MACROVAULT_DATA_DIR", "/data")).resolve()
DB_PATH = DATA_DIR / "macrovault.db"
PORT = int(os.environ.get("MACROVAULT_PORT", "8099"))
MAX_BODY_BYTES = 25 * 1024 * 1024
MAX_RECIPE_PAGE_BYTES = 2 * 1024 * 1024
RECIPE_FETCH_TIMEOUT = 12
SCHEMA_VERSION = 4
STATE_LOCK = threading.RLock()


class StateConflictError(RuntimeError):
    def __init__(self, revision, updated_at):
        super().__init__("MacroVault changed on another device")
        self.revision = revision
        self.updated_at = updated_at


class UnsafeImportUrlError(ValueError):
    pass


class RecipeImportError(RuntimeError):
    pass


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


def validate_external_url(value):
    parsed = urlparse(str(value or "").strip())
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise UnsafeImportUrlError("Enter a public HTTP or HTTPS recipe URL.")
    hostname = parsed.hostname.rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise UnsafeImportUrlError("Private or local network URLs cannot be imported.")
    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
    except socket.gaierror as error:
        raise RecipeImportError("The recipe website could not be found.") from error
    if not addresses:
        raise RecipeImportError("The recipe website could not be found.")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0].split("%", 1)[0])
        if not ip.is_global:
            raise UnsafeImportUrlError("Private or local network URLs cannot be imported.")
    return parsed.geturl()


class SafeRecipeRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        validate_external_url(new_url)
        return super().redirect_request(request, file_pointer, code, message, headers, new_url)


def fetch_external_text(url):
    safe_url = validate_external_url(url)
    request = Request(
        safe_url,
        headers={
            "Accept": "text/html,application/xhtml+xml;q=0.9,application/json;q=0.5",
            "Accept-Language": "en-GB,en;q=0.8",
            "User-Agent": "Mozilla/5.0 (compatible; MacroVaultRecipeImporter/1.0; +https://github.com/trevorw87/macrovault)",
        },
    )
    try:
        with build_opener(SafeRecipeRedirectHandler()).open(request, timeout=RECIPE_FETCH_TIMEOUT) as response:
            content_type = str(response.headers.get_content_type() or "").lower()
            if content_type not in ("text/html", "application/xhtml+xml", "application/json", "text/plain"):
                raise RecipeImportError("The URL did not return a recipe webpage.")
            body = response.read(MAX_RECIPE_PAGE_BYTES + 1)
            if len(body) > MAX_RECIPE_PAGE_BYTES:
                raise OverflowError("The recipe webpage is too large to import safely.")
            charset = response.headers.get_content_charset() or "utf-8"
            text = body.decode(charset, errors="replace")
            if len(text.strip()) < 100:
                raise RecipeImportError("The recipe website returned an empty page.")
            return text, response.geturl()
    except HTTPError as error:
        raise RecipeImportError(f"The recipe website returned HTTP {error.code}.") from error
    except URLError as error:
        raise RecipeImportError("The recipe website could not be reached from Home Assistant.") from error
    except TimeoutError as error:
        raise RecipeImportError("The recipe website took too long to respond.") from error


class RecipePageParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.json_ld = []
        self.title_parts = []
        self.canonical = ""
        self._script_parts = None
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attributes = {str(key).lower(): value for key, value in attrs}
        if tag.lower() == "script" and str(attributes.get("type") or "").lower().split(";", 1)[0].strip() == "application/ld+json":
            self._script_parts = []
        elif tag.lower() == "title":
            self._in_title = True
        elif tag.lower() == "link" and "canonical" in str(attributes.get("rel") or "").lower().split():
            self.canonical = str(attributes.get("href") or "").strip()

    def handle_endtag(self, tag):
        if tag.lower() == "script" and self._script_parts is not None:
            self.json_ld.append("".join(self._script_parts))
            self._script_parts = None
        elif tag.lower() == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._script_parts is not None:
            self._script_parts.append(data)
        elif self._in_title:
            self.title_parts.append(data)


def find_recipe_schema(value):
    if isinstance(value, list):
        for item in value:
            recipe = find_recipe_schema(item)
            if recipe:
                return recipe
        return None
    if not isinstance(value, dict):
        return None
    schema_type = value.get("@type")
    types = schema_type if isinstance(schema_type, list) else [schema_type]
    if any(str(item or "").casefold() == "recipe" for item in types):
        return value
    for key in ("@graph", "mainEntity", "mainEntityOfPage", "itemListElement"):
        recipe = find_recipe_schema(value.get(key))
        if recipe:
            return recipe
    return None


def instruction_text(value):
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        return "\n".join(filter(None, (instruction_text(item) for item in value)))
    if isinstance(value, dict):
        return instruction_text(value.get("text") or value.get("itemListElement") or value.get("steps"))
    return ""


def first_image_url(value):
    image = value[0] if isinstance(value, list) and value else value
    if isinstance(image, str):
        return image.strip()
    if isinstance(image, dict):
        return str(image.get("url") or image.get("contentUrl") or "").strip()
    return ""


def numeric_text(value):
    match = re.search(r"-?\d+(?:[.,]\d+)?", str(value or ""))
    return float(match.group(0).replace(",", ".")) if match else 0


def serving_count(value):
    if isinstance(value, list):
        value = value[0] if value else ""
    count = numeric_text(value)
    return max(1, int(count or 1))


def clean_html_text(value):
    text = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", unescape(text)).strip()


def absolute_http_url(base_url, value):
    if not str(value or "").strip():
        return ""
    resolved = urljoin(base_url, str(value).strip())
    return resolved if urlparse(resolved).scheme in ("http", "https") else ""


def html_items_by_class(html, class_name):
    pattern = re.compile(
        rf"<([a-z0-9-]+)([^>]*class=[\"'][^\"']*\b{re.escape(class_name)}\b[^\"']*[\"'][^>]*)>([\s\S]*?)</\1>",
        re.IGNORECASE,
    )
    return list(dict.fromkeys(filter(None, (clean_html_text(match.group(3)) for match in pattern.finditer(html)))))


def parse_recipe_page(html, source_url):
    parser = RecipePageParser()
    parser.feed(html)
    recipe_schema = None
    for block in parser.json_ld:
        try:
            cleaned_block = block.strip().removeprefix("<!--").removesuffix("-->").strip().removesuffix(";")
            recipe_schema = find_recipe_schema(json.loads(cleaned_block))
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        if recipe_schema:
            break
    source = absolute_http_url(source_url, parser.canonical) or source_url
    if recipe_schema:
        nutrition = recipe_schema.get("nutrition") if isinstance(recipe_schema.get("nutrition"), dict) else {}
        ingredients = recipe_schema.get("recipeIngredient") or recipe_schema.get("ingredients") or []
        if isinstance(ingredients, str):
            ingredients = [ingredients]
        ingredients = [str(item).strip() for item in ingredients if str(item).strip()]
        macros = {
            "protein": numeric_text(nutrition.get("proteinContent")),
            "carbs": numeric_text(nutrition.get("carbohydrateContent")),
            "fat": numeric_text(nutrition.get("fatContent")),
        }
        calories = numeric_text(nutrition.get("calories") or nutrition.get("caloriesContent"))
        if not calories:
            calories = round((macros["protein"] * 4) + (macros["carbs"] * 4) + (macros["fat"] * 9))
        return {
            "name": str(recipe_schema.get("name") or "").strip() or clean_html_text("".join(parser.title_parts)) or "Imported Recipe",
            "category": "dinner",
            "tags": ["imported", "website"],
            "ingredients": ingredients or ["Review imported source and add ingredients"],
            "method": instruction_text(recipe_schema.get("recipeInstructions")) or str(recipe_schema.get("description") or "").strip() or "Review the source link and add the method.",
            "servings": serving_count(recipe_schema.get("recipeYield")),
            "macros": macros,
            "calories": calories,
            "imageUrl": absolute_http_url(source_url, first_image_url(recipe_schema.get("image"))),
            "sourceUrl": source,
        }

    ingredient_classes = (
        "recipe-ingredients__list-item", "recipe-ingredients__list-item-text",
        "recipe-ingredients__ingredient", "ingredients-list__item",
    )
    method_classes = (
        "recipe-method__list-item", "recipe-method__list-item-text",
        "method__list-item", "preparation-step",
    )
    ingredients = list(dict.fromkeys(item for class_name in ingredient_classes for item in html_items_by_class(html, class_name)))
    methods = list(dict.fromkeys(item for class_name in method_classes for item in html_items_by_class(html, class_name)))
    if not ingredients and not methods:
        raise RecipeImportError("No structured recipe data was found on this page.")
    title_match = re.search(r"<h1[^>]*>([\s\S]*?)</h1>", html, re.IGNORECASE)
    title = clean_html_text(title_match.group(1)) if title_match else clean_html_text("".join(parser.title_parts))
    return {
        "name": title or "Imported Recipe",
        "category": "dinner",
        "tags": ["imported", "website"],
        "ingredients": ingredients or ["Review imported source and add ingredients"],
        "method": "\n".join(methods) if methods else "Review the source link and add the method.",
        "servings": serving_count(re.search(r"serves\s+(\d+)", html, re.IGNORECASE).group(1) if re.search(r"serves\s+(\d+)", html, re.IGNORECASE) else 1),
        "macros": {"protein": 0, "carbs": 0, "fat": 0},
        "calories": 0,
        "imageUrl": "",
        "sourceUrl": source,
    }


def import_recipe_from_url(url):
    parsed = urlparse(str(url or "").strip())
    hostname = str(parsed.hostname or "").lower()
    if hostname == "youtu.be" or hostname.endswith(".youtube.com"):
        validate_external_url(url)
        oembed_url = f"https://www.youtube.com/oembed?format=json&url={quote(parsed.geturl(), safe='')}"
        text, _ = fetch_external_text(oembed_url)
        try:
            metadata = json.loads(text)
        except json.JSONDecodeError as error:
            raise RecipeImportError("YouTube did not return usable video details.") from error
        return {
            "name": str(metadata.get("title") or "Imported YouTube recipe").strip(),
            "category": "dinner",
            "tags": ["imported", "youtube", "needs notes"],
            "ingredients": ["Paste the video description or transcript to extract ingredients"],
            "method": "YouTube video imported as a source-linked draft. Add notes, transcript, or description to complete the recipe.",
            "servings": 1,
            "calories": 0,
            "macros": {"protein": 0, "carbs": 0, "fat": 0},
            "imageUrl": str(metadata.get("thumbnail_url") or ""),
            "sourceUrl": parsed.geturl(),
        }
    html, final_url = fetch_external_text(url)
    return parse_recipe_page(html, final_url)


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
    if 2 not in applied:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS image_assets (
                id TEXT PRIMARY KEY,
                content_type TEXT NOT NULL,
                data BLOB NOT NULL,
                size_bytes INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        db.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            (2, "server-managed image assets", utc_now()),
        )
    if 3 not in applied:
        columns = {
            row["name"]
            for row in db.execute("PRAGMA table_info(app_state)").fetchall()
        }
        if "revision" not in columns:
            db.execute("ALTER TABLE app_state ADD COLUMN revision INTEGER NOT NULL DEFAULT 1")
        db.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            (3, "optimistic state revisions", utc_now()),
        )
    if 4 not in applied:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS planner_entries (
                day_key TEXT NOT NULL,
                slot_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                recipe_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (day_key, slot_id, position)
            );
            CREATE INDEX IF NOT EXISTS planner_entries_recipe_idx
                ON planner_entries(recipe_id);
            CREATE INDEX IF NOT EXISTS planner_entries_day_idx
                ON planner_entries(day_key, slot_id, position);

            CREATE TABLE IF NOT EXISTS shopping_checks (
                item_name TEXT PRIMARY KEY,
                position INTEGER NOT NULL,
                checked_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS shopping_checks_position_idx
                ON shopping_checks(position);
            """
        )
        db.execute(
            "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
            (4, "relational planner and shopping state", utc_now()),
        )


def decode_image_data_url(value):
    if not isinstance(value, str) or not value.startswith("data:image/") or "," not in value:
        raise ValueError("Image asset data must be an embedded image")
    header, encoded = value.split(",", 1)
    if ";base64" not in header:
        raise ValueError("Image asset must use base64 encoding")
    content_type = header[5:].split(";", 1)[0].lower()
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Image asset contains invalid base64 data") from error
    if not data:
        raise ValueError("Image asset is empty")
    if len(data) > MAX_BODY_BYTES:
        raise OverflowError("Image asset is too large")
    return content_type, data


def store_state_image_assets(db, state, now=None, prune=True):
    """Move embedded image data into image_assets and leave metadata in state."""
    now = now or utc_now()
    library_present = isinstance(state.get("imageLibrary"), dict)
    library = state.get("imageLibrary") if library_present else {}
    metadata = {}

    for key, asset in library.items():
        if not isinstance(asset, dict):
            continue
        asset_id = str(asset.get("id") or key).strip()
        if not asset_id:
            continue
        created_at = str(asset.get("createdAt") or now)
        embedded = asset.get("data")
        if embedded:
            content_type, data = decode_image_data_url(embedded)
            db.execute(
                """
                INSERT INTO image_assets
                    (id, content_type, data, size_bytes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    content_type = excluded.content_type,
                    data = excluded.data,
                    size_bytes = excluded.size_bytes,
                    updated_at = excluded.updated_at
                """,
                (asset_id, content_type, data, len(data), created_at, now),
            )
        row = db.execute(
            "SELECT content_type, size_bytes, created_at FROM image_assets WHERE id = ?",
            (asset_id,),
        ).fetchone()
        if row:
            metadata[asset_id] = {
                "id": asset_id,
                "contentType": row["content_type"],
                "sizeBytes": row["size_bytes"],
                "createdAt": row["created_at"],
            }

    if library_present:
        state["imageLibrary"] = metadata
        if prune:
            retained_ids = list(metadata)
            if retained_ids:
                placeholders = ",".join("?" for _ in retained_ids)
                db.execute(f"DELETE FROM image_assets WHERE id NOT IN ({placeholders})", retained_ids)
            else:
                db.execute("DELETE FROM image_assets")
    return state


def add_projection_warning(db, code, record_id, details, detected_at):
    db.execute(
        """
        INSERT OR REPLACE INTO projection_warnings
            (code, record_id, details_json, detected_at)
        VALUES (?, ?, ?, ?)
        """,
        (code, record_id, compact_json(details), detected_at),
    )


def state_document_without_relational_data(state):
    document = dict(state or {})
    document.pop("planner", None)
    document.pop("bought", None)
    return document


def relational_state(db):
    planner = {}
    for row in db.execute(
        "SELECT day_key, slot_id, recipe_id FROM planner_entries ORDER BY day_key, slot_id, position"
    ).fetchall():
        planner.setdefault(row["day_key"], {}).setdefault(row["slot_id"], []).append(row["recipe_id"])
    bought = [
        row["item_name"]
        for row in db.execute("SELECT item_name FROM shopping_checks ORDER BY position, item_name").fetchall()
    ]
    return {"planner": planner, "bought": bought}


def hydrate_relational_state(db, document):
    state = dict(document or {})
    state.update(relational_state(db))
    return state


def sync_planner_and_shopping(db, state, recipe_ids, now):
    if "planner" in state:
        planner_created = {
            (row["day_key"], row["slot_id"], row["recipe_id"]): row["created_at"]
            for row in db.execute(
                "SELECT day_key, slot_id, recipe_id, created_at FROM planner_entries"
            ).fetchall()
        }
        db.execute("DELETE FROM planner_entries")
        planner = state.get("planner") if isinstance(state.get("planner"), dict) else {}
        for day_key, day_plan in planner.items():
            if not isinstance(day_plan, dict):
                add_projection_warning(db, "invalid_planner_day", str(day_key), {}, now)
                continue
            for slot_id, selected in day_plan.items():
                selected_ids = selected if isinstance(selected, list) else [selected]
                seen_ids = set()
                position = 0
                for selected_id in selected_ids:
                    recipe_id = str(selected_id or "").strip()
                    if not recipe_id or recipe_id in seen_ids:
                        continue
                    seen_ids.add(recipe_id)
                    if recipe_id not in recipe_ids:
                        add_projection_warning(
                            db,
                            "dangling_planner_recipe",
                            f"{day_key}:{slot_id}:{recipe_id}",
                            {"day": str(day_key), "slot": str(slot_id), "recipeId": recipe_id},
                            now,
                        )
                        continue
                    created_at = planner_created.get((str(day_key), str(slot_id), recipe_id), now)
                    db.execute(
                        """
                        INSERT INTO planner_entries
                            (day_key, slot_id, position, recipe_id, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (str(day_key), str(slot_id), position, recipe_id, created_at, now),
                    )
                    position += 1

    if "bought" in state:
        checked_at = {
            row["item_name"]: row["checked_at"]
            for row in db.execute("SELECT item_name, checked_at FROM shopping_checks").fetchall()
        }
        db.execute("DELETE FROM shopping_checks")
        bought = state.get("bought") if isinstance(state.get("bought"), list) else []
        seen_items = set()
        for position, value in enumerate(bought):
            item_name = str(value or "").strip()
            if not item_name or item_name in seen_items:
                continue
            seen_items.add(item_name)
            db.execute(
                """
                INSERT INTO shopping_checks (item_name, position, checked_at, updated_at)
                VALUES (?, ?, ?, ?)
                """,
                (item_name, position, checked_at.get(item_name, now), now),
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

    sync_planner_and_shopping(db, state, recipe_ids, now)


def init_db():
    with STATE_LOCK, connect_db() as db:
        create_document_tables(db)
        apply_schema_migrations(db)
        row = db.execute(
            "SELECT state_json FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
        if row:
            revisions = db.execute("SELECT id, state_json FROM state_revisions").fetchall()
            for revision in revisions:
                revision_state = json.loads(revision["state_json"])
                store_state_image_assets(db, revision_state, prune=False)
                db.execute(
                    "UPDATE state_revisions SET state_json = ? WHERE id = ?",
                    (compact_json(revision_state), revision["id"]),
                )
            state = json.loads(row["state_json"])
            store_state_image_assets(db, state)
            sync_state_projection(db, state)
            document = state_document_without_relational_data(state)
            db.execute(
                "UPDATE app_state SET state_json = ? WHERE id = ?",
                (compact_json(document), "default"),
            )


def read_state():
    with connect_db() as db:
        db.execute("BEGIN")
        row = db.execute(
            "SELECT state_json, created_at, updated_at, revision FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
        if not row:
            return None
        state = hydrate_relational_state(db, json.loads(row["state_json"]))
        return {
            "state": state,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "revision": row["revision"],
        }


def write_state(state, expected_revision=None):
    now = utc_now()
    with STATE_LOCK, connect_db() as db:
        state = json.loads(compact_json(state))
        state.setdefault("planner", {})
        state.setdefault("bought", [])
        store_state_image_assets(db, state, now)
        serialized = compact_json(state_document_without_relational_data(state))
        current = db.execute(
            "SELECT state_json, created_at, updated_at, revision FROM app_state WHERE id = ?",
            ("default",),
        ).fetchone()
        if expected_revision is not None:
            current_revision = current["revision"] if current else 0
            if expected_revision != current_revision:
                raise StateConflictError(
                    current_revision,
                    current["updated_at"] if current else None,
                )
        if current:
            revision = current["revision"] + 1
            previous_state = hydrate_relational_state(db, json.loads(current["state_json"]))
            db.execute(
                "INSERT INTO state_revisions (state_id, state_json, created_at) VALUES (?, ?, ?)",
                ("default", compact_json(previous_state), now),
            )
            db.execute(
                "UPDATE app_state SET state_json = ?, updated_at = ?, revision = ? WHERE id = ?",
                (serialized, now, revision, "default"),
            )
            created_at = current["created_at"]
        else:
            revision = 1
            db.execute(
                "INSERT INTO app_state (id, state_json, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?)",
                ("default", serialized, now, now, revision),
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
    return {"createdAt": created_at, "updatedAt": now, "revision": revision}


def schema_status():
    with connect_db() as db:
        version_row = db.execute("SELECT MAX(version) AS version FROM schema_migrations").fetchone()
        counts = {
            "recipes": db.execute("SELECT COUNT(*) AS count FROM recipes").fetchone()["count"],
            "ingredients": db.execute("SELECT COUNT(*) AS count FROM ingredients").fetchone()["count"],
            "recipeIngredients": db.execute("SELECT COUNT(*) AS count FROM recipe_ingredients").fetchone()["count"],
            "tags": db.execute("SELECT COUNT(*) AS count FROM tags").fetchone()["count"],
            "images": db.execute("SELECT COUNT(*) AS count FROM image_assets").fetchone()["count"],
            "plannerEntries": db.execute("SELECT COUNT(*) AS count FROM planner_entries").fetchone()["count"],
            "shoppingChecks": db.execute("SELECT COUNT(*) AS count FROM shopping_checks").fetchone()["count"],
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


def read_image_asset(asset_id):
    with connect_db() as db:
        return db.execute(
            "SELECT content_type, data, size_bytes FROM image_assets WHERE id = ?",
            (asset_id,),
        ).fetchone()


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
                        for slot, planned in day.items():
                            if isinstance(planned, list):
                                day[slot] = [planned_id for planned_id in planned if planned_id != resource_id]
                            elif planned == resource_id:
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
        merged["planner"] = metadata.get("planner", current.get("planner") or {})
        merged["bought"] = metadata.get("bought", current.get("bought") or [])
        return write_state(merged)


def parse_resource_path(path):
    parts = [unquote(part) for part in path.strip("/").split("/")]
    if len(parts) not in (2, 3) or parts[0] != "api" or parts[1] not in ("recipes", "ingredients"):
        return None
    return parts[1], parts[2] if len(parts) == 3 else None


class MacroVaultHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' https://cdn.jsdelivr.net; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; "
            "connect-src 'self' https://world.openfoodfacts.org https://cdn.jsdelivr.net; "
            "worker-src 'self' blob: https://cdn.jsdelivr.net; "
            "media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
        )
        super().end_headers()

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
        if parsed.path.startswith("/api/images/"):
            asset_id = unquote(parsed.path[len("/api/images/"):]).strip()
            asset = read_image_asset(asset_id) if asset_id else None
            if not asset:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Image not found"})
                return
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", asset["content_type"])
            self.send_header("Content-Length", str(asset["size_bytes"]))
            self.send_header("Cache-Control", "private, max-age=86400")
            self.end_headers()
            self.wfile.write(asset["data"])
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
        parsed_path = urlparse(self.path).path
        if parsed_path == "/api/import/recipe":
            self.handle_recipe_import()
            return
        resource_path = parse_resource_path(parsed_path)
        if not resource_path or resource_path[1] is not None:
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        self.handle_resource_write("create", resource_path[0], None)

    def handle_recipe_import(self):
        try:
            payload = self.read_json_body()
            url = payload.get("url") if isinstance(payload, dict) else None
            if not str(url or "").strip():
                raise ValueError("Recipe URL is required.")
            recipe = import_recipe_from_url(url)
        except OverflowError as error:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
            return
        except UnsafeImportUrlError as error:
            self.send_json(HTTPStatus.FORBIDDEN, {"ok": False, "message": str(error)})
            return
        except ValueError as error:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": str(error)})
            return
        except RecipeImportError as error:
            self.send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"ok": False, "message": str(error)})
            return
        self.send_json(HTTPStatus.OK, {
            "ok": True,
            "recipe": recipe,
            "message": "Imported structured recipe data through Home Assistant.",
        })

    def do_PUT(self):
        parsed_path = urlparse(self.path).path
        if parsed_path == "/api/state":
            try:
                payload = self.read_json_body()
                state = payload.get("state") if isinstance(payload, dict) else None
                if not isinstance(state, dict):
                    raise ValueError("State must be an object")
                expected_revision = payload.get("expectedRevision")
                if expected_revision is not None and (
                    isinstance(expected_revision, bool) or not isinstance(expected_revision, int) or expected_revision < 0
                ):
                    raise ValueError("Expected revision must be a non-negative integer")
                metadata = write_state(state, expected_revision)
            except OverflowError as error:
                self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": str(error)})
                return
            except StateConflictError as error:
                self.send_json(HTTPStatus.CONFLICT, {
                    "ok": False,
                    "message": str(error),
                    "revision": error.revision,
                    "updatedAt": error.updated_at,
                })
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
