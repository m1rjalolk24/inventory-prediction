"""Gunicorn entry point — run from project root."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src" / "api"))

from app import app  # noqa: E402

if __name__ == "__main__":
    app.run()
