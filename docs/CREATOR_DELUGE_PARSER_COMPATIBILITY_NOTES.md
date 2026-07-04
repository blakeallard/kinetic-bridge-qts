# Creator Deluge Parser Compatibility Notes — BI1-T71

Zoho Task ID: `2543412000001469015`
Created: 2026-07-03
Purpose: running record of Zoho Creator's Deluge editor rejecting locally-written function bodies with "Improper Statement," what was actually wrong each time, and the house rules this established. Referenced from `docs/TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md` and `docs/QUOTE_LINES_AUTOFILL_WORKFLOW_PLAN.md` rather than repeated in each.

---

## House rules for any Deluge file under `functions/` or `workflows/` (going forward)

1. **No large comment blocks inside the function/script body.** A one-line pointer comment at the very top (or none at all) is fine; multi-line explanatory headers are not. Full rationale belongs in `docs/`.
2. **ASCII only.** No em-dashes, smart quotes, arrows, or box-drawing characters, even inside a comment. Use a plain hyphen `-` instead of `—`.
3. **No ternary expressions** (`cond ? a : b`). Use an explicit `if`/`else` block instead, even though it's more verbose.
4. **`Quote_Request[ID == ...]` criteria is not reliably safe — verify per function, don't assume.** Both `Quote_Request[ID == p_quote_id.toLong()]` and `Quote_Request[ID == quote_id_long]` (a pre-computed local variable) failed with "Improper Statement" for `fn_calc_quote_lines.deluge` (Incidents 2-3). But the byte-identical `Quote_Request[ID == quote_id_long]` pattern deployed successfully for `fn_sync_to_sheet.deluge` (Incident 4) — so this is **not** a universal rule about the criteria syntax itself; something specific to `fn_calc_quote_lines` (not yet identified) was the actual determining factor, and Creator's parser behavior here is not fully understood. Practical guidance: for `fn_calc_quote_lines.deluge` specifically, keep the unfiltered-loop-plus-if form (Incident 3) — it's proven to work and there's no reason to risk changing it back. For any other function using `Quote_Request[ID == ...]`, do not assume it's safe or unsafe based on this history alone — if a function fails to save with this pattern, fall back to the same unfiltered-loop-plus-if treatment that resolved it for `fn_calc_quote_lines`. For every other module (`Item_Master`, `FX_Rates_Cache`, etc.), a plain local variable inside `[...]` criteria remains fine in every case observed so far — only avoid function calls inside those brackets (e.g. never write `Module[Field == some_call()]`).
5. **No compound boolean conditions** (`&&`/`||` combined, or chained) in a single `if`. Split into nested `if` blocks or explicit boolean flag variables.
6. **Avoid chaining a function call directly into a comparison** in one statement (e.g. `ifnull(x,"N") == "Y"` used directly in an assignment or condition). Assign the function call's result to a variable first, then compare the variable.
7. **Keep arithmetic to single operations per line where practical.** A 2-3 term multiplication chain (`a * b * c`) is usually fine, but when in doubt, break it into named intermediate steps.

These rules apply to the actual paste-target `.deluge` files. They do not apply to prose in `.md` docs (which are not parsed by Creator).

---

## Incident 1 — `fn_get_tier_price.deluge`

**Symptom**: "Improper Statement" error on save in Creator's Deluge editor.

**Root cause**: the file had a ~28-line comment header using em-dashes (non-ASCII `—`) for punctuation. Direct character inspection (`grep -noP '[^\x00-\x7F]'`) confirmed every non-ASCII character in the file was an em-dash, concentrated in that header.

**Fix**: rewrote the header to a 4-line, ASCII-only comment. No logic changed. Verified via `python3 scripts/tier_price_logic_dryrun.py` (12/12 checks passed both before and after) and a brace-balance check.

**Result**: saved successfully in Creator dev on the next attempt.

---

## Incident 2 — `fn_calc_quote_lines.deluge`

**Symptom**: "Improper Statement" error, reported near the top of the function, around the `for each quote in Quote_Request[...]` line.

**Root cause candidates identified, all fixed defensively since Creator's error location did not pinpoint a single exact token**:
- `for each quote in Quote_Request[ID == p_quote_id.toLong()]` — a function call (`.toLong()`) directly inside the module search criteria brackets. This is the most likely single cause, since it sits exactly at the reported error location and violates house rule 4. The already-deployed `fn_sync_to_sheet.deluge` avoids this exact pattern by pre-computing `quote_id_long = p_quote_id.toLong();` before its own `Quote_Request[ID == quote_id_long]` — proof this pre-extraction pattern is safe.
- `eur_usd = (raw_eur_per_usd == 0) ? 1 : (1 / raw_eur_per_usd);` — a ternary expression, a few lines into the same function (house rule 3).
- `if((fx_mode == "non_usd_only" && currency != "USD") || fx_mode == "always")` — a compound boolean condition combining `&&` and `||` (house rule 5).
- Several `ifnull(...) == "value"` chained expressions used directly in assignments (house rule 6).

**Fix**: full conservative rewrite of `functions/fn_calc_quote_lines.deluge`:
- `p_quote_id.toLong()` pre-computed into `quote_id_long` before the `for each` loop.
- The ternary replaced with an `if`/`else` block.
- The compound `apply_fx` condition split into three single-condition `if` blocks with explicit boolean flags (`fx_mode_always`, `fx_mode_non_usd_only`, `currency_not_usd`).
- Every `ifnull(...) == "value"` pattern split into "assign to a variable, then compare the variable."
- The `usd_cost * (1 - discount) * (1 + markup)` chain broken into named steps (`discount_factor`, `markup_factor`, `unit_price_step1`).
- All comments removed from the function body.
- Zero non-ASCII characters (confirmed via `grep -noP '[^\x00-\x7F]'`).

**Logic preserved**: this was a pure parser-safety rewrite, not a business logic change. Verified two ways:
1. `python3 scripts/tier_price_logic_dryrun.py` — still 12/12 passing (this function's tier-price call is unaffected, since `fn_get_tier_price` itself wasn't touched).
2. `python3 scripts/quote_line_calc_equivalence_check.py` — new fixture written specifically for this rewrite; models both the original (ternary/chained) math and the new (decomposed) math for the discount/markup/FX chain and the EUR/USD inversion, and asserts they produce identical results across 7 pricing scenarios plus 4 EUR/USD rate scenarios. 11/11 checks pass.

**Deploy-ready copy**: an identical byte-for-byte copy lives at `deploy_ready/fn_calc_quote_lines.creator.deluge`, kept in sync with `functions/fn_calc_quote_lines.deluge` — copy from either, they are the same file. The separate `deploy_ready/` copy exists so there is always an unambiguous, ready-to-paste artifact even if `functions/` files ever pick up repo-side commentary again in the future.

**Result**: this fix (pre-computed `quote_id_long` inside `Quote_Request[ID == quote_id_long]`) still failed to save in Creator with the same "Improper Statement" error — see Incident 3 below for what actually resolved it. The description above is kept for the record of what was tried, but note the pre-extraction pattern was **not** sufficient on its own for this specific function.

---

## Incident 3 — `fn_calc_quote_lines.deluge`, second failure

**Symptom**: same "Improper Statement" error persisted after the Incident 2 fix, still reported at/near `for each quote in Quote_Request[ID == quote_id_long]`.

**Root cause**: `Quote_Request[ID == ...]` search criteria failed in this Creator instance for `fn_calc_quote_lines` specifically, whether the right-hand side was a function call (`p_quote_id.toLong()`, Incident 2) or a pre-computed plain local variable (`quote_id_long`). Both forms were tried and both failed. This is narrower than house rule 4 originally assumed: plain local variables inside `[...]` criteria are not a general problem in this Creator instance (`Item_Master[Part_Number == part]` and `FX_Rates_Cache[Currency == currency]`, both using plain local variables, are used without issue elsewhere in this same function and file). The failure is specific to `Quote_Request[ID == ...]` criteria in this function.

**Fix**: removed search criteria from the `Quote_Request` loop entirely. The function now loops over every `Quote_Request` record unfiltered and checks `quote.ID == quote_id_long` inside an `if` in the loop body, processing only the match and breaking immediately after:
```
for each quote in Quote_Request
{
	if(quote.ID == quote_id_long)
	{
		...existing body, unchanged...
		break;
	}
}
```
House rule 4 is updated (see above) to reflect that `Quote_Request[ID == ...]` specifically needs this unfiltered-loop-plus-if treatment, while every other module can still use plain-variable `[...]` criteria.

**Correctness verification**: a mechanical statement-by-statement diff (stripping whitespace/indentation) confirmed the rewrite's ~155 statements are identical, in identical order, to the pre-rewrite version, with the only structural difference being the expected extra `if(quote.ID == quote_id_long) { ... }` wrapper (one added open-brace, one added close-brace, nothing else). `break;` still only breaks the enclosing `for each` loop (an intervening `if` does not change `break` targeting), so "process the one matching record, then stop scanning" semantics are unchanged from the filtered-criteria version. Re-ran both `python3 scripts/tier_price_logic_dryrun.py` (12/12) and `python3 scripts/quote_line_calc_equivalence_check.py` (11/11) after the rewrite - both still pass.

**Known tradeoff, accepted deliberately**: this function now scans every `Quote_Request` record on every quote save (it's called first in the documented save-time chain `fn_calc_quote_lines -> fn_sync_to_sheet -> fn_sync_to_crm -> fn_generate_pdf`), instead of a targeted lookup. Cost grows with the size of the `Quote_Request` table. This is a deliberate, accepted consequence of the confirmed Creator parser restriction on this specific function - not an oversight, and not something to "optimize" back to filtered criteria, since that form is confirmed to fail here. If quote volume grows large enough for this to matter, the mitigation would need to come from Creator/Zoho-side options (e.g. a paginated or indexed lookup API) rather than from Deluge search-criteria syntax, since the criteria form itself is what's broken for this function.

**Open question at the time, resolved for one function in Incident 4 below**: `functions/fn_sync_to_sheet.deluge`, `fn_generate_pdf.deluge`, `fn_sync_to_crm.deluge`, and `fn_send_to_sign.deluge` all still use the filtered `Quote_Request[ID == ...]` form (a pre-computed variable in `fn_sync_to_sheet.deluge`'s case, a direct function call in the other three). `fn_generate_pdf.deluge`, `fn_sync_to_crm.deluge`, and `fn_send_to_sign.deluge` remain untested/unconfirmed since they have not been redeployed in this session. `fn_sync_to_sheet.deluge` has since been tested — see Incident 4.

**Simplification pass (code-simplifier)**: after the above fix, a follow-up simplification pass removed three single-use boolean flag variables (`fx_mode_always`, `fx_mode_non_usd_only`, `currency_not_usd`) and one (`is_discountable`) that added no protection beyond the nested `if` structure already in place - each was assigned from exactly one comparison and read exactly once. Collapsed to direct `if(fx_mode == "always")` / `if(fx_mode == "non_usd_only") { if(currency != "USD") ... }` / `if(discountable_val == "Y")` forms, all still single-condition `if`s (no compound `&&`/`||` reintroduced). Re-verified with both test scripts after the simplification.

---

## Incident 4 — `fn_sync_to_sheet.deluge`, contradicting evidence (2026-07-04)

**Symptom**: none — this is a *successful* deploy, recorded here because it directly contradicts what Incident 3 implied about `Quote_Request[ID == ...]` criteria.

**What happened**: `functions/fn_sync_to_sheet.deluge` was deployed and saved successfully in Creator dev, unchanged, still containing `for each  quote in Quote_Request[ID == quote_id_long]` at line 5 — the exact same criteria pattern (pre-computed plain local variable) that failed twice for `fn_calc_quote_lines.deluge` in Incident 3.

**Why this matters**: this is direct evidence against the conclusion drawn in Incident 3 that `Quote_Request[ID == ...]` criteria is categorically broken in this Creator instance. It is not. The same syntax succeeded here and failed there. Since Incident 2's fix had already removed the ternary, compound boolean, and chained `ifnull(...) ==` patterns from `fn_calc_quote_lines.deluge` *before* it was retested and still failed (isolating the criteria bracket as the only remaining variable at that point), the criteria form was a genuine factor in `fn_calc_quote_lines`'s specific failure - but it is evidently not a universal rule about the syntax itself. The true root cause remains unidentified: possibilities include something else specific to `fn_calc_quote_lines.deluge`'s content or structure not yet isolated, or non-deterministic/flaky behavior in Creator's Deluge parser or editor session. Neither can be confirmed without further controlled testing directly in Creator, which is outside what static repo inspection can determine.

**Decision made**: `functions/fn_sync_to_sheet.deluge` was **not** rewritten. It is already deployed and working as-is. Rewriting a live, working function to a full-table-scan-with-if form would be pure downside here - worse performance (this function is also called on every quote save, immediately after `fn_calc_quote_lines`), zero evidenced benefit, and unnecessary redeploy risk to something that isn't broken. House rule 4 (above) was softened from "never use this pattern" to "verify per function, don't assume either way" to reflect this.

**Verification performed on the unchanged file**: re-ran `python3 scripts/tier_price_logic_dryrun.py` (12/12 pass) and `python3 scripts/quote_line_calc_equivalence_check.py` (11/11 pass) - both unaffected, as expected, since no code changed. Re-confirmed via grep that `fn_sync_to_sheet.deluge` has zero non-ASCII characters, zero ternaries, zero compound `&&`/`||` conditions, and zero chained `ifnull(...) ==` comparisons (these were already fixed in the earlier cleanup pass - see "Files not yet re-verified" section below, which despite its heading already covers this file). No `deploy_ready/fn_sync_to_sheet.creator.deluge` was created, since no rewrite occurred - the file in `functions/` is already exactly what's live in Creator.

**Still open**: `fn_generate_pdf.deluge`, `fn_sync_to_crm.deluge`, and `fn_send_to_sign.deluge` remain untested in this session and still use `Quote_Request[ID == p_quote_id.toLong()]` (a direct function call, the same *form* as `fn_calc_quote_lines`'s original Incident 2 failure, though - per this incident - pattern-matching alone is not a reliable predictor). If any of these three are ever redeployed, verify by attempting the save first; only fall back to the unfiltered-loop-plus-if rewrite if the save actually fails.

---

## Files not yet re-verified against these rules

`fn_sync_to_sheet.deluge`, `fn_calc_line_price_draft.deluge`, and all three `workflows/*.deluge` scripts have now been audited against every house rule above (not just comments/ASCII from the prior pass) and fixed where needed:
- `fn_sync_to_sheet.deluge`: two chained `ifnull(...) == "value"` expressions (house rule 6) decomposed into variable-then-compare form. No ternary or compound boolean was present. (Its `Quote_Request[ID == ...]` criteria was left alone - see Incident 4.)
- `fn_calc_line_price_draft.deluge`: had all four remaining risk patterns — a ternary, a compound `&&`/`||` condition, and a chained `ifnull(...) ==` comparison — fully rewritten to the same conservative style as `fn_calc_quote_lines.deluge`.
- `workflows/on_user_input_quote_lines_part_select.deluge` and `on_user_input_quote_lines_qty.deluge`: compound `&&`/`||` conditions on `Qty`/`Part_Number` checks split into nested `if` blocks with named boolean flags; multi-line headers trimmed to nothing (the single-line commented-out `Discountable`/`Discount` toggle lines were kept as-is — those are intentionally-disabled code, not documentation prose).
- `workflows/on_user_input_quote_currency_fx.deluge`: same compound-condition split as `fn_calc_quote_lines.deluge`'s `apply_fx` logic (identical shared pattern), plus a second compound condition (`apply_fx && fx_rate != 0`) that gated the per-line FX branch.

Verified via `python3 scripts/tier_price_logic_dryrun.py` (12/12) and `python3 scripts/quote_line_calc_equivalence_check.py` (11/11), plus a full-repo grep confirming zero remaining non-ASCII characters, ternaries, compound `&&`/`||` conditions, chained `ifnull(...) ==` comparisons, or function calls inside `[...]` search criteria across all seven `functions/`/`workflows/` files touched by the Tier_Scheme and draft-autofill work.

`fn_get_discount.deluge` still contains a ternary (`p_is_software ? "Software" : "Hardware"`) and some non-ASCII characters, but per `QTS_PROJECT_STATUS.md` this function predates the current session's changes and is presumably already deployed and working — it has not been touched or redeployed in this session, so its existing ternary has not (yet) caused a failure. If `fn_get_discount.deluge` is ever edited and redeployed, apply the same house rules above first rather than assuming its current form is safe simply because it hasn't failed yet.

`fn_generate_pdf.deluge` and `fn_sync_to_crm.deluge` also still contain a handful of em-dashes and (per Incident 4) a still-unverified `Quote_Request[ID == p_quote_id.toLong()]` criteria form each; same reasoning — not touched this session, not redeployed, left as-is.
