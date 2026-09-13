#!/bin/sh
# MedV — start the application (macOS and Linux).
set -e
cd "$(dirname "$0")"

if [ ! -f "medv/__main__.py" ]; then
  echo "The program files are not in this folder. Extract the whole zip and run it from there."
  exit 1
fi

for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
      PY="$candidate"
      break
    fi
  fi
done

if [ -z "${PY:-}" ]; then
  echo "Python 3.9 or newer was not found."
  echo "macOS:  brew install python   (or download from https://www.python.org/downloads/)"
  echo "Linux:  sudo apt install python3   (or your distribution's package)"
  exit 1
fi

echo "MedV is starting with $PY. Keep this window open while you work."
exec "$PY" -m medv "$@"
