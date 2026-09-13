"""
The local web server.

MedV runs as a small HTTP server on this computer and shows its interface in
your browser. It listens on 127.0.0.1 only — nothing outside this machine can
reach it, and it never calls out.
"""

from __future__ import annotations
import json
import mimetypes
import os
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import __version__, api, db, paths
from .util.errors import AppError

WEB_ROOT = Path(__file__).parent / "web"
MAX_BODY = 24 * 1024 * 1024
_api_lock = threading.Lock()

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


class Handler(BaseHTTPRequestHandler):
    server_version = f"MedV/{__version__}"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------- plumbing
    def log_message(self, fmt, *args):  # noqa: A003 - quieten the default logging
        if os.environ.get("MEDV_VERBOSE"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, body: bytes, content_type="application/json; charset=utf-8",
              extra_headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for key, value in (extra_headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_json(self, payload, status=200):
        self._send(status, json.dumps(payload, default=str).encode("utf-8"))

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        if length > MAX_BODY:
            raise AppError("That request is too large.", "PAYLOAD_TOO_LARGE")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw or b"{}")
        except json.JSONDecodeError:
            raise AppError("The request could not be read.", "BAD_REQUEST")

    def _is_local(self) -> bool:
        """Only this computer may talk to MedV."""
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            return False
        origin = self.headers.get("Origin")
        if origin and not (origin.startswith("http://127.0.0.1") or origin.startswith("http://localhost")):
            return False
        return True

    # ----------------------------------------------------------------- GET
    def do_GET(self):
        parsed = urlparse(self.path)
        route = unquote(parsed.path)
        if route == "/api/download":
            return self._download(parse_qs(parsed.query).get("path", [""])[0])
        if route in ("/", ""):
            route = "/index.html"
        target = (WEB_ROOT / route.lstrip("/")).resolve()
        if not str(target).startswith(str(WEB_ROOT.resolve())) or not target.is_file():
            target = WEB_ROOT / "index.html"
        content_type = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith(("javascript", "json")):
            content_type += "; charset=utf-8"
        self._send(200, target.read_bytes(), content_type)

    do_HEAD = do_GET

    def _download(self, file_path: str):
        source = Path(file_path)
        if not source.is_file():
            return self._send(404, b"Not found", "text/plain; charset=utf-8")
        self._send(200, source.read_bytes(), "application/octet-stream",
                   {"Content-Disposition": f'attachment; filename="{source.name}"'})

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        if not self._is_local():
            return self._send(403, b'{"ok":false,"error":{"message":"Forbidden"}}')
        route = unquote(urlparse(self.path).path)
        try:
            payload = self._read_json()
        except AppError as error:
            return self._send_json({"ok": False, "error": {"message": error.message,
                                                           "code": error.code, "expected": True}})
        try:
            if route == "/api":
                with _api_lock:
                    data = api.handle(payload.get("channel", ""), payload.get("payload") or {})
                return self._send_json({"ok": True, "data": data})
            if route == "/api/state":
                return self._send_json({
                    "version": __version__,
                    "isPackaged": True,
                    "platform": sys.platform,
                    "edition": "python",
                    "paths": paths.paths(),
                    "documents": str(paths.documents_dir()),
                    "bootError": None,
                })
            if route == "/api/backup-target":
                return self._send_json(self._backup_target(payload))
            if route == "/api/upload":
                return self._send_json(self._upload(payload))
            if route == "/api/open-folder":
                return self._send_json(self._open_folder(payload.get("path", "")))
            if route == "/api/shutdown":
                threading.Timer(0.4, self.server.shutdown).start()
                return self._send_json({"ok": True})
        except AppError as error:
            return self._send_json({"ok": False, "error": {"message": error.message,
                                                           "code": error.code, "expected": True}})
        except Exception as error:  # unexpected — log it for the operator
            sys.stderr.write(f"[medv] {route} failed: {error!r}\n")
            return self._send_json({"ok": False, "error": {
                "message": str(error) or "Something went wrong.", "code": "ERROR", "expected": False}})
        return self._send(404, b'{"ok":false,"error":{"message":"Unknown endpoint"}}')

    # ------------------------------------------------------------- helpers
    def _backup_target(self, payload) -> dict:
        """A real folder the operator can find, created on first use."""
        name = payload.get("name") or "MedBillPro_Backup.db"
        folder = paths.documents_dir() / "MedV Backups"
        folder.mkdir(parents=True, exist_ok=True)
        return {"ok": True, "path": str(folder / Path(name).name), "folder": str(folder)}

    def _upload(self, payload) -> dict:
        """Saves an uploaded backup to a temporary file so it can be inspected."""
        import base64
        data = base64.b64decode(payload.get("base64") or "")
        if not data:
            raise AppError("That file is empty.")
        if len(data) > MAX_BODY:
            raise AppError("That file is too large.")
        suffix = Path(payload.get("name") or "upload.db").suffix or ".db"
        handle, temp_path = tempfile.mkstemp(prefix="medv-upload-", suffix=suffix)
        with os.fdopen(handle, "wb") as out:
            out.write(data)
        return {"ok": True, "path": temp_path, "size": len(data)}

    def _open_folder(self, target: str) -> dict:
        """Opens the OS file manager at a file or folder."""
        path = Path(target)
        if not path.exists():
            return {"ok": False}
        try:
            if sys.platform == "win32":
                if path.is_file():
                    subprocess.Popen(["explorer", "/select,", str(path)])
                else:
                    os.startfile(str(path))  # noqa: S606 - opening a local folder
            elif sys.platform == "darwin":
                subprocess.Popen(["open", "-R" if path.is_file() else "", str(path)])
            else:
                subprocess.Popen(["xdg-open", str(path if path.is_dir() else path.parent)])
            return {"ok": True}
        except OSError:
            return {"ok": False}


def find_port(preferred: int = 8765, attempts: int = 40) -> int:
    """First free port from the preferred one upwards."""
    import socket
    for offset in range(attempts):
        candidate = preferred + offset
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(("127.0.0.1", candidate))
                return candidate
            except OSError:
                continue
    raise AppError("No free port could be found for MedV to listen on.")


def serve(port: int) -> ThreadingHTTPServer:
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    httpd.daemon_threads = True
    return httpd
