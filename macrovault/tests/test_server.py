import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from unittest import mock
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SERVER_DIR))

import server  # noqa: E402


TINY_PNG_DATA_URL = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)


def sample_state():
    return {
        "recipes": [
            {
                "id": "recipe-toast",
                "name": "Toast",
                "category": "breakfast",
                "categories": ["breakfast"],
                "tags": ["quick", "Quick", "family"],
                "ingredients": ["2 slices bread"],
                "ingredientRefs": [
                    {
                        "line": "2 slices bread",
                        "ingredientId": "ingredient-bread",
                        "usedAmount": 2,
                        "usedUnit": "each",
                    }
                ],
                "method": "Toast the bread.",
                "servings": 1,
                "calories": 180,
                "macros": {"protein": 6, "carbs": 32, "fat": 2},
                "nutrition": {"sugar": 3, "fibre": 4},
                "imageUrl": "",
                "sourceUrl": "",
                "favourite": True,
                "prepared": False,
                "art": "breakfast",
            }
        ],
        "ingredients": [
            {
                "id": "ingredient-bread",
                "name": "Bread",
                "plural": "slices of bread",
                "aliases": ["toast"],
                "description": "",
                "barcode": "",
                "imageUrl": "",
                "label": "Bakery",
                "onHand": True,
                "serving": {"amount": 1, "unit": "each"},
                "nutrition": {
                    "calories": 90,
                    "protein": 3,
                    "carbs": 16,
                    "fat": 1,
                    "sugar": 1.5,
                    "fibre": 2,
                },
            },
            {
                "id": "ingredient-bread",
                "name": "Duplicate Bread",
                "serving": {"amount": 1, "unit": "each"},
                "nutrition": {},
            },
        ],
        "planner": {"2026-07-19": {"breakfast": "recipe-toast"}},
        "bought": ["Bread"],
    }


class DatabaseSandbox:
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_data_dir = server.DATA_DIR
        self.original_db_path = server.DB_PATH
        server.DATA_DIR = Path(self.temp_dir.name)
        server.DB_PATH = server.DATA_DIR / "macrovault.db"
        server.init_db()

    def tearDown(self):
        server.DATA_DIR = self.original_data_dir
        server.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_state_projection_preserves_document_and_normalizes_resources(self):
        state = sample_state()
        server.write_state(state)

        stored = server.read_state()
        expected_state = {**state, "planner": {"2026-07-19": {"breakfast": ["recipe-toast"]}}}
        self.assertEqual(stored["state"], expected_state)
        status = server.schema_status()
        self.assertEqual(status["version"], 4)
        self.assertEqual(
            status["counts"],
            {
                "recipes": 1,
                "ingredients": 1,
                "recipeIngredients": 1,
                "tags": 2,
                "images": 0,
                "plannerEntries": 1,
                "shoppingChecks": 1,
            },
        )
        self.assertEqual(status["warnings"][0]["code"], "duplicate_ingredient_id")
        self.assertEqual(server.read_resources("ingredients")[0]["name"], "Bread")

    def test_planner_and_shopping_are_authoritative_relational_data(self):
        state = sample_state()
        state["recipes"].append({
            "id": "recipe-soup",
            "name": "Soup",
            "ingredients": [],
            "ingredientRefs": [],
        })
        state["planner"] = {
            "Monday": {"dinner": ["recipe-toast", "recipe-soup"]},
            "Tuesday": {"breakfast": "recipe-toast"},
        }
        state["bought"] = ["Bread", "Milk"]
        server.write_state(state)

        with server.connect_db() as db:
            document = json.loads(db.execute(
                "SELECT state_json FROM app_state WHERE id = ?", ("default",)
            ).fetchone()["state_json"])
            planner_rows = db.execute(
                "SELECT day_key, slot_id, position, recipe_id FROM planner_entries ORDER BY day_key, slot_id, position"
            ).fetchall()
            shopping_rows = db.execute(
                "SELECT item_name, position FROM shopping_checks ORDER BY position"
            ).fetchall()
            self.assertNotIn("planner", document)
            self.assertNotIn("bought", document)
            self.assertEqual(
                [tuple(row) for row in planner_rows],
                [
                    ("Monday", "dinner", 0, "recipe-toast"),
                    ("Monday", "dinner", 1, "recipe-soup"),
                    ("Tuesday", "breakfast", 0, "recipe-toast"),
                ],
            )
            self.assertEqual([tuple(row) for row in shopping_rows], [("Bread", 0), ("Milk", 1)])

            db.execute("DELETE FROM planner_entries WHERE day_key = 'Tuesday'")
            db.execute("DELETE FROM shopping_checks WHERE item_name = 'Milk'")

        stored = server.read_state()["state"]
        self.assertEqual(stored["planner"], {"Monday": {"dinner": ["recipe-toast", "recipe-soup"]}})
        self.assertEqual(stored["bought"], ["Bread"])

        server.init_db()
        self.assertEqual(server.read_state()["state"]["planner"], stored["planner"])
        self.assertEqual(server.read_state()["state"]["bought"], stored["bought"])

        server.mutate_resource("recipes", "delete", "recipe-soup")
        self.assertEqual(server.read_state()["state"]["planner"], {"Monday": {"dinner": ["recipe-toast"]}})
        with server.connect_db() as db:
            revision = json.loads(db.execute(
                "SELECT state_json FROM state_revisions ORDER BY id DESC LIMIT 1"
            ).fetchone()["state_json"])
            self.assertEqual(revision["planner"], {"Monday": {"dinner": ["recipe-toast", "recipe-soup"]}})
            self.assertEqual(revision["bought"], ["Bread"])

    def test_legacy_document_planner_and_shopping_migrate_once(self):
        state = sample_state()
        server.write_state(state)
        with server.connect_db() as db:
            db.execute("DROP TABLE planner_entries")
            db.execute("DROP TABLE shopping_checks")
            db.execute("DELETE FROM schema_migrations WHERE version = 4")
            db.execute(
                "UPDATE app_state SET state_json = ? WHERE id = ?",
                (json.dumps(state), "default"),
            )

        server.init_db()
        server.init_db()
        migrated = server.read_state()["state"]
        self.assertEqual(migrated["planner"], {"2026-07-19": {"breakfast": ["recipe-toast"]}})
        self.assertEqual(migrated["bought"], ["Bread"])
        with server.connect_db() as db:
            document = json.loads(db.execute(
                "SELECT state_json FROM app_state WHERE id = ?", ("default",)
            ).fetchone()["state_json"])
            self.assertNotIn("planner", document)
            self.assertNotIn("bought", document)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM planner_entries").fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM shopping_checks").fetchone()[0], 1)

    def test_recipe_json_ld_parser_and_private_url_protection(self):
        html = """
        <html><head><title>Fallback title</title><link rel="canonical" href="/recipes/lemon-pasta">
        <script type="application/ld+json">
        {"@context":"https://schema.org","@type":"Recipe","name":"Lemon Pasta",
         "recipeIngredient":["200 g pasta","1 lemon"],"recipeYield":"Serves 4",
         "recipeInstructions":[{"@type":"HowToStep","text":"Boil pasta."},{"@type":"HowToStep","text":"Add lemon."}],
         "nutrition":{"calories":"420 kcal","proteinContent":"12 g","carbohydrateContent":"70 g","fatContent":"8 g"},
         "image":{"url":"/images/pasta.jpg"}}
        </script></head></html>
        """
        recipe = server.parse_recipe_page(html, "https://recipes.example.test/original")
        self.assertEqual(recipe["name"], "Lemon Pasta")
        self.assertEqual(recipe["ingredients"], ["200 g pasta", "1 lemon"])
        self.assertEqual(recipe["method"], "Boil pasta.\nAdd lemon.")
        self.assertEqual(recipe["servings"], 4)
        self.assertEqual(recipe["calories"], 420)
        self.assertEqual(recipe["sourceUrl"], "https://recipes.example.test/recipes/lemon-pasta")
        self.assertEqual(recipe["imageUrl"], "https://recipes.example.test/images/pasta.jpg")

        for unsafe_url in ("http://127.0.0.1/recipe", "http://localhost/recipe", "http://[::1]/recipe"):
            with self.assertRaises(server.UnsafeImportUrlError):
                server.validate_external_url(unsafe_url)

    def test_resource_mutations_keep_state_and_projection_in_sync(self):
        server.write_state(sample_state())
        recipe = {
            "id": "recipe-soup",
            "name": "Soup",
            "tags": ["dinner"],
            "ingredients": [],
            "ingredientRefs": [],
        }

        server.mutate_resource("recipes", "create", recipe["id"], recipe)
        self.assertEqual(server.read_resources("recipes")[0]["id"], "recipe-soup")

        updated = {**recipe, "name": "Tomato Soup"}
        server.mutate_resource("recipes", "upsert", recipe["id"], updated)
        self.assertEqual(server.read_resources("recipes", recipe["id"])["name"], "Tomato Soup")

        server.mutate_resource("recipes", "delete", recipe["id"])
        self.assertIsNone(server.read_resources("recipes", recipe["id"]))

    def test_embedded_images_move_to_server_table(self):
        state = sample_state()
        state["recipes"][0]["imageUrl"] = "image-asset:img-toast"
        state["imageLibrary"] = {
            "img-toast": {
                "id": "img-toast",
                "data": TINY_PNG_DATA_URL,
                "createdAt": "2026-07-19",
            }
        }

        server.write_state(state)
        stored = server.read_state()["state"]
        asset = stored["imageLibrary"]["img-toast"]
        self.assertNotIn("data", asset)
        self.assertEqual(asset["contentType"], "image/png")
        self.assertGreater(asset["sizeBytes"], 0)
        self.assertEqual(server.schema_status()["counts"]["images"], 1)
        self.assertEqual(server.read_image_asset("img-toast")["content_type"], "image/png")

        server.init_db()
        self.assertEqual(server.schema_status()["counts"]["images"], 1)

    def test_external_export_migrates_when_provided(self):
        export_path = os.environ.get("MACROVAULT_TEST_EXPORT")
        if not export_path:
            self.skipTest("MACROVAULT_TEST_EXPORT is not set")
        with open(export_path, "r", encoding="utf-8-sig") as export_file:
            state = json.load(export_file)

        server.DB_PATH.unlink()
        legacy_db = sqlite3.connect(server.DB_PATH)
        legacy_db.execute(
            """
            CREATE TABLE app_state (
                id TEXT PRIMARY KEY,
                state_json TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        legacy_db.execute(
            "INSERT INTO app_state VALUES (?, ?, ?, ?)",
            ("default", json.dumps(state), "2026-07-19T00:00:00+00:00", "2026-07-19T00:00:00+00:00"),
        )
        legacy_db.commit()
        legacy_db.close()

        server.init_db()
        server.init_db()
        status = server.schema_status()
        self.assertEqual(status["counts"]["recipes"], len({item["id"] for item in state["recipes"]}))
        self.assertEqual(status["counts"]["ingredients"], len({item["id"] for item in state["ingredients"]}))
        self.assertEqual(
            status["counts"]["recipeIngredients"],
            sum(len(item.get("ingredients") or []) for item in state["recipes"]),
        )
        self.assertEqual(status["counts"]["images"], len(state.get("imageLibrary") or {}))
        migrated_state = server.read_state()["state"]
        self.assertTrue(all("data" not in asset for asset in (migrated_state.get("imageLibrary") or {}).values()))


class DatabaseTestCase(DatabaseSandbox, unittest.TestCase):
    pass


class ApiTestCase(DatabaseSandbox, unittest.TestCase):
    test_state_projection_preserves_document_and_normalizes_resources = None
    test_resource_mutations_keep_state_and_projection_in_sync = None
    test_embedded_images_move_to_server_table = None
    test_external_export_migrates_when_provided = None
    test_planner_and_shopping_are_authoritative_relational_data = None
    test_legacy_document_planner_and_shopping_migrate_once = None
    test_recipe_json_ld_parser_and_private_url_protection = None

    def setUp(self):
        DatabaseSandbox.setUp(self)
        server.write_state(sample_state())
        self.httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), server.MacroVaultHandler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        DatabaseSandbox.tearDown(self)

    def request(self, method, path, payload=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        body = json.dumps(payload) if payload is not None else None
        headers = {"Content-Type": "application/json"} if body is not None else {}
        connection.request(method, path, body=body, headers=headers)
        response = connection.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, data

    def raw_request(self, method, path):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        connection.request(method, path)
        response = connection.getresponse()
        data = response.read()
        headers = dict(response.getheaders())
        connection.close()
        return response.status, headers, data

    def test_schema_and_recipe_crud_endpoints(self):
        status, schema = self.request("GET", "/api/schema")
        self.assertEqual(status, 200)
        self.assertEqual(schema["counts"]["recipes"], 1)

        recipe = {
            "id": "recipe-salad",
            "name": "Salad",
            "tags": ["lunch"],
            "ingredients": [],
            "ingredientRefs": [],
        }
        status, created = self.request("POST", "/api/recipes", recipe)
        self.assertEqual(status, 201)
        self.assertEqual(created["recipe"]["name"], "Salad")

        recipe["name"] = "Garden Salad"
        status, updated = self.request("PUT", "/api/recipes/recipe-salad", recipe)
        self.assertEqual(status, 200)
        self.assertEqual(updated["recipe"]["name"], "Garden Salad")

        status, fetched = self.request("GET", "/api/recipes/recipe-salad")
        self.assertEqual(status, 200)
        self.assertEqual(fetched["recipe"]["name"], "Garden Salad")

        status, _ = self.request("DELETE", "/api/recipes/recipe-salad")
        self.assertEqual(status, 200)
        status, _ = self.request("GET", "/api/recipes/recipe-salad")
        self.assertEqual(status, 404)

        recipe["name"] = "Retry-safe Salad"
        status, created_by_put = self.request(
            "PUT",
            "/api/recipes/recipe-salad",
            {"recipe": recipe, "position": 0},
        )
        self.assertEqual(status, 200)
        self.assertEqual(created_by_put["recipe"]["name"], "Retry-safe Salad")
        self.assertEqual(server.read_resources("recipes")[0]["id"], "recipe-salad")

    def test_bulk_resources_and_partial_state_endpoint(self):
        replacement = sample_state()
        replacement["recipes"][0]["name"] = "Resource API Toast"
        status, _ = self.request(
            "PUT",
            "/api/resources",
            {
                "recipes": replacement["recipes"],
                "ingredients": replacement["ingredients"],
            },
        )
        self.assertEqual(status, 200)

        status, _ = self.request(
            "PATCH",
            "/api/state",
            {"state": {"planner": {"2026-07-20": {"breakfast": "recipe-toast"}}, "bought": []}},
        )
        self.assertEqual(status, 200)

        status, payload = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        self.assertEqual(payload["state"]["recipes"][0]["name"], "Resource API Toast")
        self.assertEqual(payload["state"]["planner"]["2026-07-20"]["breakfast"], ["recipe-toast"])

        status, _ = self.request(
            "PATCH",
            "/api/state",
            {"state": {"configuration": {"appName": "MacroVault"}}},
        )
        self.assertEqual(status, 200)
        _, preserved = self.request("GET", "/api/state")
        self.assertEqual(preserved["state"]["planner"], payload["state"]["planner"])
        self.assertEqual(preserved["state"]["bought"], payload["state"]["bought"])

    def test_state_writes_reject_stale_revisions(self):
        status, current = self.request("GET", "/api/state")
        self.assertEqual(status, 200)
        revision = current["revision"]

        first = current["state"]
        first["planner"] = {"Monday": {"dinner": "recipe-toast"}}
        status, saved = self.request(
            "PUT",
            "/api/state",
            {"state": first, "expectedRevision": revision},
        )
        self.assertEqual(status, 200)
        self.assertEqual(saved["revision"], revision + 1)

        stale = current["state"]
        stale["planner"] = {"Tuesday": {"dinner": "recipe-toast"}}
        status, conflict = self.request(
            "PUT",
            "/api/state",
            {"state": stale, "expectedRevision": revision},
        )
        self.assertEqual(status, 409)
        self.assertEqual(conflict["revision"], revision + 1)

        stored = server.read_state()
        self.assertIn("Monday", stored["state"]["planner"])
        self.assertNotIn("Tuesday", stored["state"]["planner"])

    def test_image_asset_endpoint(self):
        state = sample_state()
        state["recipes"][0]["imageUrl"] = "image-asset:img-toast"
        state["imageLibrary"] = {"img-toast": {"id": "img-toast", "data": TINY_PNG_DATA_URL}}
        server.write_state(state)

        status, headers, data = self.raw_request("GET", "/api/images/img-toast")
        self.assertEqual(status, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertNotIn("allorigins", headers["Content-Security-Policy"])
        self.assertNotIn("codetabs", headers["Content-Security-Policy"])
        self.assertTrue(data.startswith(b"\x89PNG"))

        status, _, _ = self.raw_request("GET", "/api/images/missing")
        self.assertEqual(status, 404)

    def test_server_side_recipe_import_endpoint(self):
        recipe = {
            "name": "Server Pasta",
            "category": "dinner",
            "tags": ["imported", "website"],
            "ingredients": ["200 g pasta"],
            "method": "Boil pasta.",
            "servings": 2,
            "calories": 400,
            "macros": {"protein": 10, "carbs": 70, "fat": 8},
            "imageUrl": "https://recipes.example.test/pasta.jpg",
            "sourceUrl": "https://recipes.example.test/pasta",
        }
        with mock.patch.object(server, "import_recipe_from_url", return_value=recipe) as importer:
            status, payload = self.request(
                "POST", "/api/import/recipe", {"url": "https://recipes.example.test/pasta"}
            )
        self.assertEqual(status, 200)
        self.assertEqual(payload["recipe"], recipe)
        importer.assert_called_once_with("https://recipes.example.test/pasta")

        status, blocked = self.request(
            "POST", "/api/import/recipe", {"url": "http://127.0.0.1/private"}
        )
        self.assertEqual(status, 403)
        self.assertIn("Private or local", blocked["message"])


if __name__ == "__main__":
    unittest.main()
