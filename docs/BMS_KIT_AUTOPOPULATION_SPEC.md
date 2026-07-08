# BMS Kit Auto-Population — Spec & Seed Data (BI1-T71 / QTS)

Zoho Task ID: `2543412000001469015`
Status: **seed data + validation only** — no Deluge, no Creator changes in this pass.
Requirements source: `docs/MEETING_REQUIREMENTS_2026-07-07.md` §R3/§R4/§R5/§R6.

## Official sources used (verified 2026-07-07)

| Claim | Source |
|---|---|
| CMU12: "Number of cells per unit: 4-12 Cells"; "Number of CMU's supported: 1-32"; "Number of cells in series for total system: 384" | <https://lithiumbalance.com/products/n-bms/> |
| n3-BMS: CMU channels "between 6 and 12"; **no CMU18 mention** | <https://lithiumbalance.com/products/n3-bms-battery-management-system-bms/> |
| i-BMS15: "Number of Voltage channels: 8-15 channels"; "Connect up to 6 of your battery packs in parallel … 'Hot Swap'" — **parallel packs, not daisy-chained boards** | <https://lithiumbalance.com/products/i-bms15/> |
| c-BMS24: up to 24 cells | <https://lithiumbalance.com/products/c-bms24/> |
| c-BMS24X: up to 24 cells; parallel support up to 10 packs | <https://lithiumbalance.com/products/c-bms24x/> |
| Official datasheet index (returns HTTP 403 to automated fetch — browse manually to pull PDFs) | <https://helpdesk.lithiumbalance.com/hc/en-us/articles/8616017930258-List-of-all-off-the-shelf-Sensata-Technologies-BMS-and-their-datasheets> |
| Vendor kit configurations (per-family config sheets in the July 2026 RSP workbook) | `audit/reports/config_rows.csv` (extracted; workbook is the primary source) |

Confidence policy: `datasheet_confirmed` is used **only** where an official Lithium Balance product page or datasheet directly supports the value (currently: CMU12 math). CMU18 math is `pending_datasheet` — the ceil/18 rule rests solely on the vendor config-sheet example ("6 pcs CMU18 in a 96 channel system") and no official page documents CMU18 as of 2026-07-07.

## Data model — `kit_bom/kit_components.csv`

One row per kit component. Columns:

| Column | Values / meaning |
|---|---|
| `Kit_Key` | `ibms15`, `cbms24`, `cbms24x`, `nbms_cmu12`, `n3bms_cmu12`, `n3bms_cmu18` |
| `Kit_Main_SKU` | SKU of the kit's main product (same on every row of the kit) |
| `Component_SKU` | Item_Master SKU this row adds to the quote |
| `Requirement` | `main` (the product itself, exactly one per kit) · `required` (defaults on, normally kept) · `required_removable` (defaults on but freely removable — e.g. CAN adapter 100545 the customer may already own, meeting R5) · `optional` (candidate line, deletable/zero-qty) · `manual` (vendor qty "x" — added only case-by-case, e.g. service tools) |
| `Qty_Rule` | `fixed` (use `Qty_Value`) · `cmu_from_series_cells` (qty = ceil(series_cells / `Channels_Per_CMU`)) · `match_cmu_qty` · `match_mcu_qty` · `manual` |
| `Qty_Value` | integer for `fixed`; blank otherwise |
| `Channels_Per_CMU` | integer, only for `cmu_from_series_cells`; must match the `CMU<N>` token in the description (validated) |
| `Alternate_SKU` | vendor-documented alternate (e.g. 100800 for 100807) |
| `Confidence` | `vendor_config` · `datasheet_confirmed` · `pending_datasheet` · `pending_business` |
| `Source_Row` | workbook config sheet + row (e.g. `n-BMS w 100809!6`) |
| `Notes` | vendor notes, open-question flags (Q1/Q2), and the `not_in_rsp_unquotable` blocked marker |

### CMU quantity math (engineering bounds)

`required_cmus(series_cells, channels) = ceil(series_cells / channels)`, valid only when:
- `series_cells >= 4` (official n-BMS page: 4-cell minimum per CMU — 12 V floor)
- `series_cells <= 384` (official n-BMS page system maximum)
- result `<= 30` CMUs (vendor config sheets say "1 – 30"; the official page says 1–32; the tighter vendor bound wins until clarified — consequence: 384 cells on CMU12 is rejected because it needs 32 CMUs; the largest passing CMU12 system is 360 cells)

Examples (validated by `scripts/kit_bom_check.py`): 96/12=8, 96/18=6, 13/12=2, 24/12=2, 25/12=3.

### Blocked/unquotable components

A `Component_SKU` absent from `import_preview/item_master_import_preview.csv` is allowed **only** with `Confidence=pending_business` and `not_in_rsp_unquotable` in `Notes`; the validator reports it as blocked and fails the run otherwise. Currently one such row: 100683 (Compact shunt 300A/50mV, not in the July 2026 RSP; nearest priced alternative 100684).

### Warning propagation

Kit components whose import-preview `Item_Status != Active` keep their `Quote_Warning` on the auto-populated line (meeting R2: warn and double-check, never hard-block). Currently: 101814 (`Not_Released`, CMU18).

## Validation — `scripts/kit_bom_check.py`

Stdlib-only, read-only, exit 0/1. Proves: kit count and component row count (computed from the CSV, never hardcoded), SKU existence against the import preview, the single blocked row, 300300/300500 resolving to canonical visible rows, enum validity (including `required_removable`), one `main` per kit, Channels_Per_CMU vs description cross-check, and the CMU math + bounds cases above. An unknown SKU without the blocked marker exits nonzero (verified by negative test).

Run: `python3 scripts/kit_bom_check.py`

## Future Creator UX (not built in this pass)

1. Quote author picks a kit (dropdown backed by a future `Kit_Components` Creator form seeded from this CSV) and, for CMU kits, enters `Series_Cell_Count` (new field — schema addition, future pass).
2. A future `fn_get_kit_components` Deluge function expands the kit into candidate `Quote_Lines` rows, applying `Qty_Rule` and copying `Quote_Warning` from Item_Master; the existing draft-pricing autofill then prices each line (reuse the On User Input pattern in `deploy_ready/on_user_input_quote_lines_part_select.creator.deluge` and `functions/fn_calc_line_price_draft.deluge` — subform rows use `row.*`, parent fields `input.*`, per parser notes Incident 5).
3. `optional` / `required_removable` / `manual` lines are freely deletable or zero-qty; individual components remain quotable without any kit (meeting R3/R6 — defaults and warnings, no hard blocks).

## Open questions (people, not code)

- **Q1** — c-BMS24 kit: vendor config assigns c-BMS24X licenses (200300/300300) although 200200/300200 exist at identical pricing. Confirm which SKU to quote (rows marked `pending_business`).
- **Q2** — CMU18 kit harness: vendor config lists the CMU12 harness (100985.1) although 103006 (CMU18 harness) exists in the RSP — probable stale vendor config (row marked `pending_business`).
- **Q3** — 100683 (300A shunt) unpriced/absent from RSP: price it, or substitute 100684.
- CMU18 official datasheet (unblocks `pending_datasheet` on 101814); 30-vs-32 CMU cap clarification; `Series_Cell_Count` field placement (quote header vs kit line); IsoSpyWire SKU identity (meeting R5).
