#!/usr/bin/env python3
"""Build the import-ready Kit_Components seed for Creator dev (Phase B prep).

Reads kit_bom/kit_components.csv (12 columns) and emits
artifacts/kit_components_seed.json with the three derived columns added,
per docs/CREATOR_KIT_DEPLOYMENT_PACKET.md §3:

- Is_Blocked  = "Y" only when Notes carries the not_in_rsp_unquotable marker
                (expected: exactly n3bms_cmu12/100683), else "N".
- Hold_Reason = "Q1" for cbms24 pending_business rows, "Q2" for n3bms_cmu18
                pending_business rows, blank otherwise. Is_Blocked rows take
                precedence and stay blank. Both holds were RESOLVED by the
                2026-07-25 vendor config (see docs/KIT_CONFIG_UPDATE_2026-07-25.md),
                so both sets are now expected to be empty.
- Warning_Text = seeded only for Not_Released components (101814), else blank.

Prints a verification summary and exits non-zero on any deviation from the
expected derivation, so it double-checks itself against the packet.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "kit_bom" / "kit_components.csv"
OUT = ROOT / "artifacts" / "kit_components_seed.json"

BLOCKED_MARKER = "not_in_rsp_unquotable"
WARNING_TEXT = {"101814": "Not_Released — confirm availability before quoting"}

EXPECTED = {
    "rows": 42,
    "blocked": {("n3bms_cmu12", "100683")},
    "q1": set(),
    "q2": set(),
    "warned": {("n3bms_cmu18", "101814")},
}


def derive(row):
    key = (row["Kit_Key"], row["Component_SKU"])
    blocked = BLOCKED_MARKER in row["Notes"]
    hold = ""
    if not blocked and row["Confidence"] == "pending_business":
        hold = "Q1" if row["Kit_Key"] == "cbms24" else "Q2"
    row["Is_Blocked"] = "Y" if blocked else "N"
    row["Hold_Reason"] = hold
    row["Warning_Text"] = WARNING_TEXT.get(row["Component_SKU"], "")
    return key, blocked, hold


def main():
    with SRC.open(newline="") as f:
        rows = list(csv.DictReader(f))

    got = {"blocked": set(), "q1": set(), "q2": set(), "warned": set()}
    for row in rows:
        key, blocked, hold = derive(row)
        if blocked:
            got["blocked"].add(key)
        if hold == "Q1":
            got["q1"].add(key)
        if hold == "Q2":
            got["q2"].add(key)
        if row["Warning_Text"]:
            got["warned"].add(key)

    ok = len(rows) == EXPECTED["rows"] and all(
        got[k] == EXPECTED[k] for k in ("blocked", "q1", "q2", "warned")
    )

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n")

    print(f"rows: {len(rows)} (expected {EXPECTED['rows']})")
    for k in ("blocked", "q1", "q2", "warned"):
        print(f"{k}: {sorted(got[k])} (expected {sorted(EXPECTED[k])})")
    print(f"seed written: {OUT.relative_to(ROOT)}")
    print("PASS" if ok else "FAIL — derivation deviates from packet expectations")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
