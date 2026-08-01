# QTS Creator — form workflows & functions inventory

Date: 2026-07-29  
Source: T71 repo + live screenshot (CRM_Bridge workflows list, 2026-07-29).

## Architecture (CRM_Bridge)

```
Widget
  → addRecords(CRM_Bridge, { Action_field, Query_Text, Payload_JSON })
  → Form workflow(s) on CRM_Bridge Created
  → Result_jSON + Request_Status
  → widget reads CRM_Bridge_Report
```

Originally one monolith workflow **CRM Bridge**. Live is **split: one workflow per Action_field**.

---

## Live CRM_Bridge form workflows (Successful form submission)

| Workflow name (live UI) | Status | Created | Action_field | Repo paste target |
| ----------------------- | ------ | ------- | ------------ | ----------------- |
| **CRM Bridge** | **Disabled** | 09-Jul-2026 | (old monolith — leave off) | Do not paste unless consolidating |
| CRM Bridge - search_customers | Enabled | 28-Jul-2026 | `search_customers` | `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_customers.creator.deluge` |
| search_leads | Enabled | 28-Jul-2026 | `search_leads` | `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_leads.creator.deluge` |
| get_customer | Enabled | 28-Jul-2026 | `get_customer` | block in `crm_bridge_on_create.creator.deluge` |
| get_lead | Enabled | 28-Jul-2026 | `get_lead` | same |
| create_customer | Enabled | 28-Jul-2026 | `create_customer` | same |
| search_deals | Enabled | 28-Jul-2026 | `search_deals` | same |
| get_deal | Enabled | 28-Jul-2026 | `get_deal` | same |
| create_deal | Enabled | 28-Jul-2026 | `create_deal` | same |
| get_quote_lines | Enabled | 28-Jul-2026 | `get_quote_lines` | same |
| get_quote_by_number | Enabled | 28-Jul-2026 | `get_quote_by_number` | **Live-only / gap** — not in current T71 bridge file |
| expand_kit | Enabled | 28-Jul-2026 | `expand_kit` | calls `thisapp.fn_get_kit_components` |
| get_tax | Enabled | 28-Jul-2026 | `get_tax` | Books `invokeurl` |
| books_diag | Enabled | 28-Jul-2026 | `books_diag` | Books `invokeurl` |
| sync_quote_to_crm | Enabled | 29-Jul-2026 | `sync_quote_to_crm` | `deploy_ready/creator/workflow/form_workflows/crm_bridge/sync_quote_to_crm.creator.deluge` |

Full monolith (all actions in one script): `deploy_ready/crm_bridge_on_create.creator.deluge`  
Mirror: `workflows/crm_bridge_on_create.deluge`

---

## Bridge Action_field → what it does → functions called

| Action_field | Purpose | External CRM/Books | Calls Creator function? |
| ------------ | ------- | ------------------ | ----------------------- |
| `search_customers` | Contact search | `zoho.crm.searchRecords` Contacts (should be **1** OR query) | No |
| `search_leads` | Lead search | `zoho.crm.searchRecords` Leads (should be **1** OR query) | No |
| `get_customer` | Load contact + account addresses | getRecordById Contacts + Accounts | No |
| `get_lead` | Load lead | getRecordById Leads | No |
| `create_customer` | Create Contact (+ Account) | search/create Contacts/Accounts | No |
| `search_deals` | Related deals for contact/account | getRelatedRecords Deals | No |
| `get_deal` | Load one deal | getRecordById Deals | No |
| `create_deal` | Create Deal | createRecord Deals | No |
| `get_quote_lines` | Read Quote_Request lines | Creator only | No |
| `get_quote_by_number` | Load quote by number (widget) | Creator (live) | Unknown — not in T71 monolith |
| `expand_kit` | Expand kit BOM | Creator | **`fn_get_kit_components`** |
| `sync_quote_to_crm` | Price + push Deal products | via functions | **`fn_calc_quote_lines`** then **`fn_sync_to_crm`** |
| `get_tax` | Books tax probe | Books invokeurl | No |
| `books_diag` | Books org/tax dump | Books invokeurl | No |

---

## Creator custom functions (QTS) — repo `functions/` + `deploy_ready/`

| Function | Role | Deploy paste |
| -------- | ---- | ------------ |
| `fn_sync_to_crm` | Deal Associated Products + stage/amount; **no CRM Quotes** (email path owns Quotes) | `deploy_ready/creator/workflow/functions/fn_sync_to_crm.creator.deluge` |
| `fn_calc_quote_lines` | Recalc quote lines / totals | `deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` |
| `fn_calc_line_price_draft` | Draft line price | `functions/fn_calc_line_price_draft.deluge` |
| `fn_get_tier_price` | Tier pricing | `functions/fn_get_tier_price.deluge` |
| `fn_get_discount` | Discount helper | `functions/fn_get_discount.deluge` |
| `fn_get_kit_components` | Kit expansion | `deploy_ready/creator/workflow/functions/fn_get_kit_components.creator.deluge` |
| `fn_get_next_number` | Quote numbering | `functions/fn_get_next_number.deluge` |
| `fn_refresh_fx_rates` | FX cache | `functions/fn_refresh_fx_rates.deluge` |
| `fn_sync_to_sheet` | Sheet sync | `deploy_ready/creator/workflow/functions/fn_sync_to_sheet.creator.deluge` |
| `fn_generate_pdf` | Writer merge / Sign / Deal attach (legacy send path) | `deploy_ready/creator/workflow/functions/fn_generate_pdf.debug.deluge` / `functions/fn_generate_pdf.deluge` |
| `fn_send_to_sign` | Sign helper | `functions/fn_send_to_sign.deluge` |

---

## Other form workflows (not CRM_Bridge) — repo `workflows/` / `deploy_ready/`

| Workflow (repo) | Form (typical) | Trigger | Deploy paste |
| --------------- | -------------- | ------- | ------------ |
| `expand_kit_button` | Quote UI / button | Button | `deploy_ready/expand_kit_button.creator.deluge` |
| `on_user_input_quote_lines_part_select` | Quote_Lines | User input Part | `deploy_ready/on_user_input_quote_lines_part_select.creator.deluge` |
| `on_user_input_quote_lines_qty` | Quote_Lines | User input Qty | `deploy_ready/on_user_input_quote_lines_qty.creator.deluge` |
| `on_user_input_quote_currency_fx` | Quote_Request Currency | User input | `workflows/on_user_input_quote_currency_fx.deluge` |

Quote_Request Status → Zoho **Flow** (not Creator workflow) runs `generate_and_file_quote_document` for `PDF Filed` / `Package Requested` — see `deploy_ready/flow/QTS_Saved_Draft_To_Writer/`.

---

## Widget bridgeCall map (`widget/app/widget.js`)

| Widget call | Action_field |
| ----------- | ------------ |
| CRM search | `search_customers` + `search_leads` (Promise.all) |
| Select contact | `get_customer` |
| Select lead | `get_lead` |
| New customer | `create_customer` |
| Deal list / create / restore | `search_deals` / `create_deal` / `get_deal` |
| Kit add | `expand_kit` |
| Publish / sync Deal | `sync_quote_to_crm` |
| Load lines | `get_quote_lines` |
| Load by quote # | `get_quote_by_number` |
| Tax / Books diag | `get_tax` / `books_diag` |

---

## Efficiency hotspots (External Calls)

1. **search_customers** / **search_leads** — must be single OR `searchRecords` (not a loop of 3–6).
2. **fn_sync_to_crm** — must batch Product lookups (not one search per line).
3. **sync_quote_to_crm** — stacks `fn_calc_quote_lines` + `fn_sync_to_crm` in one bridge run.

---

## Gap to fix in repo

- Live has **`get_quote_by_number`** workflow; T71 monolith does not yet define that action. Recover from live Creator or re-implement before consolidating bridge scripts.
