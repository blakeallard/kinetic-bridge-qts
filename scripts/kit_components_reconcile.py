#!/usr/bin/env python3
"""Compare a Creator Kit_Components export against kit_bom/kit_components.csv.

Why this exists: publishing a Creator app carries design but NOT records, so every
hand-seeded table drifts between Development and Production independently. On
2026-08-03 the Production Kit_Components was missing `Channels_Per_CMU` on all
three `cmu_from_series_cells` rows, which made all three CMU kits fail with
"Kit data error: Channels Per CMU missing". Development had the values. Nobody
noticed because nothing compares the two.

Usage:
    # Creator -> Kit_Components report -> ... -> Export -> CSV
    python3 scripts/kit_components_reconcile.py <exported.csv>
    python3 scripts/kit_components_reconcile.py <exported.csv> --json

Exit 0 when the export matches the repo BOM, 1 on any drift.
"""
import argparse
import csv
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
BOM_CSV = os.path.join(REPO_ROOT, "kit_bom", "kit_components.csv")

# Fields worth comparing. Notes/Source_Row are documentation and drift harmlessly,
# so they are reported separately rather than failing the run.
COMPARED = [
    "Kit_Main_SKU",
    "Description",
    "Requirement",
    "Qty_Rule",
    "Qty_Value",
    "Channels_Per_CMU",
    "Alternate_SKU",
    "Confidence",
]
INFORMATIONAL = ["Source_Row", "Notes"]
KEY = ("Kit_Key", "Component_SKU")


def norm_header(name):
    """'Channels Per CMU' / 'Channels_Per_CMU' -> 'channels_per_cmu'.

    Creator exports use display names ('Kit Key'); the repo CSV uses link names
    ('Kit_Key'). Underscores are separators, not characters to drop.
    """
    cleaned = "".join(
        ch if (ch.isalnum() or ch in " _") else " "
        for ch in str(name).strip().lower()
    ).replace("_", " ")
    return "_".join(cleaned.split())


def norm_value(v):
    """Creator renders empty numerics as blank; treat blank/None/'-' alike."""
    s = "" if v is None else str(v).strip()
    return "" if s in ("-", "--") else s


def load(path):
    """Return {(kit_key, component_sku): {normalised_field: value}}."""
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        raise SystemExit(f"{path}: empty file")
    header = [norm_header(h) for h in rows[0]]
    wanted = {norm_header(c) for c in COMPARED + INFORMATIONAL + list(KEY)}
    if not {norm_header(k) for k in KEY} <= set(header):
        raise SystemExit(
            f"{path}: could not find Kit_Key / Component_SKU columns.\n"
            f"Saw: {', '.join(header)}"
        )
    out = {}
    for raw in rows[1:]:
        if not any(norm_value(c) for c in raw):
            continue
        rec = {}
        for i, col in enumerate(header):
            if col in wanted:
                rec[col] = norm_value(raw[i] if i < len(raw) else "")
        key = (rec.get("kit_key", ""), rec.get("component_sku", ""))
        if key == ("", ""):
            continue
        out[key] = rec
    return out


def main():
    ap = argparse.ArgumentParser(description="Reconcile a Creator Kit_Components export against the repo BOM.")
    ap.add_argument("export_csv", help="CSV exported from the Creator Kit_Components report")
    ap.add_argument("--bom", default=BOM_CSV, help="repo BOM (default: kit_bom/kit_components.csv)")
    ap.add_argument("--json", action="store_true", help="emit the report as JSON")
    args = ap.parse_args()

    bom = load(args.bom)
    live = load(args.export_csv)

    missing = sorted(k for k in bom if k not in live)     # in repo, absent from Creator
    extra = sorted(k for k in live if k not in bom)       # in Creator, absent from repo
    diffs = []
    notes_only = []
    for key in sorted(set(bom) & set(live)):
        for col in COMPARED:
            n = norm_header(col)
            want, got = bom[key].get(n, ""), live[key].get(n, "")
            if want != got:
                diffs.append({"kit_key": key[0], "component_sku": key[1],
                              "field": col, "repo": want, "creator": got})
        for col in INFORMATIONAL:
            n = norm_header(col)
            if bom[key].get(n, "") != live[key].get(n, ""):
                notes_only.append({"kit_key": key[0], "component_sku": key[1], "field": col})

    report = {
        "bom_rows": len(bom),
        "creator_rows": len(live),
        "missing_from_creator": [{"kit_key": k[0], "component_sku": k[1]} for k in missing],
        "extra_in_creator": [{"kit_key": k[0], "component_sku": k[1]} for k in extra],
        "field_mismatches": diffs,
        "informational_only": notes_only,
    }
    drift = bool(missing or extra or diffs)

    if args.json:
        print(json.dumps(report, indent=2))
        return 1 if drift else 0

    print(f"repo BOM rows: {len(bom)}   Creator rows: {len(live)}")
    print()
    if missing:
        print(f"MISSING from Creator ({len(missing)}) — the kit resolver will never see these:")
        for k in missing:
            print(f"  - {k[0]} / {k[1]}")
        print()
    if extra:
        print(f"EXTRA in Creator ({len(extra)}) — not in the repo BOM:")
        for k in extra:
            print(f"  + {k[0]} / {k[1]}")
        print()
    if diffs:
        print(f"FIELD MISMATCHES ({len(diffs)}):")
        for d in diffs:
            repo_v = d["repo"] or "(blank)"
            live_v = d["creator"] or "(blank)"
            print(f"  {d['kit_key']} / {d['component_sku']} · {d['field']}")
            print(f"      repo:    {repo_v}")
            print(f"      Creator: {live_v}")
        print()
    if notes_only:
        labels = sorted({"%s/%s:%s" % (n["kit_key"], n["component_sku"], n["field"]) for n in notes_only})
        print("Documentation-only drift, not failed (%d): %s" % (len(notes_only), ", ".join(labels)))
        print()

    if drift:
        print("DRIFT — fix Creator to match the repo BOM, then re-export and re-run.")
        return 1
    print("PASS — Creator Kit_Components matches the repo BOM.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
