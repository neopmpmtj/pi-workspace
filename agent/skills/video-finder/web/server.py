#!/usr/bin/env python3
"""
Video Finder — Local Dashboard Server

Serves the config dashboard and provides API endpoints for:
- Reading/writing config.json
- Queuing search requests (picked up by Pi agent)
- Serving search results back to the UI

Usage:
    python3 web/server.py              # Default port 8765
    python3 web/server.py --port 9000  # Custom port
"""

import http.server
import json
import os
import sys
import argparse
from pathlib import Path
from urllib.parse import urlparse, parse_qs

SKILL_DIR = Path(__file__).resolve().parent.parent
WEB_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SKILL_DIR / "config.json"
REQUESTS_PATH = WEB_DIR / "requests" / "current.json"
RESULTS_PATH = WEB_DIR / "results" / "latest.json"

MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class VideoFinderHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, format, *args):
        # Quieter logging
        if "/api/" in str(args[0]):
            print(f"  [{self.command}] {args[0]}")
        else:
            pass  # suppress static file logs

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/config":
            self._serve_json(read_json(CONFIG_PATH, {}))
            return

        if parsed.path == "/api/results":
            self._serve_json(read_json(RESULTS_PATH, {"status": "empty", "results": []}))
            return

        if parsed.path == "/api/status":
            req = read_json(REQUESTS_PATH, {"status": "idle"})
            res = read_json(RESULTS_PATH, {"status": "empty"})
            self._serve_json({"request": req.get("status", "idle"), "results": res.get("status", "empty")})
            return

        # Static file serving
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b"{}"

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self._error(400, "Invalid JSON")
            return

        if parsed.path == "/api/config":
            write_json(CONFIG_PATH, data)
            self._serve_json({"status": "ok", "saved": data})
            return

        if parsed.path == "/api/search":
            request = {
                "status": "pending",
                "reference": data.get("reference", ""),
                "isUrl": data.get("isUrl", False),
                "timestamp": data.get("timestamp", ""),
            }
            write_json(REQUESTS_PATH, request)
            # Reset results so the UI knows it's a fresh search
            write_json(RESULTS_PATH, {"status": "processing", "results": []})
            self._serve_json({"status": "queued", "message": "Run /skill:video-finder in Pi to process."})
            return

        if parsed.path == "/api/results":
            write_json(RESULTS_PATH, data)
            self._serve_json({"status": "ok"})
            return

        self._error(404, "Unknown endpoint")

    def _serve_json(self, data):
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _error(self, code, message):
        body = json.dumps({"error": message}).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Video Finder Dashboard Server")
    parser.add_argument("--port", type=int, default=8765, help="Port to listen on (default: 8765)")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="Host to bind to (default: 127.0.0.1)")
    args = parser.parse_args()

    # Ensure directories exist
    REQUESTS_PATH.parent.mkdir(parents=True, exist_ok=True)
    RESULTS_PATH.parent.mkdir(parents=True, exist_ok=True)

    if not REQUESTS_PATH.exists():
        write_json(REQUESTS_PATH, {"status": "idle"})
    if not RESULTS_PATH.exists():
        write_json(RESULTS_PATH, {"status": "empty", "results": []})

    server = http.server.HTTPServer((args.host, args.port), VideoFinderHandler)
    url = f"http://{args.host}:{args.port}"
    print(f"\n  🎬 Video Finder Dashboard")
    print(f"  📡 Server running at {url}")
    print(f"  📁 Config: {CONFIG_PATH}")
    print(f"  📥 Requests: {REQUESTS_PATH}")
    print(f"  📤 Results: {RESULTS_PATH}")
    print(f"\n  Open {url} in your browser to configure and trigger searches.")
    print(f"  Press Ctrl+C to stop.\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  👋 Server stopped.")
        server.server_close()


if __name__ == "__main__":
    main()