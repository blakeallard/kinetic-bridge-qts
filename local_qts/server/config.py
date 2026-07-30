from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
load_dotenv(ROOT / ".env")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
)
PORT = int(os.getenv("PORT", "8789"))
KIT_BOM_CSV = Path(
    os.getenv(
        "KIT_BOM_CSV",
        str(REPO_ROOT / "kit_bom" / "kit_components.csv"),
    )
)
FRONTEND_DIR = ROOT / "frontend"
STATIC_DIR = ROOT / "static"
LOCAL_ID_PREFIX = "LOCAL"