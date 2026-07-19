#!/usr/bin/env python3
import json
import mimetypes
import os
import sqlite3
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


def utc_now():
    return datetime.now(timezone.utc).isoformat()


def connect_db():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db():
    with connect_db() as db:
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
    serialized = json.dumps(state, separators=(",", ":"), ensure_ascii=False)
    now = utc_now()
    with connect_db() as db:
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


class MacroVaultHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json(HTTPStatus.OK, {"ok": True})
            return
        if parsed.path == "/api/state":
            stored = read_state()
            if not stored:
                self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "No MacroVault state stored yet."})
                return
            self.send_json(HTTPStatus.OK, {"ok": True, **stored})
            return
        self.serve_static(parsed.path)

    def do_PUT(self):
        if urlparse(self.path).path != "/api/state":
            self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "message": "Not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Invalid content length"})
            return
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"ok": False, "message": "State payload is too large"})
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "Invalid JSON"})
            return
        state = payload.get("state")
        if not isinstance(state, dict):
            self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "message": "State must be an object"})
            return
        metadata = write_state(state)
        self.send_json(HTTPStatus.OK, {"ok": True, **metadata})

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
    print(f"MacroVault listening on port {PORT}; database at {DB_PATH}", flush=True)
    server.serve_forever()
