# Workbook Audit (SQLite) — July 2026 Acme BMS Pricelist

Future-proofing/config-coverage audit of the full `.xlsx`, complementing (not
redoing) the completed `RSP_EUR` pricing audit in `import_preview/` and
`docs/AcmeBMS_REFERENCE_PRICE_QC.md`.

**Source (never modified):**
`~/bevco/data/references/lithium_balance/BMS Pricelist/Acme BMS BMS_July 01_RSP_Distributor.xlsx`
— 9 sheets: `RSP_EUR`, `Distrib discount`, `Changes_Log`, `i-BMS config `,
`c-BMS24 config`, `c-BMS24X config`, `n-BMS w 100809`, `n3-BMS w 100809`,
`n3-BMS w 101814`. No cell comments exist in the file; visual status marks
(CHANGE / Discontinued / NOT RELEASED / Delivery STOP / New Item added, per the
RSP_EUR row-1 legend) live in cell fills, captured via `styles.xml`.

## Layers

1. **Raw (implemented)** — `schema.sql` tables `workbook`, `sheet`,
   `merged_range`, `style`, `cell`. Lossless: every non-empty cell from all 9
   sheets with value, type, formula, and style (fill/font color, bold,
   strikethrough). Loads are idempotent (keyed on file sha256).
2. **Derived (schema only, populated by later scripts)** — `product_row`,
   `price_point` (with `is_blank` to distinguish blank tier cells from stored
   `0.00` — the LEM 000833/000876/000637 issue), `config_row`
   (optional/required markers from the config sheets), `status_mark`
   (fill-color → legend-label mapping).

## Scripts

| File | Status | Purpose |
|---|---|---|
| `schema.sql` | done | Full schema, both layers |
| `load_workbook.py` | done | Layer-1 loader (stdlib-only, read-only on source) → `workbook_audit.sqlite` |
| `classify_status_marks.py` | planned | Map fill RGBs on RSP_EUR to the row-1 legend; populate `status_mark` |
| `extract_config_rows.py` | planned | Parse the 6 config sheets into `config_row` (parts, qty, optional/required) |
| `extract_price_points.py` | planned | Populate `product_row`/`price_point` from raw cells; cross-check against `import_preview/item_master_import_preview.csv` (must reproduce 46 items / 41 priced) |
| `report.py` | planned | Markdown report: config coverage vs Item_Master preview, blank-vs-0.00 price cells, status-marked SKUs |

`workbook_audit.sqlite` is a derived artifact and is gitignored.

## Working assumption — duplicate SKUs 300300 / 300500 (PENDING confirmation)

Hidden RSP_EUR rows **54/55** (bundle-style, `hidden="1"` verified in the
sheet XML) are treated as **legacy rows excluded from live Item_Master
import** (`EXCLUDE_CANDIDATE`); visible rows **58/60** (unit-price) are
treated as the **current canonical rows** (`CANONICAL_CANDIDATE`). This is a
working assumption **pending Bill/Bryan confirmation — it is NOT approved**.
Dispositions are encoded in `import_preview/duplicate_sku_classification.json`
and enforced by a fail-loud duplicate-SKU guard in
`import_preview/generate_preview.py` and `scripts/tier_price_logic_dryrun.py`:
any duplicated SKU without a complete, evidence-consistent
canonical/exclude classification aborts the run. No Deluge function, Zoho
record, or workbook row is modified by any of this. Known gap: the audit DB
does not capture per-row visibility (Layer 1 predates this need); hidden
state is re-verified from the workbook XML on every preview run instead.

## Guardrails

- Never writes to the source workbook or to Zoho Creator.
- Derived scripts must not contradict the completed pricing audit; any
  discrepancy is reported, not "fixed".
