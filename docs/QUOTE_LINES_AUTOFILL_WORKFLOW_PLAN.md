# Quote_Lines Draft-Time Autofill Workflow Plan — BI1-T71

Zoho Task ID: `2543412000001469015`
Created: 2026-07-03
Status: **Not deployed.** All code below is local-only. No Zoho record was read/modified, no Creator UI or workflow was touched, no Item_Master import was performed, no business decision was made.

---

## What this adds, and how it differs from the existing save-time recalculation

Today, pricing only recalculates when the whole `Quote_Request` record is **saved** — a Creator workflow ("Quote Auto Number and Recalc," per `QTS_PROJECT_STATUS.md`) fires `fn_calc_quote_lines.deluge` on every save. This plan adds **Creator "On User Input" scripts** — client-side-triggered logic that runs the moment a specific field changes, before the record is saved — so a sales rep sees `Part_Number`/`Description`/`Unit_Price`/FX fields populate live while drafting a quote, not only after clicking Save. The save-time path is untouched by this plan; both will coexist (the on-save recalculation remains the source of truth and will simply confirm/overwrite whatever the on-user-input scripts already computed).

---

## Confirmed live field/link names (from repo evidence)

| Field | Confirmed by | Status |
|---|---|---|
| `Part_Select` | `fn_calc_quote_lines.deluge:40-46` (`line.Part_Select.Part_Number`) | Confirmed — Lookup to `Item_Master`. This task's context also confirms its **display value** was recently changed to show item description/name instead of Part_Number; this plan reads `.Part_Number` off the lookup explicitly regardless of what's displayed, so that display change does not affect this logic. |
| `Part_Number` | `fn_calc_quote_lines.deluge`, `fn_get_tier_price.deluge`, `fn_sync_to_sheet.deluge` | Confirmed. |
| `Description` | `fn_calc_quote_lines.deluge`, `fn_generate_pdf.deluge`, `fn_sync_to_sheet.deluge` | Confirmed. |
| `Qty` | `fn_calc_quote_lines.deluge`, `fn_generate_pdf.deluge`, `fn_sync_to_sheet.deluge` | Confirmed. |
| `Unit_Price` | `fn_calc_quote_lines.deluge`, `fn_generate_pdf.deluge` | Confirmed. This task's context confirms it was recently set Admin Only in Creator — that's a **display/edit permission**, not a schema removal; Deluge (including On User Input scripts) can still write to an Admin Only field programmatically, so this plan's autofill still works. |
| `FX_Unit_Price` | `fn_calc_quote_lines.deluge` | Confirmed. Same Admin Only note as `Unit_Price` applies. |
| `Line_Total_USD` | `fn_calc_quote_lines.deluge`, `fn_sync_to_crm.deluge`, `fn_generate_pdf.deluge` | Confirmed. Same Admin Only note. |
| `Line_Total_FX` | `fn_calc_quote_lines.deluge` | Confirmed. Same Admin Only note. |
| `Discountable` | **`Item_Master.Discountable` only** — no function anywhere reads/writes a `Quote_Lines.Discountable` | **Not confirmed to exist on `Quote_Lines`.** Carried over unresolved from `docs/QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md`. See "Confirm before deploying" below. |
| `Discount` | **Does not appear as a field reference anywhere, on any form** | **Not confirmed to exist on `Quote_Lines`.** Same caveat. |
| `Currency` | `fn_calc_quote_lines.deluge`, `fn_generate_pdf.deluge`, `fn_sync_to_sheet.deluge` | Confirmed — parent `Quote_Request` field. |
| `EUR_USD_Rate` | `fn_calc_quote_lines.deluge` (read once, then unconditionally overwritten on save) | Confirmed — parent field. This task's context confirms it was recently set Admin Only. This plan deliberately **does not read it** at draft time (see design note below) — it only matters at save time. |
| `Customer_Type` | `fn_calc_quote_lines.deluge`, `fn_sync_to_sheet.deluge` | Confirmed — parent field, used for pricing (per `docs/QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md` Q6 finding). |

**One field this plan additionally relies on that wasn't in the task's list**: `FX_Charge_Mode` (parent field) — confirmed used by `fn_calc_quote_lines.deluge:8` and `fn_generate_pdf.deluge:80` to decide whether FX conversion applies at all. It must be read alongside `Currency` for the FX recalculation to be correct — omitting it would mean the on-user-input FX logic disagrees with the save-time logic in `fn_calc_quote_lines.deluge`.

### Confirm before deploying

`Discountable`/`Discount` on `Quote_Lines` are **not confirmed** to exist on the live form (same finding as the prior field audit). The code below includes the fill-in logic for both, but **commented out**, because referencing a Creator field that doesn't exist is a hard Deluge error, not a silent no-op — pasting the uncommented version in before confirming would break the on-user-input script entirely (and, unlike a save-time function, an on-user-input script error surfaces directly in the sales rep's browser while they're actively drafting a quote, which is a worse failure mode than a background save error). **A human must confirm these two fields exist on the live `Quote_Lines` subform, with exactly these link names, before uncommenting those lines.**

---

## Files added (local only)

| File | Purpose |
|---|---|
| `functions/fn_calc_line_price_draft.deluge` | New custom function — shared draft-time pricing helper, callable from any On User Input script. Reuses `fn_get_tier_price.deluge` (Tier_Scheme-aware, `-1` sentinel) and `fn_get_discount.deluge` unchanged. |
| `workflows/on_user_input_quote_lines_part_select.deluge` | Script to paste into `Quote_Lines.Part_Select`'s On User Input event. |
| `workflows/on_user_input_quote_lines_qty.deluge` | Script to paste into `Quote_Lines.Qty`'s On User Input event. |
| `workflows/on_user_input_quote_currency_fx.deluge` | Script to paste into **both** `Quote_Request.Currency` and `Quote_Request.FX_Charge_Mode`'s On User Input events (same body, two trigger fields). |

None of these were deployed. `functions/fn_calc_quote_lines.deluge`, `fn_get_tier_price.deluge`, `fn_sync_to_sheet.deluge`, and every other previously-patched function are **unmodified** by this plan.

---

## Exact Creator workflow events needed

Zoho Creator "On User Input" scripts are attached per-field, in the Form Builder (open the form → click the field → **Script** panel → **On User Input**), not via the general Workflow Rules list used for save-triggered automation. Four attachment points are needed:

| # | Form | Field | Event | Script file |
|---|---|---|---|---|
| 1 | `Quote_Request` → `Quote_Lines` subform | `Part_Select` | On User Input | `workflows/on_user_input_quote_lines_part_select.deluge` |
| 2 | `Quote_Request` → `Quote_Lines` subform | `Qty` | On User Input | `workflows/on_user_input_quote_lines_qty.deluge` |
| 3 | `Quote_Request` (parent) | `Currency` | On User Input | `workflows/on_user_input_quote_currency_fx.deluge` |
| 4 | `Quote_Request` (parent) | `FX_Charge_Mode` | On User Input | `workflows/on_user_input_quote_currency_fx.deluge` (same file, attach to this field too) |

---

## Exact field mappings

### Event 1 — `Part_Select` On User Input
| Reads | Writes |
|---|---|
| `input.Part_Select.Part_Number`, `input.Part_Select.Description`, `input.Qty`, `input.Customer_Type`, `input.Currency`, `input.Markup_Rate_Pct`, `input.FX_Charge_Mode` | `input.Part_Number`, `input.Description`; if `Qty` already present also `input.Unit_Price`, `input.FX_Unit_Price`, `input.Line_Total_USD`, `input.Line_Total_FX` |

### Event 2 — `Qty` On User Input
| Reads | Writes |
|---|---|
| `input.Qty`, `input.Part_Select.Part_Number` (or `input.Part_Number` as fallback), `input.Description`, `input.Customer_Type`, `input.Currency`, `input.Markup_Rate_Pct`, `input.FX_Charge_Mode` | `input.Unit_Price`, `input.FX_Unit_Price`, `input.Line_Total_USD`, `input.Line_Total_FX`, `input.Description` |

### Events 3/4 — `Currency` / `FX_Charge_Mode` On User Input (parent-level)
| Reads | Writes |
|---|---|
| `input.Currency`, `input.FX_Charge_Mode`, and for each existing row in `input.Quote_Lines`: `ln.Unit_Price`, `ln.Line_Total_USD` | For each existing row: `ln.FX_Unit_Price`, `ln.Line_Total_FX` only — does **not** touch `Unit_Price`, `Line_Total_USD`, or `Description` (see design note in the file's header comment: those are driven by qty/tier/discount, not currency, and re-touching them here risks double-flagging or masking an in-progress edit). |

---

## Code snippets: use the files directly

Do not copy Deluge code from this doc into Creator. Two rounds of parser-safety fixes since this section was first written (see `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md`) each left an embedded copy here stale relative to the real files - so this section no longer embeds code at all. The files in `functions/` and `workflows/` are the only source of truth; copy directly from them.

| Event | File to paste |
|---|---|
| Helper function - deploy first | `functions/fn_calc_line_price_draft.deluge` |
| Event 1 - `Part_Select` On User Input | `workflows/on_user_input_quote_lines_part_select.deluge` |
| Event 2 - `Qty` On User Input | `workflows/on_user_input_quote_lines_qty.deluge` |
| Events 3/4 - `Currency` and `FX_Charge_Mode` On User Input (same file, both fields) | `workflows/on_user_input_quote_currency_fx.deluge` |

Before pasting, apply the checks in `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` (non-ASCII, ternary, compound `&&`/`||`, chained `ifnull(...) ==`, function calls or bare local variables inside `Quote_Request[...]` criteria, brace/paren balance) against whichever file you're about to paste, and re-run `python3 scripts/tier_price_logic_dryrun.py` and `python3 scripts/quote_line_calc_equivalence_check.py` if `fn_calc_line_price_draft.deluge` or `fn_get_tier_price.deluge` changed since the last verified pass.

---

## Deployment order

1. **Prerequisite (already done per earlier work in this repo)**: `Item_Master.Tier_Scheme` field exists, and the patched `functions/fn_get_tier_price.deluge`, `fn_calc_quote_lines.deluge`, `fn_sync_to_sheet.deluge` are deployed per `docs/TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md`. **Do not proceed with this plan until that deployment is actually done** — `fn_calc_line_price_draft.deluge` calls `thisapp.fn_get_tier_price(...)`, which must already exist and already be Tier_Scheme-aware in Creator, or every On User Input call will fail.
2. Confirm the `Discountable`/`Discount` question on `Quote_Lines` (see "Confirm before deploying").
3. Deploy the new custom function `fn_calc_line_price_draft` (Section "Code snippets," first block) — a plain custom function deploy, same mechanism as any other function in this repo.
4. Attach Event 1 (`Part_Select` On User Input) and test in isolation (Test case 1 below) before adding the rest.
5. Attach Event 2 (`Qty` On User Input) and test (Test case 2).
6. Attach Events 3/4 (`Currency`/`FX_Charge_Mode` On User Input) and test (Test case 3).
7. Only after all four are individually verified, test the full combined draft-editing flow end to end (Test case 5).

---

## Test cases

1. **Part_Select alone, no Qty yet** — start a new blank `Quote_Lines` row, pick an item via `Part_Select`. Confirm `Part_Number` and `Description` populate immediately; confirm `Unit_Price`/FX fields stay untouched (blank/zero) since `Qty` isn't set yet.
2. **Part_Select then Qty** — continuing from test 1, enter a qty. Confirm `Unit_Price` reflects the correct tier band for that qty (test with both a hardware SKU and, once available, a license-tier SKU at qty=10 to directly re-prove the Tier_Scheme fix live in the draft UI, not just on save).
3. **Qty changed on an existing line** — edit `Qty` on an already-priced line. Confirm `Unit_Price`/totals update live to the new tier band without needing to Save first.
4. **Unpriced SKU, live** — pick an item with no published price tier (or type a Part_Number with no matching Item_Master row). Confirm `Unit_Price=0.00` and `Description` shows `[NO PRICE ON FILE - DO NOT QUOTE]` **immediately**, before Save — this is the draft-time equivalent of the guard already proven at save time in `docs/TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md`.
5. **Currency changed after lines exist** — with 2+ priced lines already on the draft, change the quote's `Currency` (or `FX_Charge_Mode`). Confirm `FX_Unit_Price`/`Line_Total_FX` update on every existing line to the new rate, and confirm `Unit_Price`/`Line_Total_USD`/`Description` on those same lines are **unchanged** (this proves the deliberate scoping described in the Events 3/4 file header).
6. **Full save still correct** — after all the above draft-time autofill, Save the record and confirm `fn_calc_quote_lines.deluge` (save-time) recomputes to the exact same values the On User Input scripts already showed — i.e., no disagreement between draft-time and save-time pricing.
7. **Regression on existing hardware-only quotes** — open and re-edit an existing quote created before this deployment; confirm nothing about its already-correct hardware-tier lines changes unexpectedly when touching an unrelated field.

---

## Rollback plan

- **Removing an On User Input script**: open the field in the Form Builder, clear the script box, save. This is immediate and has no data-migration implication — On User Input scripts only run during active editing; removing one does not affect already-saved data.
- **Removing/reverting `fn_calc_line_price_draft`**: since this is a brand-new function (not a modification of an existing one), rollback is simply deleting the custom function in Creator, after first removing all 4 On User Input scripts that call it (to avoid a dangling reference error). Local git history is unaffected either way — `git rm functions/fn_calc_line_price_draft.deluge workflows/on_user_input_*.deluge` would remove it from the repo if the approach is abandoned entirely.
- **No schema rollback needed**: this plan adds zero new fields — everything it writes to is either an already-existing field (per the confirmed table above) or the two optional/commented-out fields that require separate human confirmation before ever being enabled.

---

## Are any additional UI/schema fields needed?

**No new fields are required** for the core behavior (Part_Number/Description/Unit_Price/FX_Unit_Price/Line_Total_USD/Line_Total_FX autofill) — every field involved already exists per the confirmed table above.

**Conditionally**: if the business wants a per-line `Discount`/`Discountable` value visible on `Quote_Lines` itself (not just in the Zoho Sheet export), those two fields need to be confirmed or added to the live subform first — this plan's code already supports populating them (commented out) the moment that's confirmed, requiring no further code change, only uncommenting 2 lines per file and redeploying.
