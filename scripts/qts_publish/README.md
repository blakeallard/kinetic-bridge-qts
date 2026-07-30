# QTS publish Flow modules (two-button CRM)

Canonical Deluge for the **Save Quote Package** / **Email Quote Package** pipeline.

Ownership: **BI1-T71**. T110 historically hosted the monolithic
`generate_and_file_quote_document.deluge` — keep that file in sync or point Flow
at these modules (see `docs/QTS_TWO_BUTTON_CRM_EXTERNAL_ANCHORS.md`).

## Flow Decision

| Creator `Quote_Request.Status` | `send_email` | Branch |
| ------------------------------ | ------------ | ------ |
| `PDF Filed` | `false` | Shared publish only |
| `Package Requested` | `true` | Shared + email-only extras |

## Modules

| File | Save | Email | Notes |
| ---- | ---- | ----- | ----- |
| `generate_and_file_quote_document.deluge` | Yes | Yes | **Drop-in Flow CF now** (Quotes/email/stage gated on `send_email`) |
| `publish_quote_package.deluge` | Yes | Yes | Thin orchestrator (calls sibling modules when Flow/Creator supports it) |
| `merge_quote_pdf.deluge` | Yes | Yes | Writer merge → PDF file |
| `snapshot_creator_revision.deluge` | Yes | Yes | Best-effort; never blocks PDF |
| `ensure_deal_contact_link.deluge` | Yes | Yes | Skip if Contact already linked |
| `assert_deal_has_products.deluge` | Yes | Yes | Loud fail before merge |
| `workdrive_ensure_quote_folders.deluge` | Yes | Yes | `QTS Quotes/{qno}/{CURRENT,CONFIRMED,DRAFTS}` |
| `workdrive_archive_to_drafts.deluge` | Yes | Yes | Archive prior CURRENT (and CONFIRMED on email) |
| `workdrive_store_current.deluge` | Yes | Yes | Write CURRENT stable filename |
| `workdrive_store_confirmed.deluge` | **No** | Yes | Email-only |
| `crm_replace_deal_attachment.deluge` | Yes | Yes | Deal attach mirrors CURRENT |
| `upsert_crm_quote.deluge` | **No** | Yes | Quotes + attach |
| `send_quote_email.deluge` | **No** | Yes | sendmail |
| `advance_deal_stage.deluge` | **No** | Yes | → Negotiation/Review |
| `snapshot_creator_revision.deluge` | Yes | Yes | Best-effort; never blocks PDF |

## Config placeholders

```deluge
qts_quotes_root_folder_id = ""; // PLACEHOLDER — paste WorkDrive resource_id when known
qts_quotes_root_folder_name = "QTS Quotes";
workdrive_connection = "zoho_crm_to_zoho_flow"; // or dedicated WorkDrive Flow connection
writer_connection = "writer_to_flow";
```

## Deploy

1. Paste each custom function into Zoho Flow (or Custom Function library).
2. Wire Flow: Creator Status trigger → Decision → call orchestrator with `send_email`.
3. Widget already syncs Deal products before Status write — Flow may still re-check products.

Dry-run: set Flow Decision to skip `send_quote_email` / stage if testing without live mail.
