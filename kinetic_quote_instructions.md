# Claude Instruction File — Zoho Quote Form + Pricing + SOW/Quote Numbering Applet

## Scope Confirmation

This instruction file intentionally excludes **BI1-T76 / Zoho TeamInbox**.

Reason:

| Task | Include? | Reason |
|---|---:|---|
| BI1-T76 — Zoho TeamInbox native/routing research | No | Separate email-channel research project. Not part of the quote applet build. |
| BI1-T71 — Zoho quote form / pricing applet | Yes | Core quote form, item master, price book, margin, and distributor pricing task. |
| BI1-T93 — Sequential SOW/Quote numbering applet | Yes | Directly supports quote/SOW creation by preventing duplicate document IDs. |

This markdown is only for building/researching the **quote form applet**, including:

- quote intake
- item master / SKU handling
- price book / distributor pricing logic
- margin calculations
- quote document generation
- SOW / Quote sequential numbering
- persistent numbering history log
- WorkDrive output/storage

---

## Objective

Build a Zoho-based quote form/app prototype that lets Kinetic Bridge generate structured quotes and SOW/Quote document numbers with less manual work.

The applet should support this workflow:

```text
User submits quote request
→ selects quote type
→ selects items/SKUs
→ app applies price/margin/distributor rules
→ app calculates quote totals
→ app assigns Quote or SOW number
→ app generates/stores quote output
→ app logs document number permanently
```

---

## Included Source Tasks

### BI1-T71 — Quote Form / Pricing Applet

Build a Zoho-based quote form using Zoho Forms or Zoho Creator that integrates with item master and price books to auto-calculate quotes.

Required capabilities:

- capture inquiry details
- route by BMS vs Battery vs Distributor product flow
- pull/select items from item master
- apply price books, discounts, tiers, and margin controls
- calculate quote totals
- generate a complete quote document
- store output in WorkDrive
- prototype distributor pricing/margin applet

### BI1-T93 — Sequential SOW / Quote Numbering Applet

Build a sequential document-numbering applet for SOWs and Quotes.

Required capabilities:

- generate next available Quote/SOW ID
- maintain persistent history log
- prevent duplicate IDs
- track document type, ID, timestamp, user, and linked records
- integrate with quote workflow
- allow audit lookup of previously issued numbers

---

## Explicitly Excluded

### BI1-T76 — Zoho TeamInbox Research

Do not include TeamInbox, email-channel routing, shared inbox limits, Zoho Mail forwarding, or Starter plan channel limits in this applet scope.

That is a separate project.

---

## Non-Negotiable Rules

1. Use official Zoho documentation for Zoho capability claims.
2. Do not guess Zoho behavior.
3. Separate confirmed facts, assumptions, and recommendations.
4. Do not make irreversible production changes.
5. Use private company example documents only as local reference.
6. Do not copy sensitive customer/vendor/company data into output docs.
7. Sanitize all examples.
8. Build/research toward a prototype first, not production deployment.
9. Keep all output concise, structured, and implementation-ready.

---

## Private Reference Documents

The president may provide example quote, SOW, pricing, distributor, or template documents.

Expected local folder:

```text
reference_docs/private_examples/
```

Use these files to infer:

- quote fields
- quote layout
- SOW/Quote numbering conventions
- SKU/item fields
- product categories
- price columns
- margin formulas
- distributor pricing rules
- discount/tier rules
- approval requirements
- document output requirements

Do **not** expose sensitive details.

Use pattern summaries only.

Good:

```text
Observed pattern:
- Quote number appears in the header.
- Line items include SKU, description, quantity, unit price, and extended price.
- Distributor pricing uses a margin floor before discount approval.
```

Bad:

```text
Customer ABC paid $X for SKU Y.
```

---

## Recommended Working Directory Structure

```text
project-root/
├── claude_quote_numbering_applet.md
├── reference_docs/
│   └── private_examples/
│       ├── example_quote.xlsx
│       ├── example_sow.docx
│       ├── pricing_template.xlsx
│       └── distributor_pricing.xlsx
├── output/
│   ├── zoho_quote_applet_research.md
│   ├── creator_quote_app_schema.md
│   └── bill_brian_followup_summary.md
└── .gitignore
```

Add private examples to `.gitignore`:

```gitignore
# Company-sensitive reference documents
reference_docs/private_examples/
*.xlsx
*.docx
*.pdf
*.csv
```

---

## Required Final Outputs

Create these files.

### 1. Main Research + Build Report

```text
output/zoho_quote_applet_research.md
```

Required sections:

```text
# Zoho Quote Form + Pricing + Numbering Applet Research

## Executive Summary
## Confirmed Zoho Documentation Sources
## Current Manual Process
## Requirements From BI1-T71
## Requirements From BI1-T93
## Findings From Private Example Documents
## Recommended Zoho Architecture
## Creator vs Forms Recommendation
## Item Master / Price Book Strategy
## Pricing + Margin Logic
## Distributor Pricing Logic
## Quote/SOW Numbering Logic
## Data Model
## Integration Map
## Prototype Build Steps
## Permissions Needed
## Risks / Blockers
## Open Questions for Bill/Brian
## Go / No-Go Recommendation
## Next Steps
```

### 2. Creator App Schema

```text
output/creator_quote_app_schema.md
```

Include:

- app name
- forms/tables
- fields
- field types
- required fields
- lookup relationships
- validation rules
- sample sanitized records
- automation/workflow rules

### 3. Bill/Brian Follow-Up Summary

```text
output/bill_brian_followup_summary.md
```

Required sections:

```text
# Bill/Brian Follow-Up Summary

## Decisions Needed
## Data Needed
## Access Needed
## Recommended Prototype
## Risks
## Next Action
```

---

## Recommended App Name

Use:

```text
Kinetic_Bridge_Quote_App
```

Alternative if narrower:

```text
Quote_Numbering_App
```

Use the broader name if the app handles both quote pricing and SOW numbering.

---

# Core App Modules

## 1. Quote_Request

Purpose: capture the quote/inquiry request.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Request_ID | Auto number | Yes | Internal app ID |
| Quote_Number | Lookup/Text | No initially | Generated after numbering request |
| Customer_Name | Text | Yes | Sanitize in examples |
| Customer_Email | Email | Optional | Needed if sending later |
| Company | Text | Optional | Sanitize |
| Inquiry_Type | Picklist | Yes | BMS, Battery, Distributor, Other |
| Request_Source | Picklist | Optional | Manual, Email, CRM, Projects |
| Related_CRM_Record | URL/Text | Optional | Link only |
| Related_Project_Task | URL/Text | Optional | Link only |
| Request_Description | Multiline | Yes | User-entered notes |
| Status | Picklist | Yes | Draft, Pricing, Review, Approved, Sent, Closed |
| Created_By | User | Yes | Audit |
| Created_Time | DateTime | Yes | Audit |

---

## 2. Items

Purpose: item master or synced item cache.

| Field | Type | Required | Notes |
|---|---|---:|---|
| SKU | Text | Yes | Unique |
| Item_Name | Text | Yes | Product name |
| Product_Type | Picklist | Yes | BMS, Battery, Service, Other |
| Description | Multiline | Optional | Quote line description |
| Unit_Cost | Currency | Yes | Needed for margin |
| List_Price | Currency | Yes | Default sell price |
| Active | Boolean | Yes | Hide inactive items |
| Source_System | Picklist | Optional | Books, CRM, Creator |
| Source_Record_ID | Text | Optional | External sync ID |

---

## 3. Price_Rules

Purpose: store pricing, discount, distributor, and margin rules.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Rule_Name | Text | Yes | Human-readable |
| Customer_Type | Picklist | Yes | Direct, Distributor, Internal, Other |
| Product_Type | Picklist | Optional | BMS, Battery, Service, Other |
| Distributor_Tier | Picklist | Optional | Tier 1, Tier 2, Tier 3 |
| Discount_Percent | Decimal | Optional | Applied to list price |
| Minimum_Margin_Percent | Decimal | Yes | Margin floor |
| Effective_Start | Date | Optional | Rule validity |
| Effective_End | Date | Optional | Rule validity |
| Active | Boolean | Yes | Only active rules apply |

---

## 4. Quote_Lines

Purpose: store calculated quote line items.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Quote_Request | Lookup | Yes | Parent quote |
| Item | Lookup | Yes | Selected SKU |
| Quantity | Decimal | Yes | Must be > 0 |
| Unit_Cost | Currency | Yes | Pulled from item |
| List_Price | Currency | Yes | Pulled from item |
| Discount_Percent | Decimal | Optional | From rule or manual |
| Minimum_Margin_Percent | Decimal | Yes | From rule |
| Final_Unit_Price | Currency | Yes | Calculated |
| Extended_Total | Currency | Yes | Quantity x price |
| Gross_Margin_Amount | Currency | Yes | Revenue - cost |
| Gross_Margin_Percent | Decimal | Yes | Margin % |
| Margin_Warning | Boolean | Yes | True if below floor |
| Notes | Multiline | Optional | Manual override reason |

---

## 5. Quote_Output

Purpose: final quote summary and generated document link.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Quote_Request | Lookup | Yes | Parent quote |
| Quote_Number | Text | Yes | From numbering app |
| Total_Revenue | Currency | Yes | Sum of lines |
| Total_Cost | Currency | Yes | Sum of line costs |
| Gross_Margin_Amount | Currency | Yes | Revenue - cost |
| Gross_Margin_Percent | Decimal | Yes | Weighted margin |
| Approval_Status | Picklist | Yes | Draft, Needs Approval, Approved, Rejected |
| Generated_Document_Link | URL | Optional | WorkDrive or Books link |
| WorkDrive_Folder_Link | URL | Optional | Storage location |
| Created_By | User | Yes | Audit |
| Created_Time | DateTime | Yes | Audit |

---

## 6. Document_Type

Purpose: define numbering sequences.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Type_Code | Picklist/Text | Yes | QUOTE, SOW |
| Prefix | Text | Yes | QUOTE or SOW |
| Year | Number | Yes | e.g. 2026 |
| Last_Issued_Number | Number | Yes | Current sequence |
| Padding_Length | Number | Yes | Usually 4 |
| Active | Boolean | Yes | Only active sequence used |

---

## 7. Document_Number_Log

Purpose: permanent audit log for issued/reserved document numbers.

| Field | Type | Required | Notes |
|---|---|---:|---|
| Document_Type | Lookup | Yes | QUOTE or SOW |
| Document_ID | Text | Yes | Unique |
| Sequence_Number | Number | Yes | Numeric part |
| Status | Picklist | Yes | Reserved, Issued, Cancelled, Voided |
| Requested_By | User/Text | Yes | Audit |
| Requested_Time | DateTime | Yes | Audit |
| Linked_Quote_Request | Lookup | Optional | If quote |
| Linked_Books_Estimate_ID | Text | Optional | If Books integration |
| Linked_Project_Task_ID | Text | Optional | If SOW tracked in Projects |
| Linked_WorkDrive_URL | URL | Optional | Final doc |
| Notes | Multiline | Optional | Manual correction reason |

---

# Numbering Format

Default format unless Bill/Brian specify otherwise:

```text
QUOTE-YYYY-0001
SOW-YYYY-0001
```

Examples:

```text
QUOTE-2026-0001
QUOTE-2026-0002
SOW-2026-0001
SOW-2026-0002
```

Research whether existing documents use a different pattern.

If private examples show a different format, document it as:

```text
Observed format from examples:
[format pattern only, no sensitive values]

Recommended format:
[format]
```

---

# Pricing Formula Requirements

## Line Revenue

```text
line_revenue = quantity * final_unit_price
```

## Line Cost

```text
line_cost = quantity * unit_cost
```

## Discounted Price

```text
discounted_price = list_price * (1 - discount_percent)
```

## Minimum Allowed Price

```text
minimum_allowed_price = unit_cost / (1 - minimum_margin_percent)
```

## Final Unit Price

```text
final_unit_price = max(discounted_price, minimum_allowed_price)
```

## Gross Margin Amount

```text
gross_margin_amount = line_revenue - line_cost
```

## Gross Margin Percent

```text
gross_margin_percent = gross_margin_amount / line_revenue
```

## Warning Conditions

Flag quote line if:

```text
final_unit_price < minimum_allowed_price
gross_margin_percent < minimum_margin_percent
unit_cost is missing
SKU is missing
quantity <= 0
manual override exists
```

---

# Distributor Pricing Requirements

Research and prototype distributor logic.

Minimum model:

| Input | Purpose |
|---|---|
| Distributor tier | Determines discount or margin rule |
| Product type | Different BMS/Battery rules |
| List price | Starting point |
| Unit cost | Margin floor |
| Discount percent | Tier discount |
| Minimum margin percent | Prevents underpricing |
| Quantity | Extended pricing |
| Override reason | Required if manual price override |

Output:

| Output | Purpose |
|---|---|
| Final unit price | Quote line price |
| Extended total | Line total |
| Gross margin % | Review |
| Approval flag | If below threshold |
| Warning message | Explains issue |

---

# Creator vs Forms Decision Logic

Use this decision rule:

```text
IF Zoho Forms cannot dynamically manage item tables, price rules, quote-line calculations, and numbering logs:
    recommend Zoho Creator for the applet
ELSE IF Forms can handle intake but not pricing/numbering:
    recommend Forms for intake only + Creator for calculations/logging
ELSE:
    document both options with pros/cons
```

Expected likely recommendation:

```text
Use Zoho Creator as the main app.
Use Zoho Forms only if a lightweight public/internal intake form is needed.
```

Do not state this as confirmed until verified against Zoho docs or testing.

---

# Required Zoho Documentation Research

Research and cite official Zoho docs for:

## Zoho Creator

- forms
- reports
- lookup fields
- formula/calculated fields
- workflows
- custom functions / Deluge
- records API
- permissions/users
- export/reporting
- integrations with Books, CRM, WorkDrive if applicable

## Zoho Books

- items API
- estimates/quotes API
- custom fields
- PDFs/templates
- price lists / price books if available
- estimate numbering behavior
- attachments or document links

## Zoho WorkDrive

- file/folder upload
- generated document storage
- sharing/linking behavior

## Zoho CRM or Bigin

Only research if needed for:

- customer/contact lookup
- products/items
- deal or quote linkage

---

# Integration Map To Produce

Create this table:

| Source | Target | Data | Method | Required? | Notes |
|---|---|---|---|---:|---|
| Creator | Creator | Quote request to quote lines | Native lookup/workflow | Yes | Core app |
| Creator Items | Quote Lines | SKU/cost/list price | Lookup | Yes | Local prototype |
| Price Rules | Quote Lines | Discount/margin floor | Lookup/workflow | Yes | Pricing logic |
| Document_Type | Document_Number_Log | Next ID | Creator workflow | Yes | Numbering |
| Quote_Output | WorkDrive | Generated quote document | API/manual link | Optional v1 | Depends on access |
| Books | Creator Items | Item master sync | API/manual import | Optional v1 | Research needed |
| Creator | Books Estimate | Create estimate/quote | API | Optional v2 | Safer after approval |
| Projects | Document log | SOW/task linkage | URL/API | Optional v2 | Research needed |

---

# Prototype Build Order

Use this order:

1. Inspect private example documents.
2. Summarize quote/SOW/pricing patterns without exposing sensitive values.
3. Research Zoho Creator capabilities.
4. Research Zoho Books item/estimate/custom field capabilities.
5. Decide Creator vs Forms.
6. Build sanitized app schema.
7. Define quote line calculation formulas.
8. Define distributor pricing logic.
9. Define Quote/SOW numbering format.
10. Define collision-prevention logic.
11. Define WorkDrive output strategy.
12. Write final report.
13. Write Bill/Brian follow-up summary.
14. Do not build production automation until approval.

---

# Prototype v1 Recommendation

Unless research proves otherwise, design v1 as:

```text
Zoho Creator app with local tables:
- Quote_Request
- Items
- Price_Rules
- Quote_Lines
- Quote_Output
- Document_Type
- Document_Number_Log
```

Use manual CSV import for initial items/pricing if API access is not available.

Use WorkDrive links manually in v1 if document generation/upload automation is not approved yet.

Use API integration with Books only in v2 after accounting/process approval.

---

# Collision Prevention Requirements

The numbering applet must:

1. Maintain a persistent log.
2. Enforce unique `Document_ID`.
3. Never reuse IDs after issuance.
4. Support cancelled/voided IDs without reusing them.
5. Record timestamp and requesting user.
6. Support audit lookup by document type, date, user, and ID.
7. Allow export to CSV.
8. Support manual admin correction with notes.
9. Support separate sequences for Quote and SOW unless examples show a shared sequence.

---

# Seed / Import Plan

Research existing documents and propose:

1. Find highest existing Quote number.
2. Find highest existing SOW number.
3. Import prior numbers into `Document_Number_Log` if available.
4. Set `Last_Issued_Number` per document type/year.
5. Mark imported historical records as `Issued`.
6. Add notes: `Imported from historical records`.
7. Test next generated ID.
8. Confirm with Bill/Brian before using in production.

---

# Access Checklist

Mark each as:

- Available
- Needed
- Unknown
- Not Required

| Access | Status | Needed For |
|---|---|---|
| Zoho Creator full access | Unknown | Build applet |
| Zoho Books access | Unknown | Items, estimates, templates, quote metadata |
| Zoho Books API access | Unknown | Item/estimate sync |
| Zoho CRM/Bigin access | Unknown | Customer/product lookup if needed |
| Zoho Projects access | Unknown | SOW/task linkage if needed |
| Zoho WorkDrive access | Unknown | Quote/SOW document storage |
| Private example docs | Unknown | Reverse-engineer required fields and format |

---

# Open Questions For Bill/Brian

Include these in the follow-up summary:

1. Should Quote and SOW numbers use separate sequences?
2. What is the required number format?
3. What was the last issued Quote number?
4. What was the last issued SOW number?
5. Are quote numbers assigned before or after approval?
6. Should cancelled quotes keep their assigned numbers?
7. Where is the item master today: Books, CRM, spreadsheet, or other?
8. Who owns item costs and margin rules?
9. What is the minimum acceptable margin?
10. Are distributor discounts fixed by tier or manually approved?
11. Should BMS and Battery quotes use different templates?
12. Should the app create official Zoho Books estimates, or only draft internal quotes?
13. Should final PDFs be generated in Books, Writer, Creator, or manually stored in WorkDrive?
14. Who needs permission to create quotes?
15. Who needs permission to approve margin overrides?

---

# Go / No-Go Logic

## Quote App

```text
IF Creator can store item/rule tables and generate calculated outputs:
    recommendation = BUILD CREATOR PROTOTYPE
ELSE IF Forms can only capture input and cannot handle dynamic pricing:
    recommendation = FORMS ONLY FOR INTAKE, CREATOR FOR CALCULATION
ELSE:
    recommendation = NEEDS TECHNICAL VERIFICATION
```

## Numbering App

```text
IF Creator can store persistent records and enforce unique IDs:
    recommendation = BUILD CREATOR NUMBERING APPLET
ELSE IF Books custom fields can enforce uniqueness and cover quote numbers only:
    recommendation = BOOKS PARTIAL SOLUTION
ELSE:
    recommendation = NEEDS CUSTOM STORAGE / DATABASE
```

## Production Deployment

```text
IF item master, pricing rules, document numbering seed values, and permissions are confirmed:
    recommendation = READY FOR PROTOTYPE BUILD
ELSE:
    recommendation = RESEARCH COMPLETE, WAITING ON BUSINESS INPUT
```

---

# Final Claude Response Format

Claude should respond with:

```text
Created:
- output/zoho_quote_applet_research.md
- output/creator_quote_app_schema.md
- output/bill_brian_followup_summary.md

Top recommendation:
[one paragraph max]

Blocked by:
[short list]

Next action:
[one clear action]
```

---

# Final Instruction

Research and document the quote form applet only.

Do not research TeamInbox.

Do not include email-channel limits.

Do not include Zoho Mail shared inbox routing.

Focus only on BI1-T71 and BI1-T93.
