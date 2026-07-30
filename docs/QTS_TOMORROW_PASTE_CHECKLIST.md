# QTS two-button CRM — tomorrow paste & verify checklist

Date prepared: 2026-07-30  
Branch: `cursor/qts-two-button-crm-plan`  
Goal: paste review fixes → smoke once → Stage 5 E2E (Save ×2, Email ×1)

---

## Before anything

1. Open **Creator → Usage Details → External Calls**.
2. If still near/at daily limit, **stop**. Wait for reset. Do not spam CRM.
3. Use a **sacrificial Deal** + **internal email** only.

---

## A. What goes where (simple map)

### Zoho Flow — custom functions

Paste from `scripts/qts_publish/` (prefer modular path; update **all** — helper signatures changed, trailing `map deal_record`):

| Repo file | Flow function name (suggested) | Notes |
| --------- | ------------------------------ | ----- |
| `assert_deal_has_products.deluge` | `assert_deal_has_products` | Gate: Deal has products |
| `ensure_deal_contact_link.deluge` | `ensure_deal_contact_link` | Deal ↔ Contact |
| `merge_quote_pdf.deluge` | `merge_quote_pdf` | Writer → PDF |
| `workdrive_ensure_quote_folders.deluge` | `workdrive_ensure_quote_folders` | Folder tree |
| `workdrive_archive_to_drafts.deluge` | `workdrive_archive_to_drafts` | Archive prior PDFs |
| `workdrive_store_current.deluge` | `workdrive_store_current` | CURRENT upload |
| `workdrive_store_confirmed.deluge` | `workdrive_store_confirmed` | CONFIRMED (Email only) |
| `crm_replace_deal_attachment.deluge` | `crm_replace_deal_attachment` | Deal PDF replace (deletes prior) |
| `snapshot_creator_revision.deluge` | `snapshot_creator_revision` | Best-effort; never blocks |
| `upsert_crm_quote.deluge` | `upsert_crm_quote` | CRM Quotes (Email only) |
| `send_quote_email.deluge` | `send_quote_email` | Email (Email only) |
| `advance_deal_stage.deluge` | `advance_deal_stage` | → Negotiation/Review (Email only) |
| **`publish_quote_package.deluge`** | **`publish_quote_package`** | **Orchestrator — paste last** |

**Flow wiring**

| Creator `Quote_Request.Status` | `send_email` | Branch |
| ------------------------------ | ------------ | ------ |
| `PDF Filed` | `false` | Shared publish only (Save) |
| `Package Requested` | `true` | Shared + Quotes + email + stage (Email) |

Trigger: Creator Status change → Decision → call `publish_quote_package(...)`.

**Do not use these for live WorkDrive** (keep modular instead):

- `generate_and_file_quote_document.deluge` — monolith, **no WorkDrive**
- `generate_and_file_quote_document.COMPAT.deluge` — drop-in, **no WorkDrive**

---

### Zoho Creator — custom functions

| Repo file | Creator target |
| --------- | -------------- |
| `deploy_ready/fn_sync_to_crm.creator.deluge` | Function **`fn_sync_to_crm`** — **paste this** |
| `deploy_ready/fn_calc_quote_lines.creator.deluge` | Function **`fn_calc_quote_lines`** — usually already live; leave unless broken |
| `deploy_ready/fn_get_kit_components.creator.deluge` | Function **`fn_get_kit_components`** — kits only; not required for this publish fix |

---

### Zoho Creator — CRM_Bridge form workflows

Live is **one workflow per Action**. Leave disabled monolith **CRM Bridge** off.

| Repo file | Live Creator workflow | Paste tomorrow? |
| --------- | --------------------- | --------------- |
| `deploy_ready/crm_bridge_actions/search_customers.creator.deluge` | **CRM Bridge - search_customers** | **Yes** |
| `deploy_ready/crm_bridge_actions/search_leads.creator.deluge` | **search_leads** | **Yes** |
| `deploy_ready/crm_bridge_actions/sync_quote_to_crm.creator.deluge` | **sync_quote_to_crm** | **No** (already calls calc + `fn_sync_to_crm`) |

Other bridge actions (`get_customer`, `get_deal`, `create_deal`, `get_quote_lines`, etc.) are separate live workflows. Source blocks live in `deploy_ready/crm_bridge_on_create.creator.deluge` — **only paste if that specific action needs an update**.

---

### Not Deluge pastes

| Piece | Where |
| ----- | ----- |
| Buttons + Status writes | Widget (`qts-quote-builder`) — already deployed if ZIP uploaded |
| Status → Flow trigger | Zoho Flow config UI |

---

## B. Tomorrow order of operations

### 1. Quota check
Creator → Usage Details → External Calls → proceed only if headroom exists.

### 2. Paste Creator (3 items)
1. `deploy_ready/crm_bridge_actions/search_customers.creator.deluge` → **CRM Bridge - search_customers**
2. `deploy_ready/crm_bridge_actions/search_leads.creator.deluge` → **search_leads**
3. `deploy_ready/fn_sync_to_crm.creator.deluge` → function **`fn_sync_to_crm`**

Do **not** re-paste `sync_quote_to_crm` or the disabled monolith.

### 3. Paste Flow modules
Paste every `scripts/qts_publish/*.deluge` helper above, then **`publish_quote_package` last**.  
Confirm Flow still calls the modular orchestrator (not COMPAT/monolith).

### 4. Smoke once (cheap)
One **Save Quote Package** on sacrificial Deal. Expect:

- Deal Associated Products present
- **One** Deal PDF (old Kinetic Bridge PDFs deleted)
- WorkDrive **CURRENT** updated
- **No** CRM Quote / **no** client email / **no** stage change

### 5. Stage 5 E2E matrix

| # | Action | Expect |
| - | ------ | ------ |
| 1 | Save | Status `PDF Filed`; CURRENT; Deal PDF; no Quotes/email/stage |
| 2 | Save again | Still **one** Deal PDF; prior CURRENT → DRAFTS |
| 3 | Email | Status `Package Requested`; CONFIRMED; CRM Quote; email; stage → **Negotiation/Review** |

Stop if External Calls spike. Do not email a real customer.

---

## C. If something fails

1. Confirm which Flow CF actually runs: `publish_quote_package` vs COMPAT vs monolith.
2. Confirm `fn_sync_to_crm` paste landed (batched product search; refuses empty product wipe).
3. Check Creator Usage Details before retrying.
4. Details: `docs/QTS_TWO_BUTTON_CRM_PLAN.md`, `docs/QTS_TWO_BUTTON_CRM_VERIFY.md`, `docs/QTS_CREATOR_WORKFLOWS_AND_FUNCTIONS.md`.

---

## D. Locked IDs / names (reminder)

| Item | Value |
| ---- | ----- |
| WorkDrive root | `My Folders/QTS Quotes` |
| WorkDrive root ID | `wctzef9e0b057e781406896d8866994e93156` |
| Stable PDF name | `Kinetic_Bridge_Quote_{quote_number}.pdf` |
| Save Status | `PDF Filed` |
| Email Status | `Package Requested` |
| Email Deal stage | `Negotiation/Review` |
