import http.client
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
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
        self.assertEqual(stored["state"], state)
        status = server.schema_status()
        self.assertEqual(status["version"], 3)
        self.assertEqual(
            status["counts"],
            {"recipes": 1, "ingredients": 1, "recipeIngredients": 1, "tags": 2, "images": 0},
        )
        self.assertEqual(status["warnings"][0]["code"], "duplicate_ingredient_id")
        self.assertEqual(server.read_resources("ingredients")[0]["name"], "Bread")

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
        self.assertEqual(payload["state"]["planner"]["2026-07-20"]["breakfast"], "recipe-toast")

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
        self.assertTrue(data.startswith(b"\x89PNG"))

        status, _, _ = self.raw_request("GET", "/api/images/missing")
        self.assertEqual(status, 404)


if __name__ == "__main__":
    unittest.main()
