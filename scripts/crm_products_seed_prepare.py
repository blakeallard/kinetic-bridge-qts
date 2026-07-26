#!/usr/bin/env python3
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "import_preview" / "item_master_import_preview.csv"
OUT = ROOT / "artifacts" / "crm_products_seed.json"

def main():
    with SRC.open(newline="") as f:
        rows = list(csv.DictReader(f))

    products = []
    skipped = []
    seen = set()
    for row in rows:
        part = row["Part_Number"].strip()
        if row.get("Source_Visibility", "visible") != "visible":
            skipped.append((part, "not visible"))
            continue
        dup_class = row.get("Duplicate_Classification", "")
        if dup_class and dup_class != "CANONICAL_CANDIDATE":
            skipped.append((part, f"duplicate: {dup_class}"))
            continue
        if part in seen:
            skipped.append((part, "already seeded"))
            continue
        seen.add(part)

        rec = {
            "Product_Code": part,
            "Product_Name": row["Description"].strip(),
            "Product_Active": row.get("Active") == "Y"
            and row.get("Item_Status", "Active") == "Active",
            "Product_Category": row.get("Category", ""),
        }
        t1 = row.get("Price_T1", "").strip()
        if t1:
            rec["Unit_Price"] = float(t1)
        warning = row.get("Quote_Warning", "").strip()
        if warning:
            rec["Description"] = warning
        products.append(rec)

    OUT.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n")

    priced = sum(1 for p in products if "Unit_Price" in p)
    active = sum(1 for p in products if p["Product_Active"])
    print(f"source rows: {len(rows)}")
    print(f"seeded: {len(products)} ({priced} priced, {active} active)")
    for part, why in skipped:
        print(f"skipped {part}: {why}")
    print(f"seed written: {OUT.relative_to(ROOT)}")

    ok = len(products) > 0 and len(products) == len(seen)
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
