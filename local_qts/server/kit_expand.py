from __future__ import annotations

import csv
import math
from pathlib import Path
from typing import Any

from .config import KIT_BOM_CSV

DEFAULT_ON = {"main", "required", "required_removable", "optional"}


def _load_bom(path: Path | None = None) -> dict[str, list[dict[str, str]]]:
    csv_path = path or KIT_BOM_CSV
    kits: dict[str, list[dict[str, str]]] = {}
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            kits.setdefault(row["Kit_Key"], []).append(row)
    return kits


def expand_kit(kit_key: str, series_cell_count: int | None = None) -> dict[str, Any]:
    """Local port of fn_get_kit_components using kit_bom/kit_components.csv."""
    kits = _load_bom()
    key = (kit_key or "").strip()
    if not key:
        return {"error": "No kit selected."}
    rows = kits.get(key)
    if not rows:
        return {"error": f"Unknown kit key: {key}"}

    mcu_qty = 0
    cmu_qty = 0
    qty_by_idx: dict[int, int] = {}

    for i, comp in enumerate(rows):
        rule = (comp.get("Qty_Rule") or "").strip()
        req = (comp.get("Requirement") or "").strip()
        if rule == "fixed":
            try:
                qv = int(float(comp.get("Qty_Value") or 0))
            except ValueError:
                qv = 0
            qty_by_idx[i] = qv
            if req == "main":
                mcu_qty = qv
        elif rule == "cmu_from_series_cells":
            if series_cell_count is None or series_cell_count <= 0:
                return {
                    "error": "Series Cell Count is required for this kit. "
                    "Enter the series cell count and try again."
                }
            if series_cell_count < 4:
                return {"error": f"Series Cell Count {series_cell_count} is below the 4-cell minimum."}
            if series_cell_count > 384:
                return {"error": f"Series Cell Count {series_cell_count} is above the 384-cell maximum."}
            try:
                channels = int(float(comp.get("Channels_Per_CMU") or 0))
            except ValueError:
                channels = 0
            if channels <= 0:
                return {
                    "error": f"Kit data error: Channels Per CMU missing for SKU {comp.get('Component_SKU')}."
                }
            cmu_qty = int(math.ceil(series_cell_count / channels))
            if cmu_qty > 30:
                return {
                    "error": (
                        f"Series Cell Count {series_cell_count} needs {cmu_qty} CMUs, "
                        "above the 30-CMU vendor cap."
                    )
                }
            qty_by_idx[i] = cmu_qty

    lines: list[dict[str, Any]] = []
    notices: list[str] = []
    for i, comp in enumerate(rows):
        rule = (comp.get("Qty_Rule") or "").strip()
        req = (comp.get("Requirement") or "").strip().lower()
        sku = (comp.get("Component_SKU") or "").strip()
        conf = (comp.get("Confidence") or "").strip()

        if req == "manual":
            notices.append(f"Skipped manual component {sku}")
            continue
        if conf == "pending_business":
            notices.append(f"Held pending business: {sku}")
            continue

        qty = 0
        if rule == "fixed":
            qty = qty_by_idx.get(i, 0)
        elif rule == "cmu_from_series_cells":
            qty = cmu_qty
        elif rule == "match_mcu_qty":
            if mcu_qty <= 0:
                return {"error": f"Kit data error: no main row to match for SKU {sku}."}
            qty = mcu_qty
        elif rule == "match_cmu_qty":
            if cmu_qty <= 0:
                return {"error": f"Kit data error: no CMU qty to match for SKU {sku}."}
            qty = cmu_qty
        else:
            notices.append(f"Unknown qty rule '{rule}' for {sku}")
            continue

        if req not in DEFAULT_ON and req != "":
            continue

        warn = ""
        if conf == "pending_datasheet":
            warn = "Quantity unconfirmed (pending datasheet)"
        lines.append({"part_number": sku, "qty": qty, "kit_warning": warn})

    return {"kit_key": key, "lines": lines, "notices": notices}
