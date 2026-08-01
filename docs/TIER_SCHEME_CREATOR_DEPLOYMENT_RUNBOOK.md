# Tier_Scheme Creator Deployment Runbook — BI1-T71

**Deployment history note (added after the first live deploy attempt, updated after the second and third):** the original `functions/fn_get_tier_price.deluge` had a large comment header using non-ASCII em-dashes, which failed to save in Creator with "Improper Statement." `functions/fn_calc_quote_lines.deluge` then failed the same way twice: first for a ternary, compound boolean conditions, and a function call inside `Quote_Request[...]` search criteria; after fixing those, it failed a *second* time even with a pre-computed plain variable inside `Quote_Request[ID == quote_id_long]`. The final fix removes search criteria from `Quote_Request` entirely and loops over every record with an `if(quote.ID == quote_id_long)` check inside instead - a change specific to `Quote_Request`, not a general rule (`Item_Master`/`FX_Rates_Cache` criteria with plain variables are unaffected). All functions touched by this work are now audited against a common set of Creator parser-safety house rules. Full incident details and the house rules themselves: `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md`. A ready-to-paste mirror of the fixed `fn_calc_quote_lines.deluge` also lives at `deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge`.

Zoho Task ID: `2543412000001469015`
Created: 2026-07-03
Local patch commit: `a3ab89c` ("Implement local Tier Scheme pricing patch")
Status: **Deployed.** `Tier_Scheme` field, `fn_get_tier_price.deluge` (simplified version, per `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` Incident 1), `fn_calc_quote_lines.deluge` (unfiltered-loop-plus-if version, Incident 3), and `fn_sync_to_sheet.deluge` (deployed unchanged, still using filtered `Quote_Request[ID == ...]` criteria - see Incident 4, this pattern was *not* found to be unsafe for this function) are all live in the dev environment (done manually by a human). No step in this runbook has been performed by an agent; all Zoho changes so far were done manually.

---

## 1. Current local patch summary

Commit `a3ab89c` (on top of `42ef50e` audit, `effbf8a` readiness classifications, `8b88075` LiBal QC reports) changed, locally only:

| File | Change |
|---|---|
| `functions/fn_get_tier_price.deluge` | Reads `Item_Master.Tier_Scheme`; branches to a 9-band (hardware) or 6-band (license) qty→tier-index table; defaults to hardware if the field is blank/unknown; returns `-1` (never a real price) instead of `0` when no valid tier price exists. Signature unchanged: `float fn_get_tier_price(string p_part_number, int p_qty)`. |
| `functions/fn_calc_quote_lines.deluge` | Guards against the `-1` sentinel (resets to `0` before cost math) and prepends `"[NO PRICE ON FILE - DO NOT QUOTE] "` to `line.Description` when no valid price was found. |
| `functions/fn_sync_to_sheet.deluge` | Same `-1` sentinel guard on its independently-computed `usd_cost_unit`/`Line_Cost_USD`/`Gross_Margin_USD`; does not re-add the Description marker (inherited from `fn_calc_quote_lines`, which always runs first). |
| `docs/TIER_SCHEME_DEPLOYMENT_CHECKLIST.md` | Prior checklist — this runbook supersedes it with exact UI steps; the checklist's business-approval and risk framing still applies. |
| `scripts/tier_price_logic_dryrun.py` | Local Python reimplementation of the patched algorithm, run against `import_preview/item_master_import_preview.csv`; 12/12 checks pass (`python3 scripts/tier_price_logic_dryrun.py`, exit 0). No Deluge interpreter exists locally, so this is the only pre-deployment verification available. |

No other function was touched (`fn_get_discount.deluge`, `fn_sync_to_crm.deluge`, `fn_generate_pdf.deluge`, `fn_refresh_fx_rates.deluge`, `fn_send_to_sign.deluge`, `fn_get_next_number.deluge` are all unmodified and don't call `fn_get_tier_price`).

---

## 2. Exact Creator app/environment target

| Setting | Value |
|---|---|
| App | `qts` |
| Workspace | `bevcollc` |
| Environment | **development** (per `QTS_PROJECT_STATUS.md` — "App currently lives in development environment") |
| Form to modify | `Item_Master` |
| Functions to redeploy | `fn_get_tier_price`, `fn_calc_quote_lines`, `fn_sync_to_sheet` |

Do not target production. Per `QTS_PROJECT_STATUS.md`, production promotion is a separate, later step ("Production Environment Promotion" is listed as still-needed, low-priority work) and is out of scope here.

---

## 3. Required Creator schema change

| Property | Value |
|---|---|
| Form | `Item_Master` |
| Field display name | `Tier_Scheme` |
| Recommended field type | **Dropdown / picklist** (not Single Line) — constrains input to the two valid values so a typo can't silently fall through to the "unknown → default hardware" path undetected. |
| Recommended choices | `hardware`, `license` — **exact strings**, matching what the already-committed `functions/fn_get_tier_price.deluge` compares against (case-insensitively — the function lowercases before comparing) and what `import_preview/item_master_import_preview.csv`'s `Tier_Scheme` column already contains. `hardware` = hardware 9-band pricing (BMS boards + Accessories); `license` = software/license/service 6-band pricing (Creator Tool, Service Tool, obsolete software). |
| Required? | **No — must remain optional/not-required.** The patched `fn_get_tier_price.deluge` explicitly treats blank/missing `Tier_Scheme` as "default to hardware," which is the intentional backward-compatibility path for any `Item_Master` rows that predate this field. Making it required would be safer long-term but must not be turned on until every existing row has been given a value — turn it required only as a later hardening step, never in this same change. |
| Default/backward-compatible behavior if blank | Treated as `hardware` (9-band) by `fn_get_tier_price.deluge`. This matches 100% of Creator's currently deployed behavior (single universal 9-band mapping) — no existing quote or Item_Master row changes behavior from this deployment alone. |

**Value consistency confirmed.** An earlier draft of this runbook proposed `hardware_9_band`/`license_6_band` as the Creator-facing dropdown choices, which did not match the strings the committed `fn_get_tier_price.deluge` compares against (`"hardware"`/`"license"`). That mismatch has been resolved: this runbook, the Deluge patch, `import_preview/generate_preview.py`, and the generated `import_preview/item_master_import_preview.csv` all now consistently use the short-form values `hardware` and `license` — verified directly against the CSV (`python3 -c "import csv; ..."` over the `Tier_Scheme` column returns exactly `{'hardware', 'license'}`, no other values present). No code change was needed in `generate_preview.py` or the CSV — they already emitted the correct values; only this runbook's proposed Creator choices needed correcting.

---

## 4. Exact deployment order

1. ~~Add/confirm the `Tier_Scheme` field on `Item_Master` (Section 6).~~ **Done.**
2. ~~Deploy `fn_get_tier_price.deluge` (Section 7, step A).~~ **Done** — deployed and saved successfully in the dev environment using the simplified, ASCII-only version now committed in this repo (see the deployment history note at the top of this file).
3. ~~Deploy `fn_calc_quote_lines.deluge` (Section 7, step B).~~ **Done** — required the unfiltered-loop-plus-if rewrite (`docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` Incident 3) before it would save.
4. ~~Deploy `fn_sync_to_sheet.deluge` (Section 7, step C).~~ **Done** — deployed unchanged; its filtered `Quote_Request[ID == ...]` criteria saved successfully, contradicting the assumption that this pattern is universally broken (see Incident 4).

All three functions in this runbook's scope are now deployed. Remaining work is the business-decision blockers in Section 11, not further deployment steps.

---

## 5. Why deploying functions before the field exists would break

The patched `fn_get_tier_price.deluge` reads `item.Tier_Scheme` inside its `Item_Master` lookup. Zoho Creator's Deluge engine resolves field references against the form's schema at save/execution time — referencing a field name that does not exist on the `Item_Master` form is a hard compile/runtime error, not a silent `null`. If `fn_get_tier_price` is deployed before the field exists, **every** call to it (i.e., every quote line-item save, since `fn_calc_quote_lines` calls it on every save) would fail, breaking quote pricing entirely across the whole `qts` app until either the field is added or the function is rolled back. This is the single most important ordering constraint in this runbook.

---

## 6. Exact manual Creator UI steps for adding the field

1. Log in to Zoho Creator, open workspace `bevcollc`, app `qts`, environment **development**.
2. Go to **Forms** → open `Item_Master`.
3. Click **Add Field** (or drag a new field from the field palette onto the form layout).
4. Set **Field Type** = `Dropdown`.
5. Set **Field Name / Display Name** = `Tier_Scheme`.
6. Under **Choices**, add exactly two values, matching the committed Deluge patch and import preview CSV: `hardware`, `license`.
7. Leave **"Mandatory field"** / **Required** = **unchecked** (per Section 3 — must stay optional for backward compatibility).
8. Do **not** set a default value in the field's Creator configuration — leaving it genuinely blank for un-classified rows is the intended state; the Deluge function (not the field's own default) supplies the hardware fallback.
9. Save the form.
10. Confirm the field appears on the `Item_Master` form layout (add it to the layout view if Creator doesn't do so automatically — some Creator field-add flows only add to the schema, not the visible layout).
11. Open any existing test/demo `Item_Master` record (if one exists in the dev environment) and confirm the new `Tier_Scheme` field shows blank and does not block saving the record.

---

## 7. Exact manual Creator UI steps for updating each function

For all three steps below: **Workspace → Settings → Workflow / Deluge → Custom Functions**, or via the app's **Deluge Script Editor** (path depends on Creator's current UI version — look for "Custom Functions" or "Functions" under the app's Setup/Workflow menu).

### Step A — `fn_get_tier_price`
1. Open the existing `fn_get_tier_price` custom function in the Deluge editor.
2. Replace its entire body with the contents of `functions/fn_get_tier_price.deluge` from this repo at commit `a3ab89c`.
3. Click **Validate/Check Syntax** (Creator's built-in Deluge validator) before saving.
4. Save/Publish the function.
5. Run the validation checklist in Section 8 immediately — do not proceed to Step B until it passes.

### Step B — `fn_calc_quote_lines`
1. Open the existing `fn_calc_quote_lines` custom function.
2. Replace its entire body with the contents of `functions/fn_calc_quote_lines.deluge` from this repo at commit `a3ab89c`.
3. Validate syntax, save/publish.
4. Run the validation checklist in Section 8.

### Step C — `fn_sync_to_sheet`
1. Open the existing `fn_sync_to_sheet` custom function.
2. Replace its entire body with the contents of `functions/fn_sync_to_sheet.deluge` from this repo at commit `a3ab89c`.
3. Validate syntax, save/publish.
4. Run the validation checklist in Section 8.

---

## 8. Copy/paste validation checklist (run after each function update)

```
[ ] Deluge syntax validator shows no errors before save
[ ] Function saved/published without error
[ ] Existing hardware-tier test quote (if one exists, e.g. TEST-QUOTE0001) still recalculates
    without error when opened/re-saved
[ ] Unit_Price / Line_Total_USD on that existing quote's hardware lines are UNCHANGED
    from their pre-deployment values
[ ] No error banner / Deluge execution error shown in Creator after save
[ ] Creator's execution log (Setup > Logs, or the function's own execution history)
    shows no unhandled exception for the save that just occurred
```

If any box fails, stop and do not proceed to the next function — go to Section 10 (Rollback).

---

## 9. Test cases

Run these in the **development** environment only, after all three functions are deployed (Section 4 fully complete):

1. **Hardware item, 9-band pricing** — Create or edit a quote line using an existing hardware SKU (e.g. `100800`) with `Tier_Scheme` left blank on `Item_Master` (or explicitly set to the hardware choice per Section 3). Confirm `Unit_Price` matches the same value it would have produced before this deployment (e.g. at qty=1, EUR list price 506.00 before FX/discount/markup).
2. **Software/license item, 6-band pricing** — This requires at least one `Item_Master` test row with `Tier_Scheme` set to the license choice and populated `Price_T1..T6` (e.g. values matching SKU `200500` in `import_preview/item_master_import_preview.csv`: 1700/1275/1105/850/595/425). Create a quote line at **qty=10** and confirm the line prices off **595.00 EUR (T5, the `10-24` band)** — not 1700.00 EUR (T1). This is the single most important test in this runbook; it's the exact regression this patch fixes (quantified in `docs/TIER_SCHEME_LINE_ITEM_FUNCTIONALITY_AUDIT.md` as a 2.86x overcharge under the old code).
3. **Unpriced SKU shows the no-price guard** — Create a quote line using a SKU with no populated `Price_T*` values (or a `Part_Number` with no matching `Item_Master` row at all, to also test the "SKU not found" path). Confirm: `Unit_Price = 0.00`, and `Description` begins with `[NO PRICE ON FILE - DO NOT QUOTE]`. Confirm this marker is visible in the Creator subform view, in the Sheet sync's `Quote_Lines` tab `Product_Description` column, and in the Writer PDF merge output if the quote is advanced to `Send for Signature`.
4. **Duplicate SKU should not be imported twice** — This test is a *precondition check*, not a pricing test: before any `Item_Master` import runs, confirm the import source data (once Bill/Bryan's decision from Section 11 is applied) contains only **one** row for `Part_Number 300300` and only **one** row for `Part_Number 300500` — i.e., confirm the `EXCLUDE_CANDIDATE` bundle rows were dropped and only the `CANONICAL_CANDIDATE` unit-price rows remain in whatever file/process performs the actual import. The deployed Deluge patch does not enforce this (see Section 11) — it must be enforced by the import step itself.
5. **Existing quote path still calculates correctly** — Open the most recent real or demo quote in the dev environment (e.g. `TEST-QUOTE0001` per `QTS_PROJECT_STATUS.md`), re-save it (triggering `fn_calc_quote_lines` → `fn_sync_to_sheet` → `fn_sync_to_crm` → `fn_generate_pdf` if applicable), and confirm: all previously-correct line totals, quote totals, CRM Deal Amount, and Sheet tab values are unchanged from before this deployment. This is the full end-to-end non-regression check.

---

## 10. Rollback plan

**Reverting a function**: the prior version of each function is preserved in this repo's git history. To roll back:
```
git show effbf8a:functions/fn_get_tier_price.deluge      # pre-Tier_Scheme version
git show effbf8a:functions/fn_calc_quote_lines.deluge    # pre-Tier_Scheme version
git show effbf8a:functions/fn_sync_to_sheet.deluge       # pre-Tier_Scheme version
```
Copy that prior version's body back into the corresponding Creator custom function and re-save/publish, in the **reverse** of the deployment order (undo `fn_sync_to_sheet` first, then `fn_calc_quote_lines`, then `fn_get_tier_price` last) — since the callers depend on the callee's contract, rolling back the callee first would leave callers expecting a `-1` sentinel that an old, reverted `fn_get_tier_price` would no longer produce (it would go back to returning `0` for both "no price" and "not found," which the old callers already handled — so this direction is safe; the *other* direction, rolling back callers while the new `fn_get_tier_price` is still live, is what must be avoided, hence reverse order).

**Handling the additive `Tier_Scheme` field if rollback is needed**: the field is purely additive and read only by the new `fn_get_tier_price.deluge`. If all three functions are rolled back to their pre-patch versions, the `Tier_Scheme` field can be safely left in place on `Item_Master` (unused by the reverted functions, harmless) rather than removed — removing a field is a more disruptive, less reversible action than leaving an unused one, and there is no reason to delete it unless the business decides `Tier_Scheme` itself is being abandoned as an approach.

---

## 11. Open blockers before actual Item_Master import

These items remain relevant after the local patch. Only the duplicate-SKU assumption and SKU `101815` still require Bill/Bryan approval decisions; vendor-discontinued SKUs are documented as excluded unless explicitly overridden, per `STATUS.md` and the prior QC/audit docs:

- [ ] **Duplicate SKUs 300300/300500 final decision** — which row (unit-price `CANONICAL_CANDIDATE` vs bundle-style `EXCLUDE_CANDIDATE`) is actually imported. See `docs/LIBAL_REFERENCE_PRICE_QC.md`.
  Current working assumption only: hidden RSP_EUR rows 54/55 are legacy `EXCLUDE_CANDIDATE` rows and visible rows 58/60 are current `CANONICAL_CANDIDATE` rows, per `import_preview/duplicate_sku_classification.json`. Pending Bill/Bryan confirmation; not approved.
- [ ] **SKU 101815 (unpriced / New Item added / DRAFT)** — import as blocked/non-quotable placeholder, exclude entirely, or request updated vendor pricing first. **New evidence (2026-07-06, `audit/classify_status_marks.py` — SQLite classifier decoding the RSP_EUR row-1 fill-color legend, output in `audit/reports/status_marks.csv`):** `101815` is marked New Item added with a "…DRAFT" description and literal "Not priced" cells. This remains the only true unpriced/new/DRAFT decision pending Bill/Bryan.
- Vendor-marked discontinued SKUs `102100`, `103005`, `200400`, and `300400` are documented as **excluded from live import/quoting by vendor discontinued status**. Bill/Bryan visibility/override only; approval is not required to keep them excluded. Caveat: the classifier's yellow "Delivery STOP" hits on `Changes_Log` are likely color reuse as a batch highlight and must not be treated as delivery-stop proof without eyeballing the sheet.
- [ ] **Partner exposure as `Customer_Type`** — whether `Partner` becomes a selectable value on live quotes (discount rules for it already exist in `fn_get_discount.deluge`, but exposing it on the form is a separate approval).
- [ ] **Inquiry_Type / Quote_Type** — no such field exists in any deployed function today; needed to satisfy the original task's "route inquiries by type (BMS vs battery products)" requirement, separate from the pricing-tier `Customer_Type` field.
- [x] **DKK FX support** — `fn_refresh_fx_rates.deluge` already caches DKK (with EUR/GBP/CAD/AUD/JPY/CNY/KRW). Schedule that function daily (Bryan backlog Stage 9) so the cache stays fresh.

---

## 12. Clear final answer

- **Is Creator ready for field addition (Section 6)?** **Done.** `Tier_Scheme` is live on `Item_Master` in dev.
- **Is Creator ready for function deployment (Section 7)?** **Done.** `fn_get_tier_price.deluge`, `fn_calc_quote_lines.deluge`, and `fn_sync_to_sheet.deluge` are all deployed and saved successfully in dev — see the deployment history note at the top of this file and `docs/CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md` for the parser-compatibility fixes two of the three needed along the way.
- **Is Creator ready for `Item_Master` import?** **No.** All five items in Section 11 remain open business decisions, and the duplicate-SKU risk (Section 9, test 4) is not mitigated by the code patch itself — it must be enforced by whatever process performs the import. Import should not proceed until Section 11 is fully resolved, regardless of whether the field/function deployment above has happened.

---

## 13. Post-deployment data fix — blank Tier_Scheme on existing dev records (2026-07-06)

**Symptom.** After the Line_Number deployment, an all-items dev test quote priced SKU 200300
(c-BMS24X Unified Creator License) at qty 23 with `Unit_Price` 1448.86 — exactly EUR 1275
(`Price_T2`, the *hardware* 20–99 band) x 1.136364, instead of EUR 595 (`Price_T5`, the
license 10–24 band). A 2.14x overcharge on that line.

**Cause.** The `Tier_Scheme` field existed on `Item_Master`, but all 28 existing dev records
had it **blank** (confirmed by read-only API enumeration on 2026-07-06 — no record carried a
`Tier_Scheme` value). Blank `Tier_Scheme` intentionally defaults to hardware pricing in
`fn_get_tier_price.deluge` (the backward-compatibility path, Section 6 of this runbook), so
every license SKU silently priced off the hardware band table. **This was a data gap, not a
code bug** — the deployed functions behaved exactly as specified.

**Fix applied (Creator dev, manual, human-performed).** `Tier_Scheme = license` was set on
the 5 confirmed license SKUs: **200100, 200200, 200300, 200500, 200600**. No code was
changed, locally or in Creator. All hardware/accessory rows were deliberately left blank
(the hardware default is correct for them).

**Verification.** The all-items test quote was re-saved: 200300 at qty 22 now shows
`Unit_Price` 676.14 and `Line_Total_USD` 14875.00 — matching the expected raw unit price
595 x 1.136364 = 676.136364, with the line total computed from the raw (unrounded) unit
price x qty and rounded once (676.136364 x 22 = 14875.00 exactly). Hardware lines
(100684, 100925) were unaffected.

**Still open.**
- [ ] **200999** ("Reactivation fee - Creator License FULL") was intentionally left with
  blank `Tier_Scheme` (currently pricing as hardware). Its part number appears in no
  import-preview CSV row, and its price ladder (135/101.25/87.75/67.50/47.25/33.75) matches
  neither CSV reactivation SKU (`200001` at 700/525/... nor `100699.99` at 135/101.25/87.75).
  Pending Bill/Bryan confirmation of its identity, pricing, and scheme.
- [ ] Any future `Item_Master` import must populate `Tier_Scheme` on every row (the
  import-preview CSV already carries the column) so this gap does not recur at import time.
