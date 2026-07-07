# Workbook Audit — Visual Inspection Packet

Plain-English guide to the CSVs in this folder. Everything here was queried
straight from `audit/workbook_audit.sqlite` after a from-scratch rebuild of the
full pipeline (DB deleted, all five scripts re-run in order) — the regenerated
reports matched the committed baseline byte-for-byte except the load timestamp
in `workbook_audit_summary.md`.

**Look at these first, in this order:**

## 1. `unpriced_skus.csv` — the 5 unpriced SKUs, with vendor status evidence
One row per unpriced SKU, joined to its fill-color status mark. What it
proves: all five are explained by the vendor's own color coding —
102100/103005/200400/300400 are **Discontinued** (all c-BMS18) and 101815 is
**New Item added** (DRAFT). This is the evidence behind Bill/Bryan decisions
2 and 3 in the Zoho comment.

## 2. `duplicate_skus.csv` — the only duplicate SKUs: 300300 and 300500
Both rows of each pair, with the band-1 price so you can see the difference:
the rows with an empty `band1_price_eur` are the bundle-style rows (rows
54/55, priced only in higher bands), the ones with 450.0 are the unit-price
rows (rows 58/60). Note the descriptions differ only by capitalization
("SERVICE" vs "Service"). Decision 1: which row is canonical.

## 3. `lem_blank_tiers.csv` — proof the LEM 0.00 issue is NOT in the workbook
Every price cell for 000637/000833/000876. Each has exactly one real price
(89.65 in band 1-19); for every higher band, `no_cell_exists` = 1 and the raw
cell value is empty — the workbook has **no** stored 0.00. Any $0.00 at
qty>19 is created downstream (import/defaulting logic). Decision 4: how blank
tiers should behave.

## 4. `config_only_parts.csv` — parts in kit BOMs with no price row
Currently one row: **100683** Compact shunt (300A/50mV), optional qty 1 on
the `n3-BMS w 100809` kit, absent from RSP_EUR pricing. Decision 5: resolve
with the vendor before kit-based quoting relies on it.

## 5. `config_summary.csv` — coverage of the six config sheets
Row counts per sheet (49 total), optional/main/unclassified requirement
markers, and a `missing_part_numbers` column that should read 0 everywhere.
Proves the config extraction is complete and every BOM line has a SKU.

## 6. `table_counts.csv` — pipeline totals at a glance
Row counts for all 9 database tables. Expected values: workbook 1, sheet 9,
merged_range 18, style 128, cell 734, product_row 46, price_point 323,
config_row 49, status_mark 131. If a rebuild ever shows different numbers,
something changed — either the workbook file or a script.

---

To rebuild everything from scratch:

```
rm -f audit/workbook_audit.sqlite
python3 audit/load_workbook.py
python3 audit/classify_status_marks.py
python3 audit/extract_config_rows.py
python3 audit/extract_price_points.py
python3 audit/report.py
```

`report.py` exits nonzero if any figure drifts from the committed baseline.
