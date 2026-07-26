# BI1-T71 Implementation Plan — Zoho Quote System (Item Master, Price Book, Automated Calculations)

Zoho Task ID: `2543412000001469015`

> **STATUS NOTE (2026-07-13 — Round 92 reconciliation): HISTORICAL, not the grandmaster plan.**
> This is the original pre-build design document. It has NOT tracked execution: Stages 1–5,
> 7 (partially), and 8 were built and QA'd in Creator dev (see `docs/CURRENT_HANDOFF.md`
> Rounds and `QTS_PROJECT_STATUS.md`); tax was DESCOPED 2026-07-10
> (`docs/TAX_DESCOPE_2026-07-10.md`) although Section 5 still includes it; the approval
> module (Stage 6) was never built; freight/shipping is now governed by the 2026-07-13
> Shipping Terms requirement. The current authoritative sources are:
> `docs/CURRENT_HANDOFF.md` (active state, newest Round first),
> `QTS_PROJECT_STATUS.md` (architecture/status), and
> `docs/MEETING_REQUIREMENTS_2026-07-07.md` + `docs/MEETING_REQUIREMENTS_2026-07-13.md`
> (business requirements). The remaining-work master plan lives in the Round 92 entry of
> `docs/CURRENT_HANDOFF.md`. This file is preserved unedited below for design history.

## 1. Current Objective

Build a Zoho-based quote workflow for Kinetic Bridge / BEVCO that replaces the current manual, draft-template quoting process. The system must support:

- Quote intake (sales/internal request)
- Item selection from a maintained item master
- Price lookup via a structured price book (tiers/discounts)
- Automated calculations (subtotal, discount, markup/margin, tax, freight, FX)
- Quote document generation
- Later integration with Zoho Sign (signature) and CRM/Bigin (deal linkage, WorkDrive storage)

Two distinct product flows must be supported: **BMS** (battery management systems) and **battery products** — these have different item attributes and possibly different margin rules.

## 2. MVP Workflow

1. Customer/internal quote request submitted (form)
2. Quote type selection (BMS vs. battery product; new vs. revision)
3. Item/master selection (search/select SKUs from item master)
4. Quantity/configuration input per line item
5. Automated calculations:
   - Line subtotal
   - Discount (tier/customer-based)
   - Markup/margin check
   - Tax
   - Freight/shipping
   - FX conversion (if non-USD customer)
   - Quote total + gross margin
6. Quote review (internal, pre-send)
7. PDF/template generation from approved data
8. Optional approval step (margin/discount outside authority thresholds)
9. Send/sign (Zoho Sign) → store (WorkDrive) → update CRM/Bigin deal record

## 3. Data Model

Proposed modules/tables:

| Module | Purpose |
|---|---|
| `Quote` | Header record: customer, quote type, status, totals, currency |
| `Quote_Line_Item` | One row per item on a quote: SKU, qty, unit price, discount, line total |
| `Item_Master` | Canonical SKU list: BMS + battery products, base cost, base price, UOM |
| `Price_Book` | Price tiers/discount rules keyed to item + customer tier |
| `Customer_Account` | Customer/distributor record (tier, default currency, credit terms) |
| `Vendor_Supplier` | Supplier reference for cost basis (optional for MVP, needed for margin accuracy) |
| `Currency_FX_Rate` | FX rate table for non-USD quotes |
| `Quote_Template` | Document template used for PDF generation (BMS vs. battery variant) |
| `Approval_Review_Status` | Approval state/history when margin or discount exceeds authority threshold |

## 4. Required Fields

### Quote
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Quote ID | Text/Auto | Yes | Auto | Primary key |
| Quote Type | Dropdown (BMS / Battery) | Yes | Manual | Drives calc + template branch |
| Customer/Account | Lookup → Customer_Account | Yes | Manual/CRM | |
| Currency | Dropdown | Yes | Manual/default from customer | Drives FX step |
| Status | Dropdown (Draft/Review/Approved/Sent/Signed) | Yes | Automatic | State machine |
| Subtotal | Currency | Yes | Automatic | Sum of line items |
| Discount Total | Currency | No | Automatic | |
| Tax Total | Currency | No | Automatic | |
| Freight | Currency | No | Manual/Automatic | May be manual entry or rate-based |
| Grand Total | Currency | Yes | Automatic | |
| Gross Margin % | Percent | Yes | Automatic | For internal review only |
| Created By | User lookup | Yes | Automatic | |
| Created Date | Date | Yes | Automatic | |
| Approval Required | Boolean | Yes | Automatic | Set true if discount/margin breaches threshold |

### Quote Line Item
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Quote ID | Lookup → Quote | Yes | Automatic | |
| Item/SKU | Lookup → Item_Master | Yes | Manual (search) | |
| Quantity | Number | Yes | Manual | |
| Unit Price | Currency | Yes | Automatic (from Price_Book) | Overridable with approval |
| Line Discount % | Percent | No | Automatic/Manual | |
| Line Subtotal | Currency | Yes | Automatic | qty × unit price |
| Line Total | Currency | Yes | Automatic | after discount |
| Unit Cost | Currency | No | Item_Master | For margin calc, not shown to customer |

### Item Master
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| SKU | Text | Yes | Manual/import | Primary key |
| Product Type | Dropdown (BMS / Battery) | Yes | Manual | |
| Description | Text | Yes | Manual | |
| Base Cost | Currency | Yes | Manual/import | Vendor cost |
| Base Price (List) | Currency | Yes | Manual/import | Pre-discount |
| UOM | Text | Yes | Manual | |
| Active | Boolean | Yes | Manual | Hide discontinued SKUs |
| Vendor | Lookup → Vendor_Supplier | No | Manual | |

### Price Book
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Price Book ID | Text/Auto | Yes | Auto | |
| Item/SKU | Lookup → Item_Master | Yes | Manual | |
| Customer Tier | Dropdown | Yes | Manual | e.g., Distributor/Retail/OEM |
| Discount % or Fixed Price | Number | Yes | Manual | One or the other |
| Effective Date | Date | No | Manual | Supports price book versioning |
| Min Qty (tier break) | Number | No | Manual | Quantity-based pricing |

### Customer/Account
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Account Name | Text | Yes | CRM/Bigin sync | |
| Customer Tier | Dropdown | Yes | Manual | Drives price book lookup |
| Default Currency | Dropdown | Yes | Manual | |
| Credit Terms | Text | No | Manual | |
| CRM/Bigin ID | Text | Yes | Automatic | Link back to CRM record |

### Currency/FX Rate
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Currency Code | Text | Yes | Manual | ISO code |
| Rate to USD | Number | Yes | Manual/API | Needs a defined refresh cadence |
| Effective Date | Date | Yes | Manual | |

### Quote Template
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Template ID | Text | Yes | Manual | |
| Quote Type | Dropdown (BMS / Battery) | Yes | Manual | Maps to Quote.Quote Type |
| Document (Writer template) | File/Link | Yes | Manual | Zoho Writer template reference |

### Approval/Review Status
| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| Quote ID | Lookup → Quote | Yes | Automatic | |
| Requested By | User | Yes | Automatic | |
| Reviewer | User | No | Manual | |
| Reason | Text | No | Manual | Why approval triggered (discount/margin) |
| Decision | Dropdown (Pending/Approved/Rejected) | Yes | Manual | |
| Decision Date | Date | No | Automatic | |

## 5. Calculation Logic

```
line_subtotal   = quantity × unit_price
line_discount   = line_subtotal × (line_discount_pct / 100)
line_total      = line_subtotal - line_discount

quote_subtotal  = Σ line_total (all line items)

quote_discount  = quote_subtotal × (quote_discount_pct / 100)   # if a header-level discount also applies

markup_amount   = unit_price - unit_cost
margin_pct      = (unit_price - unit_cost) / unit_price × 100    # per line
gross_margin_pct (quote) = (quote_subtotal - Σ(unit_cost × quantity)) / quote_subtotal × 100

tax_amount      = taxable_subtotal × tax_rate
                  # taxable_subtotal excludes freight unless jurisdiction requires otherwise — confirm with Bill/Bryan

freight_amount  = flat_rate | weight_based_rate | manual_entry   # method TBD, see open questions

fx_converted_total = quote_total_usd × fx_rate(currency, effective_date)

quote_total     = quote_subtotal - quote_discount + tax_amount + freight_amount

rounding_rule   = round(value, 2)   # standard 2-decimal currency rounding; confirm if line-level or total-level rounding is required
```

Notes:
- Margin thresholds (e.g., quotes below X% margin require approval) need a defined value from Bryan/Bill — see open questions.
- Discount authority (who can approve what % without escalation) also needs definition before the approval module can be finalized.

## 6. Zoho Implementation Options

| Option | Pros | Cons |
|---|---|---|
| **Zoho Creator app** | Full control over forms, custom logic (deluge), workflow/approval, report views, can host the "distributor pricing applet" as its own page | More build effort; separate data store from CRM/Books unless synced |
| **Zoho CRM custom module** | Reuses existing CRM records (Accounts, Deals), tighter tie to sales pipeline | CRM custom modules are less flexible for multi-step calculation UIs and applet-style pricing tools |
| **Zoho Books/Inventory/Quotes (native)** | Native Quotes object already has line items, tax, PDF generation, and price lists — least custom build | Native price lists in Books are simpler than a full tiered price book; less flexible for a distributor-margin applet; less control over BMS vs battery routing UI |
| **Hybrid (Creator front-end + Books/CRM as system of record)** | Creator handles intake form + margin/pricing applet + BMS/battery routing; Books or CRM stores the resulting Quote/Item Master/Price Book as the source of truth; Writer generates the PDF | More moving parts to wire together (Deluge + API calls between apps) |

## 7. Recommended MVP Architecture

**Hybrid: Zoho Creator for the intake form + calculation applet, backed by Creator's own Item_Master/Price_Book tables for MVP, with Zoho Writer for PDF generation and CRM/Bigin + WorkDrive integration deferred to Stage 7.**

Rationale:
- Creator gives full control over the BMS-vs-battery routing logic and the margin-control applet described in the task — this is a defined, non-trivial calculation surface that native Books Quotes won't flexibly support.
- Building Item_Master and Price_Book as Creator tables (rather than immediately syncing to Books/CRM) keeps the MVP self-contained and avoids touching live CRM/Books data during development — consistent with the "do not modify Zoho live data" constraint on this task.
- Zoho Writer is already confirmed available (`mcp__zoho__ZohoWriter_*`) and supports merge-and-store/merge-and-sign, which covers Stage 5 and later Stage 7 signature integration without custom PDF code.
- CRM/Bigin/WorkDrive integration is deferred to a later stage once the calculation core is validated — reduces risk of touching production CRM data before the pricing logic is confirmed correct.

This can be re-pointed to live Item Master/Price Book data sources later if Bryan/Bill confirm where those should canonically live (see open questions).

## 8. Build Order

1. **Stage 1 — Schema/design**: Finalize field lists above with Bryan/Bill sign-off; create Creator app + tables (Quote, Quote_Line_Item, Item_Master, Price_Book, Customer_Account, Currency_FX_Rate) in a sandbox/dev environment.
2. **Stage 2 — Item master import/model**: Load sample/starter Item_Master data (BMS + battery) from whatever source Bryan/Bill confirm is authoritative; validate required fields are populated.
3. **Stage 3 — Quote form**: Build the intake form (quote type, customer, line item entry with item search) in Creator.
4. **Stage 4 — Calculation logic**: Implement the formulas from Section 5 as Deluge scripts/workflows; build the margin-control applet view (BMS and battery flows).
5. **Stage 5 — Quote PDF/template**: Build Zoho Writer templates (one per quote type) and wire Merge_and_Store from Creator.
6. **Stage 6 — Approval/review**: Implement the Approval_Review_Status flow with configurable thresholds once authority rules are confirmed.
7. **Stage 7 — CRM/Sign/WorkDrive integration**: Link finished quotes back to CRM/Bigin deal records, send via Zoho Sign, store final PDF in WorkDrive.
8. **Stage 8 — Testing/QA**: Validate calculations against real example quotes from Bryan, test both BMS and battery flows end-to-end, confirm rounding/tax/freight/FX edge cases.

## 9. Open Questions for Bryan/Bill

- Where does the official/canonical item master currently live (spreadsheet, Books Items, CRM Products)?
- Is the Lithium Balance price list complete and current, or is there missing data to source first?
- Who owns/maintains the price book going forward — Sales, Ops, or Blake?
- What are the exact quote type / dropdown values needed beyond BMS vs. battery (e.g., new vs. revision, distributor vs. direct)?
- What approval is required, and at what margin/discount thresholds does it trigger?
- Who has authority to approve discounts/margins outside standard thresholds, and what are those thresholds?
- What are the tax and freight calculation rules (flat rate, weight-based, jurisdiction-based)?
- What currencies need to be supported, and where should FX rates be sourced/refreshed from?
- What are the final quote PDF template requirements (branding, required legal/terms language, BMS vs. battery template differences)?

## 10. Immediate Next Development Tasks

1. Confirm the open questions in Section 9 with Bryan/Bill before finalizing schema field types (especially dropdown value lists and approval thresholds).
2. Stand up a Zoho Creator app/workspace for this project (dev/sandbox, not touching live CRM/Books data).
3. Create the six core Creator tables from Section 3 with the fields from Section 4 (mark FX/Approval tables as stretch if time-constrained).
4. Build a minimal quote intake form (Quote + Quote_Line_Item) with item search against Item_Master.
5. Implement and unit-test the core calculation chain (line subtotal → discount → tax → freight → total → margin) against 2-3 real example quotes from Bryan, before building the PDF/template layer.
