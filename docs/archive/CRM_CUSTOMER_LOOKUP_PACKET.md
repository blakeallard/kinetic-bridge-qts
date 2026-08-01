# CRM Customer Lookup / New-Customer Packet (development)

Date: 2026-07-09. Scope: BI1-T71 dev only. Production untouched.
All CRM field API names below verified live via `ZohoCRM_getFields` on 2026-07-09.
All Creator link names below verified live via `getFormMetadata` on 2026-07-09.

## Architecture (verified against current capabilities)

The Creator widget JS SDK v1 can only touch Creator forms/reports (no CRM API, no
custom-function invocation). The MCP toolset has no schema-creation APIs. Therefore:

```
widget search box
  → ZOHO.CREATOR.API.addRecords(CRM_Bridge, {Action_field, Query_Text|Payload_JSON})
  → CRM_Bridge on-create Deluge workflow runs synchronously (zoho.crm.* calls)
  → writes Result_jSON + Request_Status onto the same record
  → widget getRecordById(CRM_Bridge_Report, id) → parses Result_jSON
```

The widget feature-detects the bridge: until the form exists, the customer panel
shows "CRM lookup not deployed" and everything else works unchanged.

## Manual Creator dev UI steps (Tier 3 — Bill/Blake)

1. NEW form `CRM_Bridge` (link name exactly `CRM_Bridge`), fields (exact link names):
   - `Action_field` — Single Line (Creator reserved the plain name `Action`; live link
     name confirmed 2026-07-09 after deploy)
   - `Query_Text` — Single Line
   - `Payload_JSON` — Multi Line
   - `Result_jSON` — Multi Line (live link name has lowercase j — verified 2026-07-09)
   - `Request_Status` — Single Line
   Auto-created report expected as `CRM_Bridge_Report` — verify link name; the widget
   constant `BRIDGE_REPORT` must match.
2. Form workflow on `CRM_Bridge` — Created (on add, before/on success of validation so
   the field writes persist in the same submit): paste
   `deploy_ready/crm_bridge_on_create.creator.deluge`.
3. `Quote_Request` — add three Single Line fields (exact link names):
   - `CRM_Contact_ID`
   - `CRM_Account_ID`
   - `CRM_Deal_ID`
   (admin-only visibility is fine; the widget writes them via API.)
4. AFTER step 3, paste `deploy_ready/fn_sync_to_crm.creator.deluge` over the live
   `fn_sync_to_crm` (adds ID reuse + write-back; no behavior change when IDs blank).
5. In `app/widget.js` flip `CRM_ID_FIELDS_READY` to `true` (single constant at top of
   the customer section) and rebuild/upload the ZIP — until then Save Draft omits the
   three ID fields so saves cannot fail against the current schema.

## CRM search/create strategy (implemented in the bridge)

- search_customers: three `zoho.crm.searchRecords("Contacts", ...)` passes —
  `Email:starts_with`, `Last_Name:starts_with`, `First_Name:starts_with` — merged and
  deduped by record ID; returns contact_id/name/email/phone/account_id/account_name.
- get_customer: `getRecordById(Contacts)` + linked Account read; returns Contact
  mailing address plus Account `Billing_*` and `Shipping_*` blocks.
- create_customer: duplicate-guarded by `Email:equals` (reuses the existing Contact,
  flags `duplicate:true`); find-or-create Account by `Account_Name:equals` with
  `Billing_*` fields; Contact created with `First_Name/Last_Name/Email/Phone`,
  `Mailing_*` mirror of billing, and `Account_Name` linked by ID.

## Address basis for tax (plumbing, not tax rules)

Account `Billing_*` is returned as the primary block, `Shipping_*` alongside, Contact
`Mailing_*` as fallback for account-less contacts. Which one feeds tax is an OPEN
business decision — the bridge returns all three so no decision is baked in.
There are NO tax fields on live Contacts/Accounts, and Zoho Books is not reachable
under current MCP auth (no organization ID) — tax automation remains blocked on an
authoritative source (see handoff).

## QA checklist after manual deploy

1. Widget search "Phase" → expect Phase 2 Test User (Contact 6719186000002752001).
2. Select → fields + billing address populate; CRM IDs shown in the customer chip.
3. New customer with an EXISTING email → bridge returns duplicate:true, no create.
4. New customer TEST-* with new email → Contact+Account created; IDs returned; record
   IDs logged in handoff; do not delete without approval.
5. Save Draft → Quote_Request record created; with `CRM_ID_FIELDS_READY=true` the
   three IDs persist; reload by quote number restores customer + lines.
6. Trigger a form save → updated fn_sync_to_crm reuses CRM_Contact_ID (no duplicate
   Contact), Deal updated by CRM_Deal_ID on second save.
