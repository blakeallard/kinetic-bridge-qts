# QTS two-button CRM — external code anchors

Product ownership and execution for this plan live in **BI1-T71**. Some runtime scripts still sit outside this repo until Stage 2 copies or re-homes them.

## Widget (edit here for Stage 1)

| Role | Path |
| ---- | ---- |
| Primary widget app | `/Users/blakeallard/bevco/qts-quote-builder/app/widget.js` |
| Primary widget HTML | `/Users/blakeallard/bevco/qts-quote-builder/app/widget.html` |
| Pack Bay mirror (T71) | `artifacts/qts-widget-ui-packbay/` |
| Widget tests | `/Users/blakeallard/bevco/qts-quote-builder/tests/widget_state_test.js` |

Key symbols today: `requestQuoteDocument`, `syncCrmDeal`, `PACKAGE_STATUS`, `PDF_FILE_STATUS` → collapse into `publishQuotePackage({ email })`.

## Creator sync (T71)

| Role | Path |
| ---- | ---- |
| Sync source | `functions/fn_sync_to_crm.deluge` |
| Deploy paste | `deploy_ready/fn_sync_to_crm.creator.deluge` |
| CRM bridge | `deploy_ready/crm_bridge_on_create.creator.deluge` |

## Flow / PDF / email (external — T110 today)

| Role | Path |
| ---- | ---- |
| Generate + file + email Deluge | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/scripts/generate_and_file_quote_document.deluge` |
| Merge payload builder | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/scripts/build_quote_merge_payload.deluge` |
| Status → Flow mapping | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/docs/PDF_FILE_NO_EMAIL.md` |

T110 hosts these files historically; **do not treat T110 as the QTS product repo**. Prefer copying modular Flow steps into T71 `scripts/` / `deploy_ready/` as Stage 2 lands.

## Cursor plan mirror

Canonical Cursor plan (may lag this doc): `~/.cursor/plans/qts_two-button_crm_c1152a58.plan.md`  
Repo canonical plan: [`QTS_TWO_BUTTON_CRM_PLAN.md`](./QTS_TWO_BUTTON_CRM_PLAN.md)
