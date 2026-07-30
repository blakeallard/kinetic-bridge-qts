# QTS two-button CRM — external code anchors

Product ownership and execution for this plan live in **BI1-T71**.

## Widget (Stage 1 — done)

| Role | Path |
| ---- | ---- |
| Primary widget app | `/Users/blakeallard/bevco/qts-quote-builder/app/widget.js` |
| Primary widget HTML | `/Users/blakeallard/bevco/qts-quote-builder/app/widget.html` |
| Pack Bay mirror (T71) | `artifacts/qts-widget-ui-packbay/` |
| Widget tests | `/Users/blakeallard/bevco/qts-quote-builder/tests/widget_state_test.js` |

Key symbol: `publishQuotePackage({ email })` — Deal sync first, then Status `PDF Filed` / `Package Requested`.

## Modular Flow / Deluge (T71 — canonical)

| Role | Path |
| ---- | ---- |
| Module directory | `scripts/qts_publish/` |
| Thin orchestrator | `scripts/qts_publish/publish_quote_package.deluge` |
| Compat monolith (send_email gated) | `scripts/qts_publish/generate_and_file_quote_document.COMPAT.deluge` |
| Module README | `scripts/qts_publish/README.md` |

## Creator sync (T71)

| Role | Path |
| ---- | ---- |
| Sync source | `functions/fn_sync_to_crm.deluge` |
| Deploy paste | `deploy_ready/fn_sync_to_crm.creator.deluge` |
| CRM bridge | `deploy_ready/crm_bridge_on_create.creator.deluge` |

## External (T110 — keep in sync until Flow rewired)

| Role | Path |
| ---- | ---- |
| Live Flow function (gated copy) | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/scripts/generate_and_file_quote_document.deluge` |
| Status → Flow mapping | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/docs/PDF_FILE_NO_EMAIL.md` |
| Merge payload builder | `/Users/blakeallard/bevco/repos/bi1-t110-design-and-implement-ai-email-intelligence-workflow/scripts/build_quote_merge_payload.deluge` |

**Copy path:** After editing T71 modules, re-paste into Zoho Flow. Until then, T110 COMPAT gating (Quotes only when `send_email`) is the live safety net for Save.

## Docs

| Doc | Path |
| --- | ---- |
| Plan + SPEC_LOCK | `docs/QTS_TWO_BUTTON_CRM_PLAN.md` |
| Creator revision fields | `docs/QTS_TWO_BUTTON_CRM_CREATOR_REVISION.md` |
| E2E / verify checklist | `docs/QTS_TWO_BUTTON_CRM_VERIFY.md` |

## Cursor plan mirror

Do not edit: `~/.cursor/plans/qts_two-button_crm_c1152a58.plan.md`  
Repo canonical: [`QTS_TWO_BUTTON_CRM_PLAN.md`](./QTS_TWO_BUTTON_CRM_PLAN.md)
