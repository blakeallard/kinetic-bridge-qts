# Lead-to-quote + CRM full connectivity — 2026-07-26

Blake-approved slice: (1) QTS search includes CRM Leads and quoting a Lead converts it;
(2) the Writer-merged quote PDF attaches to the Deal; (3) quote lines land on a native CRM
Quotes record with each line resolved to a CRM Product from Item_Master.

Principle (Blake): quoting IS the conversion moment — a quote for a Lead is what creates the
Deal, which in turn creates the Account and Contact.

## What was built (repo only until deployed)

### 1. Bridge (`workflows/crm_bridge_on_create.deluge`, deploy copy synced)

- `search_leads` — read-only, same starts_with patterns as `search_customers` plus Company;
  excludes converted leads (`$converted`); returns `lead_matches[{lead_id,name,email,phone,company}]`.
- `get_lead` — exact-ID read for selection and load-restore, returns identity + address.
- Both registered in `known_actions`.

### 2. Widget (`~/bevco/qts-quote-builder`, ZIP rebuilt 8/8 cmp-verified, sha256 `c421dab8…`)

- Search runs Contacts + Leads in parallel; Lead results tagged `[LEAD]`; a failing lead
  search degrades to contacts-only.
- `selectLead` → customer chip shows "CRM Lead `<id>` (converts to Contact + Account + Deal on
  save)"; Deal panel shows a conversion note instead of Deal discovery (an unconverted Lead
  cannot own a Deal).
- `buildQuotePayload` persists `CRM_Lead_ID` only when no `contactId` (contact identity always
  wins post-conversion).
- Load-restore: a saved quote with `CRM_Lead_ID` and no `CRM_Contact_ID` restores the Lead chip.
- Tests: 186/186 PASS (+5 new lead-flow assertions).

### 3. `fn_sync_to_crm` — Lead conversion

- Runs once per quote: `CRM_Lead_ID` present + `CRM_Contact_ID` blank → native CRM v2
  `Leads/{id}/actions/convert`.
- Conversion payload includes a Deal seed (Deal_Name = Company - QuoteNumber, Stage
  Proposal/Price Quote, Amount = quote total, Closing_Date +30d) ONLY when the quote has no
  `CRM_Deal_ID` already; `overwrite:false`; no owner notifications.
- Response IDs persist to `CRM_Contact_ID` / `CRM_Account_ID` / `CRM_Deal_ID`; the existing
  Round 95 Deal stage engine then syncs the same Deal in the same pass.
- Failure is loud (info log, quote left unlinked); a stale/already-converted Lead ID falls
  through to the existing email-based Contact resolution.

### 4. `fn_generate_pdf` — Deal attachment + CRM Quote record

After a verified Sign request (inside the existing `signReqId != ""` branch):

- Downloads the Writer-merged PDF (`download_link` from the merge/sign response — the exact
  customer-facing document from Writer template `lg6haa9fe623ad500461ea6708547e49c8a4a`) and
  attaches it to the Deal as `Kinetic_Bridge_Quote_<QUOTE#>.pdf` via `zoho.crm.attachFile`.
- Creates a native CRM **Quotes** record: Subject, Deal_Name + Contact_Name lookups,
  Valid_Till, and `Quoted_Items` rows (Product lookup by `Product_Code == Part_Number`,
  Quantity, List_Price, Net_Total).
- Lines whose Part_Number has no CRM Product are loudly skipped (info log names the parts);
  zero resolved lines → no CRM Quote record, loud log. Nothing is faked.
- Design note: the earlier CRM_LIFECYCLE_DESIGN "do not use native Quotes module"
  recommendation is superseded by Blake's 2026-07-26 line-items requirement — the Deal↔Product
  association alone cannot carry qty/price. QTS remains the source of truth; the CRM Quote is
  a synchronized projection.

### 5b. Deal Associated Products sync on save (added 2026-07-26, Blake-directed)

- CRM's Deal "Associated Products" linking module (org-enabled 2026-07-24; fields verified via
  getFields: Parent_Id, Product lookup, Quantity, List_Price, Discount, Discount1, Total).
- `fn_sync_to_crm` now REPLACES the Deal's Associated Products from the quote lines on EVERY
  save (delete-all then re-create), so later quote edits always mirror to CRM.
- Lines whose Part_Number has no CRM Product are loudly skipped and named in the log.
- Live-tested path still pending: Blake must re-paste `deploy_ready/fn_sync_to_crm.creator.deluge`
  and resave TEST-QUOTE0001.

### 5. CRM Products seed (EXECUTED 2026-07-26 — Blake authorized in-session, supersedes the
Tier-2 wait; flag to Bill after the fact)

- `scripts/crm_products_seed_prepare.py` → `artifacts/crm_products_seed.json`:
  44 products (39 priced, 35 active) from the July RSP import preview.
  Product_Code = Part_Number (the join key), Unit_Price = T1 list, Not_Released items carry
  their Quote_Warning as Description.
- Seeded live 2026-07-26 via bulk createRecords: 44/44 SUCCESS
  (record IDs 6719186000003527006-...049).

## Deploy checklist (Blake)

1. Re-paste `deploy_ready/crm_bridge_on_create.creator.deluge` over the CRM_Bridge on-create
   workflow (dev).
2. Re-paste `deploy_ready/fn_sync_to_crm.creator.deluge` over `fn_sync_to_crm` (dev).
3. Re-paste `deploy_ready/fn_generate_pdf.debug.deluge` over `fn_generate_pdf` (dev).
4. Upload `~/bevco/qts-quote-builder/dist/qts-quote-builder.zip` over the widget.
5. Get Bill's Tier 2 approval, then seed CRM Products from
   `artifacts/crm_products_seed.json` (bulk createRecords, 44 records).

## Test script (after deploy)

1. Create a test Lead in CRM (Blake-owned test data).
2. New quote in QTS → search the lead's name → pick the `[LEAD]` result → add a kit →
   Save Draft.
3. Verify in CRM: Lead converted; Contact + Account + Deal exist; Deal Amount = quote total;
   quote record carries all three IDs.
4. Send for signature (TEST signer identities) → verify the Writer PDF appears under the
   Deal's Attachments and (post-Products-seed) a CRM Quote record carries the exact lines.

## Open items

- CRM Quotes module field API names (`Deal_Name`, `Contact_Name`, `Valid_Till`, `Quoted_Items`,
  `Product_Name`, `Quantity`, `List_Price`, `Net_Total`) are standard Zoho defaults but have
  NOT been live-verified via getFields — first live run may need a field-name correction.
- `zoho.crm.attachFile` + Writer `download_link` interaction unverified live (download may
  need auth context; loud logs will show it).
- Products seed execution awaits Bill (Tier 2).
