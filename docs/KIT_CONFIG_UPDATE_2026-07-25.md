# Vendor kit-config update — 2026-07-25

Source: `UPDATED_Item_Master_July.xlsx` (6 tabs, recovered from iCloud Trash; the Desktop
`UPDATED_Item_Master_July.csv` is only the `i-BMS config` tab). Compared against
`kit_bom/kit_components.csv` (49 rows, seeded live into Creator dev `Kit_Components` on 2026-07-08).

This file is a **vendor kit configuration**, not the RSP price list. It changes which components
autofill into a quote and at what quantity. It does not change prices.

## Cross-cutting changes

1. **Every Unified SERVICE tool is removed from every kit** — 300100 (i-BMS), 300300 (c-BMS24 /
   c-BMS24X), 300500 (n-BMS / n3-BMS, both CMU variants). The repo carries them as
   `Requirement=manual` rows. This retires the entire "manual" requirement class from the kit
   resolver unless another kit reintroduces it.
2. **Optional accessories now carry qty 0** where the repo defaults them to 1 or 2 — wire harness
   kits, shunts, LEM sensors. Vendor intent reads as "listed but not auto-added". The current
   resolver has no zero-qty concept; `Requirement=optional` rows autofill at `Qty_Value`.
3. **Required rows are unchanged at qty 1** — main product, Creator license, 100545 Peak CAN adapter.
   100545 remains `required_removable`; the i-BMS tab adds "Check if customer already has", which
   matches the existing meeting-R5 behavior.

## Per-kit deltas

### ibms15 (100916)

- 100981 PARALLEL PACK: qty **2 → 0**
- 300100 i-BMS Unified Service: **removed**

### cbms24 (100924)

- 100930 / 100931 / 100932 / 100684: qty **1 → 0**
- 200300 license comment now "NECESSARY: 1 user" — vendor reaffirms 200300 (not 200200) for this kit
- 300300 c-BMS24X Unified SERVICE Tool: **removed**

### cbms24x (100925)

- 100930 / 100931 / 100932 / 100684: qty **1 → 0**
- 300300: **removed**

### nbms_cmu12 (100807)

- 100802 MCU wire harness comment now "SHOULD AUTO DEFAULT TO '807' QTY" — confirms the existing
  `match_mcu_qty` rule
- 100986 MCU isoSPI wire for CMU 100809: **removed from the kit**
- 100684 shunt: qty **1 → 0**
- 300500: **removed**

### n3bms_cmu12 (100816)

- 200500 → **200600** `n3-BMS Unified Creator License FULL`, comment "CHANGE 1 user"
- 300500: **removed**
- 100683 (300A shunt) still listed, now qty 0; 000637 qty 0

### n3bms_cmu18 (100816 + 101814)

- 100985.1 → **103006** `n-BMS CMU18/4 101814 Wire harness kit (1000mm)` — this resolves open
  question **Q2**, which flagged the CMU12 harness on the CMU18 kit as a source mismatch
- 200500 → **200600**, comment "CHANGE: 1 user"
- 300500: **removed**
- 100684, 000637: qty 0

## Pricing coverage for newly introduced SKUs

| SKU | In July RSP import preview | List / T1 |
| --- | --- | --- |
| 200600 n3-BMS Unified Creator License FULL | yes | 2415.00 / 1811.25 |
| 103006 CMU18/4 wire harness (1000mm) | yes | 66.00 / 54.00 |
| 100683 Compact shunt (300A/50mV) | **no** | unpriced — still `not_in_rsp_unquotable`, now qty 0 |

## Open questions this update resolves

- **Q1 (c-BMS24 license/service SKU family)** — license half answered: keep 200300. Service half
  moot: 300300 is gone from both kits.
- **Q2 (CMU18 harness mismatch)** — answered: 103006.
- **STATUS.md decision 2 (duplicate SKUs 300300 / 300500)** — no longer blocks kit autofill; both
  SKUs leave the kit BOM entirely. Their Item_Master rows and the open
  `CONFIRM_DISCOUNT_CLASS` flag are a separate question.

## Decisions

- **D-K1 — ANSWERED (Blake, 2026-07-25):** qty 0 means **populate the line at qty 0** so the
  preparer can raise it. Not an omission.
- **D-K2 — implemented as the sheet reads:** the service-tool rows are removed from the kit BOM.
  Their Item_Master rows are untouched, so they remain quotable by manual part lookup.
- **D-K3 — implemented as the sheet reads:** 200600 replaces 200500 on the two n3 kits only;
  nbms_cmu12 (100807) stays on 200500.
- **D-K4 — implemented as the sheet reads:** 100986 is dropped from the n-BMS kit, consistent with
  the pre-existing note "included in 100985.1 for 100807".

D-K2/D-K3/D-K4 are literal readings of the vendor workbook rather than separately confirmed
business decisions. Flag them to Bryan if any looks wrong.

## Implemented 2026-07-25 (repo only — nothing deployed)

- `kit_bom/kit_components.csv` — 49 rows → **42**; six service-tool rows and 100986 deleted;
  100985.1 → 103006 on n3bms_cmu18; 200500 → 200600 on both n3 kits; seven optional rows moved to
  qty 0; Q1/Q2 holds cleared; `Source_Row` re-pointed at the new workbook.
- `artifacts/kit_components_seed.json` — regenerated, 42 rows, self-verification PASS.
- `scripts/kit_bom_check.py` — the duplicate-SKU canonical check no longer hardcodes 300300/300500;
  it now derives the duplicated set from the BOM. **PASS**.
- `scripts/kit_expand_sim.py` — assertions updated to the new expected expansion, including
  explicit qty-0-is-included coverage; the same-SKU/different-rule invariant moved to a synthetic
  fixture because no live pair remains. **PASS**.

### Pricing behavior at qty 0 (read from source, not yet live-verified)

`fn_get_tier_price` maps qty 0 to tier index 0, so a qty-0 line shows the **T1 list price**;
`fn_get_discount` finds no `Price_Rules` band (all start at Qty_Min 1) and returns **0%**;
`line_total_usd = unit * 0 = 0`. So a qty-0 line displays an undiscounted unit price and a zero
line total until the preparer raises the qty and the line recalculates on save. No Deluge change
was needed — `fn_get_kit_components` already emits `fixed` rows regardless of quantity.

## Creator dev reconciled 2026-07-26 (Blake approved)

Applied via Creator MCP against `Kit_Components_Report` (development):

- 7 deletes: the six service-tool rows (300100 ×1, 300300 ×2, 300500 ×3) and nbms_cmu12/100986.
- 12 qty edits to 0: ibms15/100981; cbms24 and cbms24x 100930/100931/100932/100684;
  nbms_cmu12/100684; n3bms_cmu12/100683.
- 4 rule conversions `match_mcu_qty` → `fixed` qty 0: 000637 (both n3 kits), n3bms_cmu18/100684,
  and n3bms_cmu12/000637.
- 2 license swaps: 200500 → 200600 on n3bms_cmu12 and n3bms_cmu18 (description updated).
- 1 harness swap: n3bms_cmu18 100985.1 → 103006 (Q2), hold cleared.
- Q1 hold cleared on cbms24/200300 (Confidence → vendor_config).

Read-back verification: 42 records live, per-kit rows and key fields match
`kit_bom/kit_components.csv` exactly (5/7/7/7/8/8).

## Still to do

- Live kit-expansion QA on each of the 6 kits, watching how the widget and the PDF render a
  qty-0 line (expected: T1 list unit price, $0 line total).
- Refresh the Supabase mirror (`kinetic-quote`) from Creator — still holds the old 49.
- 100683 (300A shunt) is still unpriced and still omitted with a notice.
