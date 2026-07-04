# Quote Form / Quote_Lines Field Dependency Audit — BI1-T71

Zoho Task ID: `2543412000001469015`
Review date: 2026-07-03
Scope: Repo-only static audit (grep across all `.deluge`, `.md`, `.py`, `.csv`, `.sql`, `.txt` files). No Zoho records read/modified, no Creator UI changes made, no code edited, no business decisions made. This audit precedes, and gates, the planned manual Creator UI cleanup of the main `Quote_Request` form and `Quote_Lines` subform.

**Context correction noted**: recent manual Creator edits already added `Item_Master.Price_T8`, `Item_Master.Price_T9`, and `Item_Master.Tier_Scheme` (choices `hardware`/`license`) — none of those are re-audited here since they're already committed/documented in `docs/TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md`; this audit is scoped to the fields listed in the request (main `Quote_Request` form + `Quote_Lines` subform).

---

## Executive answer

**Partial.** Most fields are safe to leave alone or make cosmetic (label-only) edits to right now. But two things must be resolved with a human, not assumed, before any schema/link-name edit proceeds:

1. **`Discountable`/`Discount` do not mean what the task's field list implies.** Every current Deluge function reads `Discountable` as an **`Item_Master`** field (`item.Discountable`), never a `Quote_Lines` field. No function anywhere reads or writes a field called `Discount` on `Quote_Lines` at all — the computed discount value is a transient local variable (`discount`) that only ever reaches Zoho **Sheet** (as `Discount_Pct`), never back onto the Creator `Quote_Lines` record. If `Quote_Lines.Discountable` and/or `Quote_Lines.Discount` already exist as live Creator fields (added manually, same as the recent `Item_Master` changes), they are currently **orphaned** — no function populates or reads them. This must be confirmed with whoever is doing the manual UI edits before deciding whether to hide, wire up, or remove them.
2. **One critical dependency lives entirely outside this repo's Deluge source**: the Creator **workflow rule** that fires `fn_generate_pdf` only when `Status == "Send for Signature"` (per `QTS_PROJECT_STATUS.md`'s architecture) is a Creator UI/workflow-trigger condition, not code — it cannot be grepped for and is invisible to this repo. A `Status` dropdown choice-list edit or link-name change could silently break Sign/PDF generation without any error appearing in this repo's code.

Everything else below is either clearly safe or clearly unsafe based on direct evidence.

---

## Field dependency table

### Main `Quote_Request` form

| Field | Read by | Written by | Notes |
|---|---|---|---|
| `Quote_Number` | `fn_generate_pdf.deluge`, `fn_sync_to_crm.deluge`, `fn_sync_to_sheet.deluge`, `fn_send_to_sign.deluge` (all read-only, via `ifnull(quote.Quote_Number, ...)`) | An external Creator **workflow rule** (not in this repo) — presumably calls `fn_get_next_number.deluge` and assigns the result; no function in this repo ever writes `quote.Quote_Number` directly | 4 functions depend on the exact link name. Never user-edited per `QTS_PROJECT_STATUS.md` ("Auto-assigned by workflow"). |
| `Customer_Type` | `fn_calc_quote_lines.deluge` (pricing — passed to `fn_get_discount` as the tier key), `fn_sync_to_sheet.deluge` (mirrors to Sheet) | User-entered on the form | **Used for pricing, not for CRM/Sign sync.** `fn_sync_to_crm.deluge` never reads it. See Executive Q6 answer below. |
| `Quote_Type` | **None** | **None** | Does not exist in any deployed function. Confirmed net-new — see Q7 below. |
| `Inquiry_Type` | **None** | **None** | Does not exist in any deployed function. Only appears in stale pre-build design docs (`kinetic_quote_instructions.md`, `output/creator_quote_app_schema.md`, `output/zoho_quote_applet_research.md`) and this repo's own tracking docs (`STATUS.md`). Confirmed net-new. |
| `Currency` | `fn_calc_quote_lines.deluge` (FX-mode branching + `FX_Rates_Cache[Currency==currency]` lookup), `fn_generate_pdf.deluge` (merge field + FX-mode branching), `fn_sync_to_sheet.deluge` (same FX lookup) | User-entered on the form | Compared via exact string equality (`currency != "USD"`) in 3 functions — see Q8 below for dropdown-conversion risk. |
| `EUR_USD_Rate` | `fn_calc_quote_lines.deluge` (initial read, immediately overwritten), `fn_sync_to_sheet.deluge` (read) | **`fn_calc_quote_lines.deluge`** (`quote.EUR_USD_Rate = eur_usd;` — unconditionally overwrites on every save) | Effectively a system-computed, display-only field today — any manually-entered value is silently replaced on the next save. Should not be presented as freely user-editable. |
| `Sign_Request_ID` | An external Zoho **Flow** (per `QTS_PROJECT_STATUS.md`: webhook matches `Sign_Request_ID` to update `Status`) | `fn_generate_pdf.deluge` (`rec.Sign_Request_ID = signReqId;`) | System-written; a second, undocumented-in-this-repo Flow dependency exists (see Risks). Must not be hand-edited (already flagged in the prior Tier_Scheme audit). |
| `Status` | `fn_sync_to_crm.deluge` (CRM stage mapping), `fn_sync_to_sheet.deluge` (mirrors to Sheet), **a Creator workflow trigger condition (external, not in this repo) that gates whether `fn_generate_pdf` fires at all** | User-entered (dropdown, per `QTS_PROJECT_STATUS.md`); an external Zoho Flow also writes `Status="Signed"` via webhook | Highest-risk field in this audit — see Executive answer #2 and Risks. |
| `Notes` | `fn_sync_to_crm.deluge` (feeds the CRM **Deal's own `Description` field** — a different system/field, not Creator's `Quote_Lines.Description`), `fn_sync_to_sheet.deluge` (mirrors to Sheet) | User-entered; **also overwritten by `fn_send_to_sign.deluge`** (`rec.Notes = response.toString();` — dumps the raw Zoho Sign API response into this field) | See Risks — `fn_send_to_sign.deluge` appears to be a superseded/legacy function (a second, different Sign-integration path from `fn_generate_pdf.deluge`) that would clobber user-entered Notes if it's ever still wired to a live button/workflow. |
| `Markup_Rate_Pct` | `fn_calc_quote_lines.deluge` (pricing), `fn_sync_to_sheet.deluge` (mirrors to Sheet, both header and per-line) | User-entered | Straightforward numeric input, no dropdown/lookup dependency. |

### `Quote_Lines` subform

| Field | Read by | Written by | Notes |
|---|---|---|---|
| `Line_Number` | `fn_generate_pdf.deluge` only (`ifnull(ln.Line_Number, lineCounter)`) | Not written by any function in this repo | **Optional with a graceful fallback already built in** — if absent/blank, `fn_generate_pdf` substitutes its own running counter. Safe to hide if not otherwise needed. |
| `Part_Select` | `fn_calc_quote_lines.deluge` only (Lookup to `Item_Master`; used only to backfill `Part_Number` when it's blank) | User-selected (Lookup field) | Confirmed a Lookup field pointing at `Item_Master`, per the existing in-code comment. |
| `Part_Number` | `fn_calc_quote_lines.deluge`, `fn_get_tier_price.deluge` (via the `Item_Master[Part_Number==...]` query), `fn_sync_to_sheet.deluge` | User-entered directly, or backfilled from `Part_Select` by `fn_calc_quote_lines.deluge` | Central join key to `Item_Master` across 3 functions. |
| `Description` | `fn_generate_pdf.deluge` (PDF line item text) | `fn_calc_quote_lines.deluge` (copied from `Item_Master.Description`; also where the `[NO PRICE ON FILE - DO NOT QUOTE]` marker from the Tier_Scheme patch gets prepended), read again by `fn_sync_to_sheet.deluge` (→ Sheet's `Product_Description` column) | Do not confuse with the *different* `Description` referenced in `fn_sync_to_crm.deluge` — that one is the **CRM Deal's own `Description` field**, fed from `quote.Notes`, on a completely different system/module. No collision risk between the two, but easy to misread in a quick grep. |
| `Qty` | `fn_calc_quote_lines.deluge` (`.toLong()` cast), `fn_generate_pdf.deluge`, `fn_sync_to_sheet.deluge` | User-entered | Must remain castable to an integer/long — matches the already-recommended "Integer Qty validation" item from the earlier BI1-T71 readiness review. |
| `Unit_Price` | `fn_generate_pdf.deluge` (PDF merge) | `fn_calc_quote_lines.deluge` (computed, `.round(2)`) | System-computed; should be read-only/locked in the UI, not user-editable, or user edits will be silently overwritten on next save (same pattern as `EUR_USD_Rate`). |
| `FX_Unit_Price` | (not independently read downstream beyond being stored) | `fn_calc_quote_lines.deluge` (computed) | System-computed only. |
| `Line_Total_USD` | `fn_sync_to_crm.deluge` (summed into CRM Deal `Amount`), `fn_generate_pdf.deluge` (PDF merge) | `fn_calc_quote_lines.deluge` (computed) | System-computed; feeds the CRM Deal amount — do not make user-editable without also reconciling how that would interact with `fn_sync_to_crm`'s sum. |
| `Line_Total_FX` | (not independently read downstream beyond being stored) | `fn_calc_quote_lines.deluge` (computed) | System-computed only. |
| `Discountable` | **`Item_Master` field only** (`item.Discountable`, read by `fn_calc_quote_lines.deluge` and `fn_sync_to_sheet.deluge`) | N/A on `Quote_Lines` — no function reads or writes a `Quote_Lines.Discountable` | **Not currently a `Quote_Lines` field dependency at all in any deployed function.** If it exists on the live `Quote_Lines` subform, it is either a genuinely new addition not yet wired to any function, or a naming assumption that should be double-checked against the live Creator schema before editing. |
| `Discount` | **Does not appear as a field reference in any function, on any form.** | **None** | The computed discount value only ever reaches Zoho Sheet's `Quote_Lines` tab as a column named `Discount_Pct` (via `fn_sync_to_sheet.deluge`) — it is never written back to the Creator `Quote_Lines` subform record itself under any name. If a `Quote_Lines.Discount` field exists live in Creator, it is orphaned (nothing populates it) unless `fn_calc_quote_lines.deluge` is also changed to write `line.Discount = discount` (a genuine code change, not yet made). |

---

## Safe UI edits now (label-only, no link-name change)

These can be changed cosmetically (display label, help text, field order/grouping, section placement) with zero risk to any function, since every dependency below keys off the **link name**, not the display label, and Deluge only ever references link names:

- `Quote_Number`, `Customer_Type`, `Currency`, `EUR_USD_Rate`, `Sign_Request_ID`, `Notes`, `Markup_Rate_Pct` (main form)
- `Part_Select`, `Part_Number`, `Description`, `Qty`, `Unit_Price`, `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX`, `Line_Number` (subform)

`Status` is safe to **re-label** but its **choice-list values** must not change (see Risks) since both Deluge string comparisons and an external Creator workflow-trigger condition depend on the exact stored values (`"Draft"`, `"Send for Signature"`, `"Signed"`, etc.).

---

## Do-not-rename fields (link name changes would break something)

| Field | Why |
|---|---|
| `Quote_Number` | 4 functions + an external auto-numbering workflow read/depend on this exact link name. |
| `Customer_Type` | Read directly by `fn_calc_quote_lines.deluge`; its stored *values* also drive `Price_Rules` lookups in `fn_get_discount.deluge` (`Customer_Type == p_customer_type`) — both the field link name and its value strings (`"End Customer"`, `"Distributor"`, `"Partner"`) must stay exactly as-is. |
| `Currency` | 3 functions do exact string comparisons and `FX_Rates_Cache` lookups keyed on this value. |
| `EUR_USD_Rate` | Read and unconditionally overwritten by `fn_calc_quote_lines.deluge`. |
| `Sign_Request_ID` | Written by `fn_generate_pdf.deluge`; matched by an external Zoho Flow webhook condition (documented in `QTS_PROJECT_STATUS.md`, not visible in this repo's code — do not treat "not found via grep" as "no dependency"). |
| `Status` | Read by 2 functions; its **choice values** are matched by a Creator workflow-trigger condition (external) that gates `fn_generate_pdf`, and by the same external Flow that writes `"Signed"`. Both the link name and the exact choice strings are load-bearing. |
| `Notes` | Read by 2 functions (feeds CRM Deal Description + Sheet); also written (overwritten) by `fn_send_to_sign.deluge` if that function is ever still invoked (see Risks). |
| `Markup_Rate_Pct` | Read by 2 functions. |
| `Part_Select` | Read by `fn_calc_quote_lines.deluge` as a Lookup to `Item_Master` — both the link name and its target-module binding (`Item_Master`) must stay intact. |
| `Part_Number` | Central join key across 3 functions to `Item_Master`. |
| `Description` (subform) | Read/written by `fn_calc_quote_lines.deluge`, read by `fn_generate_pdf.deluge` and `fn_sync_to_sheet.deluge`. |
| `Qty` | Read by 3 functions, cast to `.toLong()`. |
| `Unit_Price`, `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX` | All written by `fn_calc_quote_lines.deluge`; `Line_Total_USD` additionally feeds the CRM Deal `Amount` sum in `fn_sync_to_crm.deluge`. |

---

## Fields safe to hide later (not rename, just remove from view/layout)

- **`Line_Number`** — confirmed optional with a graceful in-code fallback (`fn_generate_pdf.deluge` substitutes its own counter if blank). Safest field in this entire audit to hide.
- **`EUR_USD_Rate`, `Unit_Price`, `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX`** — all system-computed and overwritten on every save; hiding them from data-entry view (making them read-only/display-only rather than editable) is safe and arguably an improvement, since any manual edit is silently discarded anyway. (Hiding entirely vs. making read-only is a UI choice — either is safe with respect to Deluge, since the functions only read/write, never check visibility.)
- **`Part_Select`** — could be hidden if the workflow standardizes on always using `Part_Number` directly, since it's only a convenience backfill path; but confirm with whoever built the intended sales workflow before hiding, since it may be the primary way reps are expected to pick items.

---

## Fields requiring workflow/function changes (not just UI edits)

- **`Quote_Type` / `Inquiry_Type`** — adding these as new fields is schema-only and safe (nothing currently reads them, so nothing can break), but they will do nothing functionally until some function or workflow is updated to read and act on them. See Q7 below for the recommended link name.
- **`Discount` (subform, if it should actually carry the computed per-line discount)** — currently orphaned everywhere; wiring it up requires editing `fn_calc_quote_lines.deluge` to add `line.Discount = discount;` (and, for consistency, likely `line.Discountable` if a per-line override of `Item_Master.Discountable` is desired) — a genuine Deluge change, not made in this audit, and not to be made without confirming the business intent first (a line-level Discount field could mean "computed discount %" or "editable override" — different implications).
- **`Currency` as a Dropdown** — see Q8 below; converting the type is likely safe but requires a data check first, not a code change.

---

## Recommended exact Creator UI changes

(Recommendations only — no business decision made, no Zoho touched.)

1. Confirm with whoever did the recent manual `Item_Master` edits whether `Quote_Lines.Discountable`/`Quote_Lines.Discount` already exist live in Creator, and if so, what they're intended to mean — before any hide/rename/wire-up decision.
2. Make `EUR_USD_Rate`, `Unit_Price`, `FX_Unit_Price`, `Line_Total_USD`, `Line_Total_FX` **read-only** in the Creator layout (not hidden — still useful to see, just not editable) to stop any confusion about them being manually adjustable.
3. Hide `Line_Number` from the visible layout if it isn't otherwise needed by sales reps — it has zero downstream dependency risk.
4. Leave `Status` field type, link name, and **choice-list values** completely untouched in this pass — cosmetic label edits only, if any.
5. Add `Quote_Type`/`Inquiry_Type` as brand-new fields (see Q7) — purely additive, no risk to existing functions, but functionally inert until wired up separately.
6. Do not convert `Currency` to a Dropdown in the same pass as any other change — treat it as its own, isolated step with the data check described in Q8.

---

## Risks

1. **`Status` choice-list values are relied on by a Creator workflow-trigger condition that lives entirely outside this repo.** No amount of grepping this repo will surface that dependency — it can only be confirmed by opening the Creator workflow rules UI directly. Treat "not found in the repo" as "not yet confirmed," not "confirmed safe," for this specific field.
2. **`fn_send_to_sign.deluge` overwrites `Notes` with a raw API response** (`rec.Notes = response.toString();`) and uses a different Zoho Sign integration path (`sign.zoho.com/api/v1/templates/.../createsendrequest`) than the one documented as current/working in `QTS_PROJECT_STATUS.md` (`fn_generate_pdf.deluge`'s Writer merge-and-sign call). This function appears to be superseded/legacy. It is not called by any other function in this repo, but if it is still wired to a live Creator button or workflow, saving/using it would silently destroy whatever a sales rep typed into `Notes`. Confirm whether `fn_send_to_sign` is still attached to anything in Creator before doing any other Notes-related cleanup — this is unrelated to the current UI-cleanup task but was surfaced by this audit and is worth a quick check.
3. **`kinetic_quote_schema.sql` and `output/creator_quote_app_schema.md` do not match the deployed schema at all** (zero grep hits for any of the audited field names in the SQL file) — confirmed stale, consistent with prior findings in this repo. Do not use either as a reference when planning UI edits.
4. **Converting `Currency` from text to Dropdown risks orphaning existing test records** if their current free-text values don't exactly match the new dropdown's choice list (case-sensitive string comparisons are used throughout the Deluge code) — a data check of existing `Quote_Request` records' `Currency` values should happen first, not assumed.
5. **DKK remains unsupported in `fn_refresh_fx_rates.deluge`** (unchanged finding from the original BI1-T71 readiness review) — this is a pre-existing, separate blocker, not introduced by this audit, but relevant if `Currency`'s choice list is being finalized in this same UI pass; don't add `DKK` as a choice without first resolving that blocker.

---

## Next human action

Before touching the Creator UI for `Quote_Request`/`Quote_Lines`:
1. Confirm live-Creator state of `Quote_Lines.Discountable`/`Discount` (do they already exist? what's intended?) — this is the one thing this repo-only audit cannot answer.
2. Separately confirm the exact Creator workflow-trigger condition on `Status` (screenshot or export it) so it's documented in this repo going forward, closing the "invisible to grep" gap this audit identified.
3. Once both are confirmed, the "Recommended exact Creator UI changes" list above can proceed as a low-risk UI-only pass — no code changes required for items 2, 3, 4, 5, or 6 in that list.
