# Creator Implementation Packet — BMS Kit Helper (BI1-T71)

Zoho Task ID: `2543412000001469015`
Status: **repo-only planning packet** — no Deluge, no Creator changes, no live Zoho in this pass.
Schema basis: **live MCP-confirmed** `qts` (workspace `bevcollc`, development) schema, verified 2026-07-08.
Related: `docs/BMS_KIT_AUTOPOPULATION_SPEC.md` (algorithm + pseudocode), `scripts/kit_expand_sim.py`
(executable spec), `kit_bom/kit_components.csv` (seed data), `scripts/kit_bom_check.py` (seed validator).

**Design invariant (already proven by `scripts/kit_expand_sim.py`):** the kit helper only
**inserts ordinary `Quote_Lines` rows** (`Part_Number` string + numeric `Qty`) and **delegates all
pricing to the existing save-time `fn_calc_quote_lines`**. It prices nothing itself.

## Live schema facts this packet is built on (2026-07-08)

- `Quote_Request` and its `Quote_Lines` subform exist. `Quote_Lines` fields: `Line_Number`,
  `Part_Select` (lookup → `Item_Master`), `Part_Number`, `Description`, `Qty`, `Unit_Price`,
  `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX`, `Discount` (displayed "Discountable",
  choice stub, admin-only).
- `Item_Master` fields: `Part_Number`, `Description`, `Category`, `Tier_Scheme` (Hardware/License),
  `Price_T1`..`Price_T9`, `Discountable` (real Text Y/N). **No `Item_Status`/`Quote_Warning`/`Active`.**
- `Quote_Type` (Battery/BMS/Other), `Currency` (USD/EUR), `Customer_Type` (Text), `old_currency`
  (leftover) all exist. `Kit_Components` form, `Kit_Select`, `Series_Cell_Count`, a `Quote_Lines`
  warning field, and any Expand-kit button/workflow are **missing**.
- Zoho Sheet tabs and the Zoho Sign template are live.

## 1. Required Creator schema additions

| Object | Addition | Why |
|---|---|---|
| **New form** `Kit_Components` | Seeded from `kit_bom/kit_components.csv` (49 rows) | Data source the expander reads; keeps kit logic out of `Item_Master` (which is import-blocked) |
| `Quote_Request` | field `Kit_Select` | pick which kit to expand |
| `Quote_Request` | field `Series_Cell_Count` | CMU qty math input (CMU kits only) |
| `Quote_Request` | field `Kit_Expand_Notice` (preparer-visible, multi-line) | surfaces held (Q1/Q2) + warning summary at expand time |
| `Quote_Request` | button `Expand_Kit` + its workflow | the trigger |
| `Quote_Lines` subform | field `Kit_Warning` (Single Line) | per-line warning display (Not_Released / qty-unconfirmed) |

**No live `Item_Master` changes in this pass** — warnings are carried in `Kit_Components`, so the
blocked production import does not gate this work.

## 2. Exact field link names to add

**`Quote_Request`:**

- `Kit_Select` — Dropdown; keys = the six kit keys, values = friendly labels:
  `ibms15`→"i-BMS15", `cbms24`→"c-BMS24", `cbms24x`→"c-BMS24X", `nbms_cmu12`→"n-BMS (CMU12)",
  `n3bms_cmu12`→"n3-BMS (CMU12)", `n3bms_cmu18`→"n3-BMS (CMU18)". Store the **key** for Deluge matching.
- `Series_Cell_Count` — Number (integer).
- `Kit_Expand_Notice` — Multi Line, **preparer-visible (not admin-only)** so held Q1/Q2 notices
  and warnings are seen by staff.
- `Expand_Kit` — Button (runs workflow "Expand Kit").

**`Quote_Lines` subform:**

- `Kit_Warning` — Single Line, preparer-visible (not admin-only).

## 3. `Kit_Components` form fields (from `kit_bom/kit_components.csv`)

| Link name | Creator type | Source column / seed |
|---|---|---|
| `Kit_Key` | Single Line (or Dropdown, 6 keys) | `Kit_Key` |
| `Kit_Main_SKU` | Single Line | `Kit_Main_SKU` |
| `Component_SKU` | Single Line | `Component_SKU` |
| `Description` | Single Line | `Description` |
| `Requirement` | Dropdown: main / required / required_removable / optional / manual | `Requirement` |
| `Qty_Rule` | Dropdown: fixed / cmu_from_series_cells / match_cmu_qty / match_mcu_qty / manual | `Qty_Rule` |
| `Qty_Value` | Number | `Qty_Value` |
| `Channels_Per_CMU` | Number | `Channels_Per_CMU` |
| `Alternate_SKU` | Single Line | `Alternate_SKU` (informational; **never auto-substitute**) |
| `Confidence` | Dropdown: vendor_config / datasheet_confirmed / pending_datasheet / pending_business | `Confidence` |
| `Source_Row` | Single Line | `Source_Row` |
| `Notes` | Multi Line | `Notes` |
| `Is_Blocked` | Dropdown Y/N | derived: `not_in_rsp_unquotable` marker → Y (only 100683) |
| `Hold_Reason` | Single Line | derived: `Q1`/`Q2` for `pending_business` rows, else blank |
| `Warning_Text` | Single Line | seeded per component (e.g. 101814 → "Not_Released — confirm availability"; blank if Active) |

The three derived columns (`Is_Blocked`, `Hold_Reason`, `Warning_Text`) let the Deluge avoid parsing
free-text `Notes` — cleaner and matches how `scripts/kit_expand_sim.py` already classifies rows.

## 4. `Quote_Request` fields / button

As in §2. Behavior: preparer sets `Kit_Select` (and `Series_Cell_Count` for CMU kits), clicks
**Expand_Kit** → workflow inserts candidate rows and writes `Kit_Expand_Notice`. `Series_Cell_Count`
is ignored for `ibms15`/`cbms24`/`cbms24x`. Assumption: **one kit per quote** (single header
`Series_Cell_Count`); multi-kit is a documented future item.

## 5. `Quote_Lines` warning/display field recommendation

Add **`Kit_Warning`** (Single Line, preparer-visible). The expander writes the component's
`Warning_Text` (+ a "quantity math unconfirmed" note when `Confidence=pending_datasheet`, e.g.
CMU18/101814). **Do not** put warnings in `Description` — `fn_calc_quote_lines` overwrites
`Description` on save. `fn_calc_quote_lines` never references `Kit_Warning`, so it is safe from
recalc. **Do not** reuse the `Discount` stub for warnings.

## 6. Deluge deployment order

1. **Create `Kit_Components` form** (fields per §3), then **seed its records** from
   `kit_bom/kit_components.csv`.
2. **Add the `Quote_Request` + `Quote_Lines` fields/button** (§2).
3. **`fn_get_kit_components(kit_key, series_cells)`** — pure/read-only: returns a list of Maps
   (`Part_Number`, `Qty`, `Kit_Warning`) applying the two-pass qty rules and outcome precedence
   (`Is_Blocked`→omit, `Hold_Reason`→hold, `manual`→off, else include). No writes. Raises on bad
   bounds / orphan `match_*`.
4. **"Expand Kit" button workflow** — calls `fn_get_kit_components`, inserts `Quote_Lines` rows (set
   `Part_Number` + numeric `Qty` + `Kit_Warning`), writes held/warning summary into
   `Kit_Expand_Notice`; **idempotency guard**: skip if a row with `Part_Number == Kit_Main_SKU`
   already exists ("kit already expanded").
5. **Rely on existing save-time `fn_calc_quote_lines`** to price the inserted rows — **no change to it**.

Deploy to **development** first; verify; promote later. Paste sources from the `deploy_ready/`
convention (Incident 5: subform `row.*`, parent `input.*`).

## 7. QA test checklist (dev)

- [ ] Each of 6 kits expands; row counts + qtys match `python3 scripts/kit_expand_sim.py` output.
- [ ] `nbms_cmu12` @ `Series_Cell_Count=96` → CMU `100809` qty 8, harness `100985.1` qty 8,
      MCU-matched harnesses qty 1, license `200500` qty 1, CAN adapter `100545` present, service
      tool `300500` **absent** (manual).
- [ ] `n3bms_cmu12` @ 96 → `100683` **omitted** (Is_Blocked); notice lists it.
- [ ] `n3bms_cmu18` @ 96 → `101814` qty 6, `Kit_Warning` populated (Not_Released + qty-unconfirmed);
      harness `100985.1` **held** (Q2), not inserted.
- [ ] `cbms24` → `200300`/`300300` **held** (Q1), not inserted; appear in `Kit_Expand_Notice`.
      `cbms24x` → `200300` included qty 1, `300300` off.
- [ ] Bounds: `Series_Cell_Count` 3 → blocked w/ message; 385 → blocked; 360 → ok; blank on a CMU
      kit → clear error; non-CMU kit ignores the field.
- [ ] **Pricing delegation:** after Expand → Save, every inserted line is priced by
      `fn_calc_quote_lines`; unpriced components show `[NO PRICE ON FILE - DO NOT QUOTE]`; totals
      equal the same lines added manually.
- [ ] Idempotency: Expand pressed twice → no duplicate kit.
- [ ] `optional`/`required_removable` lines deletable and zero-qty-able; `manual` never auto-added.
- [ ] **Regression:** normal `Part_Select` add still works; draft autofill (Part Select / Qty) and
      Currency/FX recalc unchanged; Sheet/CRM/PDF sync unaffected; `Discount` stub untouched.

## 8. Remains blocked by Q1/Q2/Q3 business decisions

| Item | Effect until decided |
|---|---|
| **Q1** — c-BMS24 license/service (`200300`/`300300` vs `200200`/`300200`) | Held + noticed; not auto-inserted for `cbms24`. |
| **Q2** — CMU18 harness (`100985.1` vs `103006`) | Held + noticed for `n3bms_cmu18`. |
| **Q3** — `100683` 300A shunt unpriced/absent | Omitted; price it or substitute `100684` — no code substitution. |
| CMU 30-vs-32 cap; `Series_Cell_Count` header-vs-line; IsoSpyWire identity; CMU18 datasheet (`101814` qty-unconfirmed) | Deploy proceeds with holds/warnings; auto-behavior finalized after decisions. |

## 9. What must NOT be touched

- **`fn_calc_quote_lines` pricing logic** — unchanged; the expander delegates to it.
- **`fn_calc_line_price_draft`** and the two subform On-User-Input draft workflows — unchanged.
- **The `Quote_Lines` `Discount` stub** (link name `Discount`, choice Choice 1/2/3, admin-only) —
  do not write, rename, or repurpose it; the commented-out `row.Discount`/`row.Discountable` writes
  stay commented.
- **`old_currency`**, the `Currency` dropdown, `Quote_Type`, `Customer_Type` — leave as-is.
- **`Item_Master` schema** — no `Item_Status`/`Quote_Warning` additions in this pass (warnings live
  in `Kit_Components`).
- **Sheet tabs / Sign template / CRM sync** — untouched.
- **No equating of differently-named Acme BMS SKUs.**
