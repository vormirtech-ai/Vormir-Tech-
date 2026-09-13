"""
Double-click launcher for Windows that starts MedV without a console window.

Stopping it then means closing MedV from the browser tab (Settings -> About ->
Stop MedV) or ending the Python task, so start-medv.bat is the friendlier
choice for most shops. This file is here for anyone who prefers no console.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from medv.app import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(["--port", "8765"]))
