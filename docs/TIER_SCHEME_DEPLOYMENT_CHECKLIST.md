# Tier_Scheme Deployment Checklist — BI1-T71

Zoho Task ID: `2543412000001469015`
Created: 2026-07-03
Status: **Not started.** Nothing in this checklist has been done in Zoho. This document exists so the local patch described in `docs/TIER_SCHEME_LINE_ITEM_FUNCTIONALITY_AUDIT.md` can be deployed correctly and in the right order, once approved.

Local code changes this checklist assumes are already made (see the audit's "Implementation notes" section):
- `functions/fn_get_tier_price.deluge` — Tier_Scheme-aware, `-1` no-price sentinel
- `functions/fn_calc_quote_lines.deluge` — sentinel guard + Description marker
- `functions/fn_sync_to_sheet.deluge` — sentinel guard

---

## 0. Business approvals required before any of this proceeds

- [ ] Bill/Bryan confirm `Tier_Scheme` (hardware=9-band / license=6-band) as the correct pricing model — see `docs/TIER_SCHEME_LINE_ITEM_FUNCTIONALITY_AUDIT.md`.
- [ ] Bill/Bryan confirm the 300300/300500 duplicate-SKU resolution — see `docs/AcmeBMS_REFERENCE_PRICE_QC.md`.

Do not proceed past this point without both.

## 1. Creator schema change — required BEFORE deploying the patched function

- [ ] Add `Tier_Scheme` field to the `Item_Master` form in Zoho Creator. Single Line or Dropdown; values `hardware` / `license` (must match exactly what `fn_get_tier_price.deluge` compares against, case-insensitively — the function lowercases before comparing, so `Hardware`/`HARDWARE`/`hardware` all work, but the stored value must not be e.g. `hw` or `Hardware Tier`).
- [ ] **Ordering matters**: this field must exist in Creator *before* the patched `fn_get_tier_price.deluge` is deployed. Deluge in Zoho Creator errors on a reference to a field that doesn't exist on the form — `item.Tier_Scheme` in the patched function will fail to compile/execute if the field isn't there yet. Do not deploy the function first.
- [ ] Confirm existing `Item_Master` rows (if any test/demo rows already exist in the dev environment) either have `Tier_Scheme` populated or are acceptable to default to `hardware` (the function's backward-compatible fallback) until corrected.

## 2. Deploy the patched Deluge functions

- [ ] Deploy `fn_get_tier_price.deluge` (only after step 1 is done).
- [ ] Deploy `fn_calc_quote_lines.deluge`.
- [ ] Deploy `fn_sync_to_sheet.deluge`.
- [ ] Redeploy in this order only — `fn_get_tier_price` first (it's the callee), then the two callers, so there's never a window where a caller expects the new `-1` contract from an old, not-yet-deployed version of `fn_get_tier_price` that still returns `0`.

## 3. Duplicate-SKU risk — resolve before import, not after

- [ ] Per the business decision in step 0, ensure only ONE row per `Part_Number` is present when `Item_Master` is imported. The patched code does **not** filter duplicates (see audit — no `Active`/`Status` field exists yet, and none was invented). If both a `CANONICAL_CANDIDATE` and `EXCLUDE_CANDIDATE` row (e.g. for 300300/300500) get imported under the same `Part_Number`, pricing becomes nondeterministic (first-match-wins, order unspecified).
- [ ] **Recommended, optional hardening** (not required if duplicates are fully resolved pre-import): add an `Active`/`Status` field to `Item_Master` and update the three lookup sites (`fn_get_tier_price.deluge`, `fn_calc_quote_lines.deluge`'s Discountable/Category loop, `fn_sync_to_sheet.deluge`'s Discountable/Category loop) to filter on it. This is a larger, separate change — track it as its own follow-up task if the business wants defense-in-depth beyond "just don't import duplicates."

## 4. Unpriced-SKU handling — current state and optional follow-up

- [ ] Confirm Bill/Bryan's decision on the 5 `BLOCKED_NO_PRICE` SKUs (101815, 102100, 103005, 200400, 300400) before they can be added to any live quote — the patched code will price them at `Unit_Price=0.00` with `Description` prefixed `[NO PRICE ON FILE - DO NOT QUOTE]`, which is visible but does not prevent the quote from being sent.
- [ ] **Recommended, optional follow-up**: add a dedicated field to `Quote_Lines` (e.g. a `Pricing_Error` checkbox or a `Price_Status` dropdown) so a structured flag — not just a text-description marker — can drive a Creator validation rule that blocks `Status` from advancing past `Draft`/`In Review` while any line has no valid price. This was intentionally not implemented in the current patch (would require inventing new `Quote_Lines` schema, out of scope for a same-day Deluge-only patch) but is the more robust long-term fix.

## 5. Test plan before promoting to production

Extend the controlled test quote from the earlier BI1-T71 deployment-readiness review to specifically prove this patch:

- [ ] One hardware-tier line (existing SKU, e.g. 100800) at a qty that exercises the fallback-to-lower-tier path (e.g. qty=20000) — confirm price unchanged from pre-patch behavior.
- [ ] One license-tier line (e.g. 200500, once `Tier_Scheme` is populated) at qty=10 — confirm `Unit_Price` derives from the 595.00 EUR list price (T5, `10-24` band), not the 1700.00 EUR (T1) the old code would have used. This is the single most important regression check.
- [ ] One license-tier line at qty=30 — confirm derives from 425.00 EUR (T6, `25-249` band), not 1275.00 EUR (T2).
- [ ] One line using a currently-unpriced SKU (once test data allows) — confirm `Unit_Price=0.00` AND `Description` starts with `[NO PRICE ON FILE - DO NOT QUOTE]`, both in Creator and in the generated Writer PDF merge output.
- [ ] Confirm `fn_sync_to_sheet`'s `Quote_Lines` tab shows the same `Unit_Cost_USD`/`Gross_Margin_USD` values as before for existing hardware SKUs (i.e., the added guard didn't change any currently-working numbers).
- [ ] Re-run `python3 scripts/tier_price_logic_dryrun.py` locally any time `import_preview/item_master_import_preview.csv` is regenerated, to catch any future data change that would break these assumptions before touching Zoho.

## 6. Rollback

- [ ] If any issue is found post-deploy, the previous versions of the three functions are recoverable from this repo's git history (`git log -- functions/fn_get_tier_price.deluge functions/fn_calc_quote_lines.deluge functions/fn_sync_to_sheet.deluge`) — redeploy the prior commit's function bodies to revert.
