# Quote_Lines Line_Number Autofill Plan — BI1-T71

Zoho Task ID: `2543412000001469015`
Created: 2026-07-05
Status: **Not deployed.** All code below is local-only. No Zoho record was read/modified, no Creator UI or workflow was touched, no pricing logic was changed.

---

## What this adds

Today `Line_Number` on `Quote_Lines` is never written by any function (per `docs/QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md`). It has a graceful read-side fallback — `fn_generate_pdf.deluge` substitutes its own local counter if `Line_Number` is blank — but nothing ever populates the field itself, so it stays empty on the actual Creator record.

This plan adds a plain sequential counter to the existing per-line loop in `fn_calc_quote_lines.deluge` so that on every quote save, `Quote_Lines` rows are numbered `1, 2, 3, ...` in their current row order and written back to `line.Line_Number`. That is the entire behavior change — no new field, no new function, no new workflow trigger.

---

## Architecture decision: patched into `fn_calc_quote_lines.deluge`, not a separate helper

Two options were considered before writing any code:

| Option | Why not chosen / chosen |
|---|---|
| **New standalone helper function** (e.g. `fn_assign_line_numbers`) | Rejected. It would need its own invocation point — either a new call added inside `fn_calc_quote_lines.deluge` (extra function-call overhead and an extra deploy artifact for zero behavioral benefit, since the loop already exists exactly where the numbering needs to happen), or a new separate Creator workflow trigger (more moving parts, more deploy risk, no upside). The task's own instruction — "simplest approach: on quote save, number rows" — points directly at the save-time function that already iterates every row. |
| **Patch directly into `fn_calc_quote_lines.deluge`** (chosen) | `fn_calc_quote_lines.deluge` already runs `for each line in quote.Quote_Lines` on every save (the exact trigger this task asks for) and already writes other computed fields back onto each `line` in that same loop (`Unit_Price`, `FX_Unit_Price`, etc.). Adding two lines — a counter increment and a field write — at the top of that existing loop needs no new function, no new deploy artifact, and no new Creator workflow attachment. This is the same "recompute everything fresh on every save" pattern already used for pricing, so numbering and pricing stay consistent with each other by construction (no separate on-user-input path to keep in sync, unlike the still-undeployed draft-autofill plan). |

**Consequence of this choice**: deploying this change means redeploying `fn_calc_quote_lines.deluge` — an already-live function — not creating a new one. See "Does this touch deployed functions" below.

---

## Exact change

Two lines added immediately inside the existing `for each line in quote.Quote_Lines` loop in `functions/fn_calc_quote_lines.deluge`, plus one counter initialized immediately before the loop:

```
line_seq = 0;
for each line in quote.Quote_Lines
{
	line_seq = line_seq + 1;
	line.Line_Number = line_seq;

	qty = line.Qty.toLong();
	...unchanged...
}
```

Nothing below that point in the loop body was touched. No pricing variable (`qty`, `part`, `eur_price`, `discount`, `markup`, `unit_price_usd`, FX fields, etc.) is read or written by these two new lines, and `line_seq` is not read anywhere else in the function.

- **`deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge`** was updated identically, keeping it byte-for-byte identical to `functions/fn_calc_quote_lines.deluge`, per the existing convention recorded in `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` (Incident 2).

---

## Creator parser-safety check (per `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md`)

| House rule | Result |
|---|---|
| No large comment blocks in the function body | No comment added. |
| ASCII only | Confirmed via `grep -noP '[^\x00-\x7F]'` — zero matches (unchanged from before this patch). |
| No ternary expressions | None added. |
| `Quote_Request[ID == ...]` criteria | Untouched — this patch is entirely inside the already-working unfiltered-loop-plus-if body from Incident 3; the criteria line itself was not touched. |
| No compound boolean conditions | None added — `line_seq = line_seq + 1;` and `line.Line_Number = line_seq;` are both single, unconditional statements. |
| No chained function-call-into-comparison | None added. |
| Arithmetic kept to single operations per line | `line_seq + 1` is one operation, matching the existing style used elsewhere in this same function (e.g. `next_seq = ifnull(rec.Last_Sequence,0) + 1;` in `fn_get_next_number.deluge`). |

No new risk pattern was introduced by this patch.

---

## Why this does not touch pricing logic

The two added lines execute before any pricing variable in the loop is read (`qty`, `part`, `eur_price`, etc. are all computed on the lines immediately after). `line_seq` is a new, single-purpose local variable never referenced by any pricing expression. The existing `python3 scripts/quote_line_calc_equivalence_check.py` fixture (pricing math only, unaffected by row-position bookkeeping) was re-run against the current file state and still passes 11/11 — see Verification below.

---

## Files changed / added

| File | Change |
|---|---|
| `functions/fn_calc_quote_lines.deluge` | Patched: added `line_seq` counter + `line.Line_Number` write, as shown above. |
| `deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` | Same patch applied, kept byte-identical to `functions/fn_calc_quote_lines.deluge` per existing convention. |
| `scripts/line_number_autofill_check.py` | New. Local dry-run of the numbering behavior (no Deluge interpreter exists locally, so this is a faithful reimplementation of just the counter logic, run against synthetic line lists). |
| `docs/LINE_NUMBER_AUTOFILL_PLAN.md` | New. This file. |

No field was added or removed. `Line_Number` already exists as a field on the live `Quote_Lines` subform per `docs/QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md` (it is `fn_generate_pdf.deluge`'s existing fallback target) — this plan only adds a writer for it.

---

## Verification performed (local only, no Zoho contact)

1. `python3 scripts/line_number_autofill_check.py` — 6 scenarios, 6/6 pass: plain sequential numbering, stale/out-of-order pre-existing values getting overwritten, single-line quotes, zero-line (empty subform) quotes, blank/incomplete draft rows still getting numbered, and a simulated mid-quote row deletion proving numbering is gap-free and recomputed fresh every save (not preserved from a prior save).
2. `python3 scripts/tier_price_logic_dryrun.py` — re-run, 12/12 pass, unaffected (this patch does not touch `fn_get_tier_price.deluge` or anything it depends on).
3. `python3 scripts/quote_line_calc_equivalence_check.py` — re-run, 11/11 pass, unaffected (pricing math fixture, proves the patch introduced no pricing regression).
4. `diff functions/fn_calc_quote_lines.deluge deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` — identical.
5. `grep -noP '[^\x00-\x7F]' functions/fn_calc_quote_lines.deluge` — zero matches (ASCII-only preserved).

---

## Deployment notes (not performed — for when a human approves deployment)

1. **This redeploys an already-live function.** `fn_calc_quote_lines.deluge` is the same function documented as deployed and working in `QTS_PROJECT_STATUS.md` (Tier_Scheme pricing patch). Deploying this change means pasting the updated `functions/fn_calc_quote_lines.deluge` (or `deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` — identical) over the current live version in Creator dev, replacing it in place. This is not a new function creation.
2. **Attempt the save first; do not preemptively rewrite.** Per Incident 4 in `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md`, pattern-matching against past "Improper Statement" failures is not a reliable predictor — the file already passed Creator's parser once with this same structural style (unfiltered `Quote_Request` loop, decomposed arithmetic, no ternaries/compound conditions). Paste and attempt to save as-is; only fall back to further rewrites if Creator actually rejects it.
3. **Test order once deployed** (mirrors the existing autofill plan's test-case structure):
   - Save a quote with 3+ line items; confirm `Line_Number` populates as `1, 2, 3, ...` in row order.
   - Delete a middle line item and re-save; confirm the remaining rows renumber with no gap (e.g. a 4-line quote losing row 3 becomes `1, 2, 3`, not `1, 2, 4`).
   - Re-save an existing quote created before this deployment; confirm its previously-blank `Line_Number` values populate on the next save with no other field changing.
   - Generate a PDF (`fn_generate_pdf.deluge`) for a multi-line quote and confirm the `Line_Number` values used in the PDF now come from the real field instead of `fn_generate_pdf`'s local fallback counter — output should be identical either way (this is confirming the fallback is no longer needed, not that behavior changed).
4. **No workflow/UI change required.** The existing Creator workflow rule ("Quote Auto Number and Recalc," per `QTS_PROJECT_STATUS.md`) already calls `fn_calc_quote_lines` on every save — no new trigger needs to be attached.
5. **Rollback**: revert `fn_calc_quote_lines.deluge` in Creator to the pre-patch version (the file state before this plan, still in git history at commit `04fcecf`). No data migration is implied — `Line_Number` simply stops being written on the next save; existing values already written by this patch are not retroactively cleared, but are also harmless if left in place (the field was designed to be safely blank per `fn_generate_pdf.deluge`'s existing fallback).

---

## Confirm before deploying

None. Unlike the draft-autofill plan (`docs/QUOTE_LINES_AUTOFILL_WORKFLOW_PLAN.md`), this change does not depend on any unconfirmed live-Creator field (`Line_Number` is already confirmed to exist, per the field dependency audit) and does not touch `Status`, `Discountable`, or `Discount`. The only open item is the standard one for any redeploy of this function: attempt the Creator save and confirm it's accepted, per Deployment note 2 above.
