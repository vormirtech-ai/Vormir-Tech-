"""Starting and stopping MedV."""

from __future__ import annotations
import argparse
import os
import signal
import sys
import threading
import webbrowser

from . import __version__, api, db, paths, server
from .services import backup, settings

BANNER = r"""
  __  __          ___     __
 |  \/  | ___  __| \ \   / /   MedV {version}
 | |\/| |/ _ \/ _` |\ \ / /    Pharmacy management, on this computer
 | |  | |  __/ (_| | \ V /
 |_|  |_|\___|\__,_|  \_/      {db}
"""


def parse_args(argv=None):
    parser = argparse.ArgumentParser(prog="medv", description="MedV — pharmacy management.")
    parser.add_argument("--port", type=int, default=int(os.environ.get("MEDV_PORT", 8765)),
                        help="Port to listen on (default 8765; the next free one is used if busy).")
    parser.add_argument("--data-dir", default=os.environ.get("MEDV_DATA_DIR"),
                        help="Where to keep the database (default: your application data folder).")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser window.")
    parser.add_argument("--version", action="version", version=f"MedV {__version__}")
    return parser.parse_args(argv)


def start(argv=None):
    options = parse_args(argv)
    paths.configure(options.data_dir)
    opened = db.open_db(paths.db_file())

    port = server.find_port(options.port)
    url = f"http://127.0.0.1:{port}/"
    httpd = server.serve(port)

    print(BANNER.format(version=__version__, db=paths.db_file()))
    if opened.get("applied"):
        print(f"  Database prepared (schema v{opened['to']}).")
    print(f"  MedV is running at   {url}")
    print("  Everything is stored on this computer. No internet needed.")
    print("  Keep this window open while you work; close it to stop MedV.\n")

    if not options.no_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()

    # Closing the window, Ctrl+C, or a `kill` all reach the same clean stop, so
    # the rolling backup is taken and the database is checkpointed either way.
    def stop(_signum=None, _frame=None):
        threading.Thread(target=httpd.shutdown, daemon=True).start()

    for name in ("SIGTERM", "SIGBREAK", "SIGHUP"):
        received = getattr(signal, name, None)
        if received is not None:
            try:
                signal.signal(received, stop)
            except (ValueError, OSError):
                pass  # not the main thread, or unsupported on this platform

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopping MedV…")
    finally:
        shutdown(httpd)
    return 0


def shutdown(httpd=None):
    """A rolling local copy on every clean exit, then a checkpointed close."""
    try:
        if db.is_open() and settings.flag("setup_complete"):
            backup.auto("exit")
    except Exception:
        pass
    try:
        db.close()
    except Exception:
        pass
    if httpd is not None:
        try:
            httpd.server_close()
        except Exception:
            pass
    print("  MedV stopped. Your data is saved.")


def main(argv=None):
    try:
        return start(argv)
    except Exception as error:
        print(f"\n  MedV could not start: {error}\n", file=sys.stderr)
        print("  If another copy of MedV is already running, close it and try again.", file=sys.stderr)
        input("  Press Enter to close this window… ")
        return 1
