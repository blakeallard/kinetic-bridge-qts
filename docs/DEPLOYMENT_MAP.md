# QTS Deployment Map — full paths → paste destinations

**Updated:** 2026-07-31
**Repo root:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations`

Layout rule: `deploy_ready/<platform>/<component>/<file>` — the path tells you where it goes.

---

## 1. Creator → QTS → Workflow tab → Form workflows (CRM_Bridge form)

Open each workflow's single Action and **replace the entire Deluge script**.

| Workflow (in Creator UI) | Paste this file (full path) | Status |
|---|---|---|
| `CRM Bridge - search_customers` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/crm_bridge/search_customers.creator.deluge` | **DEPLOY — has new 3-char guard** |
| `search_leads` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/crm_bridge/search_leads.creator.deluge` | **DEPLOY — has new 3-char guard** |
| `sync_quote_to_crm` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/crm_bridge/sync_quote_to_crm.creator.deluge` | Only if changed since last paste |
| `CRM Bridge` (Disabled, 09-Jul) | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/crm_bridge/DISABLED_monolith_crm_bridge_on_create.creator.deluge` | **DO NOT PASTE / DO NOT RE-ENABLE** — reference only |

Not in repo yet (live-only, no paste needed): `get_customer`, `get_lead`, `create_customer`, `search_deals`, `get_deal`, `create_deal`, `get_quote_lines`, `get_quote_by_number`, `expand_kit`, `get_tax`, `books_diag`.

## 2. Creator → QTS → Workflow tab → Form workflows (Quote_Request form)

| Workflow | Paste this file (full path) |
|---|---|
| Expand Kit button | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/quote_request/expand_kit_button.creator.deluge` |
| On user input — Quote_Lines part select | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/quote_request/on_user_input_quote_lines_part_select.creator.deluge` |
| On user input — Quote_Lines qty | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/quote_request/on_user_input_quote_lines_qty.creator.deluge` |
| On user input — Quote currency FX | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/form_workflows/quote_request/on_user_input_quote_currency_fx.creator.deluge` |

## 3. Creator → QTS → Workflow tab → Functions

| Function | Paste this file (full path) |
|---|---|
| `fn_calc_quote_lines` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` |
| `fn_get_kit_components` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_get_kit_components.creator.deluge` |
| `fn_sync_to_crm` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_sync_to_crm.creator.deluge` |
| `fn_sync_to_sheet` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_sync_to_sheet.creator.deluge` |
| `fn_generate_pdf` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_generate_pdf.creator.deluge` |
| `fn_generate_pdf` (debug variant) | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_generate_pdf.debug.deluge` |
| `fn_calc_line_price_draft` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_calc_line_price_draft.creator.deluge` |
| `fn_get_discount` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_get_discount.creator.deluge` |
| `fn_get_next_number` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_get_next_number.creator.deluge` |
| `fn_get_tier_price` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_get_tier_price.creator.deluge` |
| `fn_refresh_fx_rates` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_refresh_fx_rates.creator.deluge` |
| `fn_send_to_sign` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/functions/fn_send_to_sign.creator.deluge` |

**Schedules** (Workflow → Schedules): `daily_fx_refresh` → `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflow/schedules/daily_fx_refresh.creator.deluge`

**Known gap:** 11 CRM_Bridge action workflows exist only in the live app (no repo copy) — see `deploy_ready/creator/workflow/form_workflows/crm_bridge/LIVE_ONLY_NOT_IN_REPO.md`.

## 4. Zoho Flow → "QTS Saved Draft To Writer" → custom functions

| Flow custom function | Paste this file (full path) | Status |
|---|---|---|
| `publish_quote_package` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge` | **DEPLOY — race loop 10→2 GETs** |
| `advance_deal_stage` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/advance_deal_stage.deluge` | Only if changed |
| `assert_deal_has_products` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/assert_deal_has_products.deluge` | Only if changed |
| `ensure_deal_contact_link` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/ensure_deal_contact_link.deluge` | Only if changed |
| `snapshot_creator_revision` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/snapshot_creator_revision.deluge` | Only if changed |
| `workdrive_archive_to_drafts` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/workdrive_archive_to_drafts.deluge` | Only if changed |
| `workdrive_ensure_quote_folders` | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/workdrive_ensure_quote_folders.deluge` | Only if changed |

Markers `_do_not_paste_for_live_workdrive` and `_inline_only_not_separate_flow_cfs` in that folder still apply.

## 5. Creator → QTS widget (upload)

| What | Full path | Status |
|---|---|---|
| Widget ZIP | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/widget/dist/qts-quote-builder.zip` | **DEPLOY — 3-char client guard + 5-min search cache** (built 2026-07-31 12:57) |

Build source: `widget/app/` (ZIP is build output; not duplicated under deploy_ready).

## 6. Creator → Item_Master report → Import (CSV)

| Use when | Full path |
|---|---|
| Current form (14 cols) | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/imports/item_master_import_CORRECTED.csv` |
| After adding `Active`/`Item_Status`/`Quote_Warning` fields (17 cols) | `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/imports/item_master_import_FULL.csv` |

`Tier_Scheme` must be exactly `Hardware` / `License` (dropdown, case-sensitive).

## 7. CRM (no paste artifacts currently)

No CRM-side scripts in this repo. Related but separate: the local CRM sync burning ~20k credits/day lives in another repo —
`/Users/blakeallard/bevco/repos/kinetic-quote/tools/zoho_crm_sync/` (launchd: `~/Library/LaunchAgents/com.blake.zoho-crm-sync.plist`, every 120 s — recommend raising `StartInterval` to 900+).
