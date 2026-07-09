# Phase C Deluge Plan — BMS Kit Helper (BI1-T71)

Zoho Task ID: `2543412000001469015`
Status: **plan only — no live Deluge/button/workflow created yet.**
Basis: packet §6 steps 3–4, spec "Deluge boundary" pseudocode, `scripts/kit_expand_sim.py`
(behavioral oracle), `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` (house rules).
Phase A schema + Phase B seed (49 records) are live-verified in qts development.

## C1. `fn_get_kit_components(p_kit_key, p_series_cells)` — pure/read-only

Signature: String `p_kit_key`, Int `p_series_cells` (0/blank allowed for non-CMU kits).
Returns one Map: `{"error": "", "notices": List of String, "lines": List of Map}` where each
line Map = `{"Part_Number": String, "Qty": Decimal, "Kit_Warning": String}`. No writes.

Algorithm (mirrors `kit_expand_sim.py` exactly):

1. `rows = Kit_Components[Kit_Key == kit_key_local]` (plain pre-assigned local in criteria —
   allowed; Kit_Components is not Quote_Request, Incident-3 caveat does not apply).
   Empty result → error "unknown kit".
2. Pass 1 (independent qtys): loop rows.
   - `Qty_Rule == "fixed"` → qty = `Qty_Value`.
   - `Qty_Rule == "cmu_from_series_cells"` → bounds first, each its own `if` (no compound
     booleans): `p_series_cells` null/0 → error "Series_Cell_Count required for this kit";
     `< 4` → error; `> 384` → error; compute `cmu = ceil(p_series_cells / Channels_Per_CMU)`
     (assign division to a variable, then ceil — one op per line); `cmu > 30` → error.
   - Record `mcu_qty` (qty of the `Requirement == "main"` row) and `cmu_qty` (qty of the
     cmu_from_series_cells row) as they are found.
3. Pass 2 (dependent qtys): `match_mcu_qty` → mcu_qty; `match_cmu_qty` → cmu_qty.
   Source qty still 0/absent → error "orphan match rule" (matches sim's raise).
4. Outcome precedence per row (separate ifs, `continue`-style structure):
   1. `Is_Blocked == "Y"` → omit; add notice "SKU <n> omitted - not in RSP / unquotable".
   2. `Hold_Reason != ""` → hold; add notice "SKU <n> held (<Q1|Q2>) - see Notes; add manually
      after confirmation". Never pick a SKU.
   3. `Requirement == "manual"` → skip silently (service tools; case-by-case).
   4. Else include: `Part_Number = Component_SKU`, `Qty` = resolved qty, `Kit_Warning` =
      `Warning_Text`; if `Confidence == "pending_datasheet"` append " | quantity math
      unconfirmed" (assign comparison result to a flag var first — house rule 6).
5. Non-CMU kits (`ibms15`/`cbms24`/`cbms24x`): no cmu row exists, so `p_series_cells` is
   never read — must not error when blank.

## C2. `Expand_Kit` button workflow (server-side record button on `Quote_Request`)

1. `input.Kit_Select` blank → write `Kit_Expand_Notice` = "Pick a kit first."; stop.
2. Determine `kit_main_sku`: loop `Kit_Components[Kit_Key == key_local]`, take the
   `Requirement == "main"` row's `Component_SKU` (no compound criteria in brackets).
3. **Idempotency guard**: loop `input.Quote_Lines`; if any `row.Part_Number == kit_main_sku`
   → `Kit_Expand_Notice` = "Kit already expanded - no rows added."; stop.
4. `result = thisapp.fn_get_kit_components(input.Kit_Select, input.Series_Cell_Count)`.
   `result.get("error") != ""` → write it to `Kit_Expand_Notice`; stop. No partial inserts.
5. Insert one `Quote_Lines` subform row per `result.lines` entry, setting ONLY `Part_Number`,
   `Qty`, `Kit_Warning`. Do not set Unit_Price/FX/totals/Description/Discount — save-time
   `fn_calc_quote_lines` prices and describes every line (unchanged, untouched).
6. Write `Kit_Expand_Notice`: joined held/omit notices + "Save the quote to price the lines."
7. Incident-5 rule: subform fields `row.*`, parent fields `input.*`.

## Fields read / written

READ  — `Kit_Components`: Kit_Key, Kit_Main_SKU, Component_SKU, Requirement, Qty_Rule,
        Qty_Value, Channels_Per_CMU, Confidence, Is_Blocked, Hold_Reason, Warning_Text.
        (`Alternate_SKU` is read NEVER for substitution; Notes not parsed.)
READ  — `Quote_Request`: Kit_Select, Series_Cell_Count; `Quote_Lines.Part_Number` (guard).
WRITE — `Quote_Request.Kit_Expand_Notice`; new `Quote_Lines` rows: Part_Number, Qty,
        Kit_Warning only.
NOT TOUCHED — fn_calc_quote_lines, fn_calc_line_price_draft, Discount, old_currency,
        Currency, Quote_Type, Customer_Type, Item_Master, Sheet/Sign/CRM/PDF sync, widget.

## Syntax risks / pre-implementation checks

- **R1 (main risk): subform-row insertion syntax from a record button.** Candidate patterns to
  validate in dev editor before committing: (a) build `List` of `Map` and `input.Quote_Lines.insert(rowsList);`
  (b) row-object pattern. Validate whichever saves + actually persists rows in dev; the QA
  step "expand then save prices lines" catches silent failure.
- **R2: house rules** (parser compat notes): ASCII only, no ternaries, no compound booleans,
  no function calls inside `[...]` criteria, assign-then-compare for `ifnull(...)`, one
  arithmetic op per line, no comment blocks in body.
- **R3: `ceil()` availability/behavior** in Creator Deluge for Decimal division — verify
  `ceil(96 / 12.0) == 8` and `ceil(96 / 18.0) == 6`; integer division truncation is the trap.
  Compute as decimal explicitly.
- **R4: function return type** — declare return as Map; verify `thisapp.` namespace call from
  a button workflow returns the Map intact (fallback: return JSON string, parse in caller).
- **R5: `Expand_Kit` button placement** — record action button (report/detail view), not a
  form field; confirm the button context exposes `input.*` for the record.
- Deploy convention: paste-ready copies in `deploy_ready/` as
  `fn_get_kit_components.creator.deluge` and `wf_expand_kit_button.creator.deluge`;
  masters in `functions/` / `workflows/`.

## QA after implementation (packet §7 highlights)

Six-kit parity vs `python3 scripts/kit_expand_sim.py`; nbms_cmu12@96 → 100809 qty 8,
100985.1 qty 8, 300500 absent; n3bms_cmu12@96 → 100683 omitted+noticed; n3bms_cmu18@96 →
101814 qty 6 with Kit_Warning, 100985.1 held; cbms24 → 200300/300300 held vs cbms24x →
200300 included; bounds 3/385/blank errors, 360 ok; pricing delegation on save; idempotent
double-press; regression on Part_Select/draft autofill/FX/Discount stub.
