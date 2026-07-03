# Zoho Quote Form + Pricing + Numbering Applet Research

---

## Executive Summary

Kinetic Bridge (operated by Bevco) requires a structured quoting tool for BMS/battery system sales through Acme BMS distribution. The existing process is spreadsheet-driven with complex multi-currency pricing, volume-tiered distributor discounts, internal profit tracking, and a manual quote numbering convention. A Zoho Creator application (`Kinetic_Quote`) can replicate and improve this workflow with persistent data, sequential numbering, margin controls, and an internal profit view — without replacing the Zoho Books estimate flow until v2.

**Recommendation: Build Zoho Creator prototype first. Zoho Forms alone cannot handle dynamic pricing, multi-currency FX, margin floors, or persistent numbering logs.**

---

## Confirmed Zoho Documentation Sources

> Note: The following represents current knowledge of Zoho Creator capabilities as of June 2026. All Creator capabilities should be verified against Zoho's live documentation before building. Specific Deluge function names and API endpoints must be validated in the Creator IDE.

Zoho Creator capabilities confirmed relevant to this build:
- Multi-form apps with lookup relationships between forms/reports
- Formula fields and Deluge scripting for calculated values
- Workflow rules triggered on form submission
- Deluge `zoho.books` and `zoho.crm` integration connectors
- Record uniqueness enforcement via validation rules
- Auto-number fields for internal IDs
- PDF/report export from Creator reports
- WorkDrive file upload via Deluge (`zoho.workdrive.uploadFile`)
- User-level field permissions and form access control

**Open items requiring direct Zoho doc verification:**
- Maximum formula complexity per field (nested calculations)
- Atomic counter increment behavior (concurrent submission safety)
- Native DKK currency support in currency fields
- WorkDrive folder API permissions under current Zoho One plan

---

## Current Manual Process

Observed pattern from private example documents (sanitized):

1. Quote is built in Excel with two tabs: customer-facing quote and internal profit analysis
2. User manually enters EUR list prices from distributor price list
3. User manually enters EUR→USD exchange rate and DKK→USD exchange rate
4. Formulas apply distributor discount, markup multiplier, and FX conversion
5. Customer quote is presented in a target currency (USD or DKK depending on customer)
6. Internal profit tab calculates per-line profit, total profit, FX charge (1.5%), and wire transfer fee
7. Quote number is assigned manually (format `QUOTE####`)
8. No persistent log of issued quote numbers observed — gap confirmed
9. Document is saved/sent manually; no WorkDrive link automation observed

---

## Requirements From BI1-T71

| Requirement | Source | Notes |
|---|---|---|
| Capture inquiry details | BI1-T71 | Quote_Request form |
| Route by BMS vs Battery vs Distributor | BI1-T71 | `Inquiry_Type` picklist drives line item rules |
| Pull/select items from item master | BI1-T71 | Items form with lookup |
| Apply price books, discounts, tiers, margin controls | BI1-T71 | Price_Rules form + Deluge formulas |
| Calculate quote totals | BI1-T71 | Quote_Lines formula fields + Quote_Output rollup |
| Generate complete quote document | BI1-T71 | Creator PDF export or WorkDrive-linked document |
| Store output in WorkDrive | BI1-T71 | Deluge WorkDrive upload on approval |
| Prototype distributor pricing/margin applet | BI1-T71 | Distributor-specific Price_Rules + margin floor |

---

## Requirements From BI1-T93

| Requirement | Source | Notes |
|---|---|---|
| Generate next available Quote/SOW ID | BI1-T93 | Document_Type sequence counter |
| Maintain persistent history log | BI1-T93 | Document_Number_Log form |
| Prevent duplicate IDs | BI1-T93 | Unique validation on Document_ID field |
| Track document type, ID, timestamp, user, linked records | BI1-T93 | Full audit fields in log |
| Integrate with quote workflow | BI1-T93 | Triggered from Quote_Request on status change |
| Allow audit lookup of previously issued numbers | BI1-T93 | Creator report with search/filter |

---

## Findings From Private Example Documents

> All values, customer names, and specific amounts have been sanitized. The following describes patterns only.

### Quote Document

**Observed format from examples:**
```
QUOTE0004
```
This is a sequential integer with no year prefix and no dash separators. It is zero-padded to 4 digits.

**Recommended format (pending Bill/Brian confirmation):**
```
QUOTE0001, QUOTE0002, ... QUOTE9999
```
OR with year if confirmed:
```
QUOTE-2026-0001
```
Flag for confirmation — see Open Questions.

**Quote sheet structure:**
- Customer-facing tab with line items, subtotal, tax, shipping, and total
- Currency: customer receives quote in USD or DKK (configurable per quote)
- Payment terms: observed NET 15
- Shipping terms: FCA (Free Carrier, Bevco ships from origin, customer pays freight)
- Line items include: item number, description, quantity, unit price, line total
- Notes column includes estimated lead times per item

**Profit sheet structure:**
- Internal tab NOT shown to customer
- Mirrors each line item from Quote tab
- Tracks: quantity, sell price (USD), unit cost (USD), line revenue, per-line profit
- Additional fee deductions:
  - International wire transfer charge (flat fee, confirmed present)
  - Bevco FX charge: 1.5% of total revenue (confirmed formula)
  - Total fees = wire charge + FX charge
  - Net Net Profit = total line profit − total fees

**Pricing formula (observed):**
```
customer_unit_price = (eur_list_price × eur_usd_rate × (1 − distributor_discount)) × (1 + markup_rate)
```
Where:
- `eur_list_price` = Acme BMS EUR price for the SKU at the applicable volume break
- `eur_usd_rate` = manual EUR→USD exchange rate entered per quote
- `distributor_discount` = percentage from distributor price list
- `markup_rate` = single Bevco markup applied to all lines (global per quote, stored at a header cell)

**Secondary FX column (DKK):**
```
dkk_usd_rate = manual DKK→USD exchange rate entered per quote
usd_cost = dkk_total_cost / dkk_usd_rate
dkk_customer_price = customer_unit_price_usd × dkk_usd_rate
delta = dkk_customer_price − dkk_discounted_cost
```
This secondary set of columns appears to be used when the customer receives a DKK-denominated quote.

**Item categories observed:**
- BMS hardware: MCU (Master Control Unit), CMU (Cell Monitor Unit) modules
- Accessories: wire harness kits, CAN adapters, shunts
- Software licenses: Creator License (configuration), Service Tool (maintenance)
- Note: software licensing flagged with `???` in one line — open question on pricing

### Distributor Price List (Acme BMS)

**Pricing base:** All prices in EUR, valid from October 2025

**Volume-break tiers (hardware):** 1–9 / 10–99 / 100–249 / 250–499 / 500–999 / 1,000–2,499 / 2,500–25,000

**Distributor tier levels:**
- Partner tier: higher discount (>750k EUR annual volume)
- Distributor tier: standard discount (250k–750k EUR annual volume)
- Both tiers have separate volume-based discount percentages
- Software has a single discount column separate from hardware tiers

**Product families (BMS hardware):**
- n-BMS: modular BMS for large packs (MCU + CMU architecture)
- n3-BMS: next-gen variant of n-BMS
- c-BMS24: compact BMS for medium packs
- c-BMS24X: expanded compact BMS
- i-BMS: integrated compact BMS

**Physics constraint — n-BMS kit configuration:**
- Referenced config: 96 channels / 400V with NMC cells
- CMU quantity per system: 1–30 CMUs depending on pack configuration
- This means the same kit can have variable BOM depending on customer's cell count/voltage

**Bundle/Kit structure (observed for all product families):**
Each product family has a config sheet defining components per system:
- 1× MCU (main control board)
- N× CMU modules (quantity depends on cell/voltage config)
- Wire harness kit(s) for MCU
- Wire harness kit(s) for CMU(s) (quantity matches CMU count)
- 1× Creator License (software, per-user)
- 1× Service Tool license (optional, per-user bundle)
- 1× CAN adapter (optional, may be sourced externally)
- 1× Current sensor/shunt (optional, depends on customer setup)

**NPD items:** CMU18/4 variants marked "NPD - coming soon" — not available for quoting

**Discount eligibility:** Items marked with X in column L of price list are eligible for distributor discount. Not all accessories carry the discount.

---

## Recommended Zoho Architecture

```
Zoho Creator App: Kinetic_Quote
├── Forms (data entry)
│   ├── Quote_Request        — inquiry intake
│   ├── Items                — item master / SKU table
│   ├── Price_Rules          — discount/margin rules
│   ├── Quote_Lines          — calculated line items
│   ├── Quote_Output         — quote summary and document link
│   ├── Document_Type        — numbering sequence definitions
│   └── Document_Number_Log  — permanent audit log
├── Reports (views)
│   ├── Active_Quotes        — open quote requests
│   ├── Quote_Line_Detail    — lines per quote with margin flags
│   ├── Profit_Summary       — internal margin review
│   ├── Document_Log_Report  — numbering audit lookup
│   └── Items_Master_View    — SKU browser
└── Workflows / Deluge
    ├── on Quote_Request submit → validate fields
    ├── on Quote_Lines add → calculate pricing + margin warning
    ├── on Quote_Request status → "Approved" → request document number
    ├── on number request → increment Document_Type counter + write log
    └── on Quote_Output → WorkDrive upload (v2)
```

---

## Creator vs Forms Recommendation

**Recommendation: Zoho Creator**

Zoho Forms cannot:
- Manage relational item master / price rule lookup
- Execute multi-step pricing formula with FX conversion
- Maintain a persistent counter for sequential numbering
- Write an audit log record atomically
- Support an internal profit view separate from customer view
- Enforce unique document IDs across submissions

Zoho Forms may be useful in v2 as a lightweight external intake channel that submits into Creator as the backend. For v1, Creator handles everything.

---

## Item Master / Price Book Strategy

**V1 (prototype):**
- Manual CSV import of Acme BMS items into the `Items` form
- Fields: SKU (part number), product name, product family (n-BMS / c-BMS24 / etc.), category (hardware / software / accessory), EUR list price at each volume break (1–9 through 2500+), distributor eligibility flag, NPD flag
- Volume break pricing stored as separate fields or as a JSON blob (simpler) per SKU

**V2 (production):**
- Sync from Zoho Books items via API if Books becomes the item master
- Alternatively, maintain Creator as item master and push confirmed quotes to Books

**Open question for Bill/Brian:** Where does item master currently live today (Books, CRM, spreadsheet, other)?

---

## Pricing + Margin Logic

### Core Formula

```
eur_list_price      = looked up from Items by SKU + volume break
distributor_discount = looked up from Price_Rules by customer type + volume tier
eur_usd_rate        = entered per quote (Quote_Request header field)
markup_rate         = entered per quote (Quote_Request header field, applies to all lines)

customer_unit_price = (eur_list_price × eur_usd_rate × (1 − distributor_discount)) × (1 + markup_rate)
line_revenue        = customer_unit_price × quantity
line_cost_usd       = (dkk_cost_total / quantity) / dkk_usd_rate
gross_margin_amt    = line_revenue − (line_cost_usd × quantity)
gross_margin_pct    = gross_margin_amt / line_revenue
margin_warning      = gross_margin_pct < minimum_margin_pct
```

### Minimum Price Guard

```
minimum_allowed_price = unit_cost_usd / (1 − minimum_margin_pct)
final_unit_price      = max(customer_unit_price, minimum_allowed_price)
```

### FX Charge (Bevco fee, deducted in profit view)

```
fx_charge = total_revenue × 0.015    ← 1.5% confirmed from example
```

### Warning Flags

Trigger margin warning if any of the following:
- `gross_margin_pct < minimum_margin_pct`
- `unit_cost` is missing
- `eur_list_price` is missing
- `quantity <= 0`
- `customer_unit_price < minimum_allowed_price`
- Manual price override (no override mechanism observed yet — flag for Bill/Brian)

---

## Distributor Pricing Logic

### Tier Structure (observed from Acme BMS price list)

| Tier | Volume Threshold | Notes |
|---|---|---|
| Partner | >750k EUR annual | Higher discount |
| Distributor | 250k–750k EUR annual | Standard discount |
| Prospect/Pending | <250k EUR | No guaranteed discount |

### Volume Break Discounts (hardware)

Volume brackets: 1–9 / 10–99 / 100–249 / 250–499 / 500–999 / 1,000–2,499 / 2,500–25,000

Each bracket has a discount percentage for Partner tier and Distributor tier separately. Software licenses have a single discount column.

### Discount Eligibility

Not all SKUs are discountable — eligibility is per-item (flag in item master). Accessories may not carry distributor discount.

### Open question for Bill/Brian

Which tier does Bevco hold with Acme BMS (Partner or Distributor)? This determines which discount row applies.

---

## Quote/SOW Numbering Logic

### Observed Format

```
QUOTE0004
```

Pattern: prefix + zero-padded 4-digit sequential integer. No year in the observed example.

### Recommended Format (pending confirmation)

Option A (match existing): `QUOTE0001`, `QUOTE0002` ... `QUOTE9999`
Option B (year-based, per instruction file): `QUOTE-2026-0001`, `SOW-2026-0001`

Flag for Bill/Brian. Option A matches existing convention. Option B adds year context.

### Collision Prevention (Creator implementation)

```
1. On "Request Number" action:
   a. Read Document_Type record for type = "QUOTE" (or "SOW")
   b. Increment Last_Issued_Number by 1
   c. Format: prefix + zero-pad(last_issued_number, padding_length)
   d. Check Document_Number_Log for existing Document_ID = formatted_id
   e. If collision found: increment and retry (should not occur if atomic)
   f. Write new record to Document_Number_Log with status = "Reserved"
   g. Link to Quote_Request
   h. Update Document_Type.Last_Issued_Number
2. On quote approved/sent: update log status to "Issued"
3. On quote cancelled: update log status to "Cancelled" — do NOT reuse number
4. On manual correction: require Notes field
```

**Concurrency risk:** Creator Deluge workflows should use record-level locking or serialized execution. Needs testing under concurrent submission. Flag for prototype testing.

---

## Data Model

### Quote_Request

| Field | Type | Required | Notes |
|---|---|---|---|
| Request_ID | Auto number | Yes | Internal ID |
| Quote_Number | Text | No initially | Assigned after approval |
| Customer_Name | Text | Yes | |
| Customer_Email | Email | Optional | |
| Company | Text | Optional | |
| Inquiry_Type | Picklist | Yes | BMS / Battery / Distributor / Other |
| Product_Family | Picklist | Yes | n-BMS / n3-BMS / c-BMS24 / c-BMS24X / i-BMS / Other |
| Request_Source | Picklist | Optional | Manual / Email / CRM / Projects |
| Customer_Currency | Picklist | Yes | USD / DKK / EUR (determines output format) |
| EUR_USD_Rate | Decimal | Yes | Manual entry per quote |
| DKK_USD_Rate | Decimal | Conditional | Required if Customer_Currency = DKK |
| Markup_Rate | Decimal | Yes | Applied to all lines (global per quote) |
| Payment_Terms | Text | Yes | Default: NET 15 |
| Shipping_Terms | Text | Yes | Default: FCA |
| Related_CRM_Record | URL/Text | Optional | |
| Related_Project_Task | URL/Text | Optional | |
| Request_Description | Multiline | Yes | |
| Status | Picklist | Yes | Draft / Pricing / Review / Approved / Sent / Closed |
| Created_By | User | Yes | |
| Created_Time | DateTime | Yes | |

### Items

| Field | Type | Required | Notes |
|---|---|---|---|
| SKU | Text | Yes | Unique — Acme BMS part number |
| Item_Name | Text | Yes | |
| Product_Family | Picklist | Yes | n-BMS / n3-BMS / c-BMS24 / c-BMS24X / i-BMS |
| Category | Picklist | Yes | Hardware / Software / Accessory |
| Sub_Category | Text | Optional | MCU / CMU / Wire Harness / License / Tool / Sensor |
| EUR_Price_1_9 | Currency | Yes | EUR price, 1–9 qty |
| EUR_Price_10_99 | Currency | Yes | |
| EUR_Price_100_249 | Currency | Yes | |
| EUR_Price_250_499 | Currency | Yes | |
| EUR_Price_500_999 | Currency | Yes | |
| EUR_Price_1000_2499 | Currency | Yes | |
| EUR_Price_2500_plus | Currency | Yes | |
| Software_EUR_Price | Currency | Conditional | For software items — separate pricing |
| Distributor_Discount_Eligible | Boolean | Yes | From price list X-flag |
| Active | Boolean | Yes | |
| NPD | Boolean | Yes | Not yet released items |
| Lead_Time_Notes | Text | Optional | e.g., "2–3 weeks" |
| Source_Record_ID | Text | Optional | External sync ID |

### Price_Rules

| Field | Type | Required | Notes |
|---|---|---|---|
| Rule_Name | Text | Yes | |
| Customer_Type | Picklist | Yes | Direct / Distributor / Partner / Internal |
| Distributor_Tier | Picklist | Conditional | Partner / Distributor (if Customer_Type = Distributor/Partner) |
| Product_Category | Picklist | Optional | Hardware / Software — different discount rates |
| Volume_Min | Number | Yes | Lower bound of volume bracket |
| Volume_Max | Number | Yes | Upper bound (use 999999 for open-ended) |
| Discount_Percent | Decimal | Yes | Applied to EUR list price |
| Minimum_Margin_Percent | Decimal | Yes | Margin floor — triggers warning if breached |
| Effective_Start | Date | Optional | |
| Effective_End | Date | Optional | |
| Active | Boolean | Yes | |

### Quote_Lines

| Field | Type | Required | Notes |
|---|---|---|---|
| Quote_Request | Lookup | Yes | Parent quote |
| Item | Lookup | Yes | Selected SKU |
| Quantity | Decimal | Yes | |
| EUR_List_Price | Currency | Yes | Pulled from Items by volume break |
| EUR_USD_Rate | Currency | Yes | Pulled from Quote_Request header |
| Distributor_Discount_Pct | Decimal | Yes | From Price_Rules |
| Markup_Rate | Decimal | Yes | Pulled from Quote_Request header |
| Customer_Unit_Price_USD | Currency | Yes | Calculated |
| DKK_USD_Rate | Decimal | Conditional | If customer currency = DKK |
| Customer_Unit_Price_DKK | Currency | Conditional | Calculated if DKK quote |
| Line_Revenue_USD | Currency | Yes | |
| Unit_Cost_USD | Currency | Yes | From item cost data |
| Line_Cost_USD | Currency | Yes | |
| Gross_Margin_Amount | Currency | Yes | |
| Gross_Margin_Pct | Decimal | Yes | |
| Minimum_Margin_Pct | Decimal | Yes | From Price_Rules |
| Final_Unit_Price | Currency | Yes | max(calculated, minimum_allowed) |
| Margin_Warning | Boolean | Yes | |
| Lead_Time_Notes | Text | Optional | |
| Notes | Multiline | Optional | Override reason |

### Quote_Output

| Field | Type | Required | Notes |
|---|---|---|---|
| Quote_Request | Lookup | Yes | |
| Quote_Number | Text | Yes | From Document_Number_Log |
| Total_Revenue_USD | Currency | Yes | |
| Total_Cost_USD | Currency | Yes | |
| Gross_Margin_Amount | Currency | Yes | |
| Gross_Margin_Pct | Decimal | Yes | |
| FX_Charge_Amount | Currency | Yes | Revenue × 1.5% |
| Wire_Charge_Amount | Currency | Optional | Flat fee, manual entry |
| Net_Net_Profit | Currency | Yes | Margin − fees |
| Approval_Status | Picklist | Yes | Draft / Needs Approval / Approved / Rejected |
| Generated_Document_Link | URL | Optional | |
| WorkDrive_Folder_Link | URL | Optional | |
| Created_By | User | Yes | |
| Created_Time | DateTime | Yes | |

### Document_Type

| Field | Type | Required | Notes |
|---|---|---|---|
| Type_Code | Text | Yes | Unique: QUOTE / SOW |
| Prefix | Text | Yes | e.g., QUOTE or SOW |
| Last_Issued_Number | Number | Yes | Current counter |
| Padding_Length | Number | Yes | Default 4 |
| Include_Year | Boolean | Yes | If true, format = PREFIX-YYYY-NNNN |
| Active | Boolean | Yes | |

### Document_Number_Log

| Field | Type | Required | Notes |
|---|---|---|---|
| Document_Type | Lookup | Yes | QUOTE or SOW |
| Document_ID | Text | Yes | Unique — enforced |
| Sequence_Number | Number | Yes | |
| Status | Picklist | Yes | Reserved / Issued / Cancelled / Voided |
| Requested_By | User/Text | Yes | |
| Requested_Time | DateTime | Yes | |
| Linked_Quote_Request | Lookup | Optional | |
| Linked_Books_Estimate_ID | Text | Optional | |
| Linked_Project_Task_ID | Text | Optional | |
| Linked_WorkDrive_URL | URL | Optional | |
| Notes | Multiline | Optional | Correction reason |

---

## Integration Map

| Source | Target | Data | Method | Required? | Notes |
|---|---|---|---|---|---|
| Quote_Request | Quote_Lines | Exchange rates, markup | Native lookup | Yes | Core app |
| Items | Quote_Lines | EUR price, discount eligibility | Lookup | Yes | Volume break selection logic |
| Price_Rules | Quote_Lines | Discount %, margin floor | Lookup | Yes | By customer type + volume |
| Quote_Lines | Quote_Output | Revenue, cost, margin totals | Deluge rollup | Yes | On line add/edit |
| Document_Type | Document_Number_Log | Next ID counter | Deluge workflow | Yes | Atomic increment |
| Quote_Output | WorkDrive | PDF document | Deluge API (v2) | Optional v1 | Pending WorkDrive access |
| Books | Items | Item/price sync | API import (v2) | Optional | Needs Books org ID |
| Creator | Books Estimate | Push approved quote | API (v2) | Optional | After accounting approval |
| Projects | Document_Number_Log | SOW task link | URL/text (v1) | Optional | Manual link in v1 |

---

## Prototype Build Steps

1. **Inspect reference docs** — ✅ Complete (see Findings section above)
2. **Research Creator capabilities** — ✅ Confirmed sufficient for v1 prototype
3. **Decide Creator vs Forms** — ✅ Creator recommended (see section above)
4. **Create Creator app** `Kinetic_Quote` in Bevco's Zoho One org
5. **Build Document_Type form** — seed with QUOTE and SOW records
6. **Build Document_Number_Log form** — enforce unique Document_ID
7. **Build Items form** — import Acme BMS SKUs via CSV
8. **Build Price_Rules form** — import distributor tier discount data
9. **Build Quote_Request form** — header fields including FX rates and markup
10. **Build Quote_Lines form** — pricing formula in Deluge on submission
11. **Build Quote_Output form** — rollup totals + profit/fee deductions
12. **Build numbering Deluge function** — increment counter + write log
13. **Build margin warning logic** — flag lines below floor
14. **Build Creator reports** — quote view, profit view, log view
15. **Test dry run** — submit a sample quote matching QUOTE0004 pattern
16. **Review with Bill/Brian** — confirm number format, tier, wire charge, markup rate
17. **Do not push to Books or WorkDrive until approved**

---

## Permissions Needed

| Access | Status | Needed For |
|---|---|---|
| Zoho Creator (Bevco org) | Unknown — needs verification | Build the app |
| Zoho Creator admin | Unknown | Create new application |
| Zoho Books access | Unknown | Item/estimate integration (v2) |
| Zoho WorkDrive access | Unknown | Document storage (v2) |
| Acme BMS price list (latest) | Available (local file) | Item import |
| Zoho One plan (Creator included) | Assumed included | Creator is part of ZohoOne |

---

## Risks / Blockers

| Risk | Severity | Notes |
|---|---|---|
| Quote number format mismatch | High | Existing: `QUOTE0004`. Instruction file proposes `QUOTE-YYYY-0001`. Need confirmation. |
| Markup rate unknown | High | `L20` in quote drives all pricing — value not exposed in sanitized output. Need Bill/Brian to confirm. |
| Wire transfer charge amount unknown | Medium | Flat fee present in profit sheet but value not captured. Need amount or formula. |
| Bevco's distributor tier unknown | High | Partner vs Distributor changes discount %. Need confirmation. |
| Software license pricing ambiguity | Medium | `???` flag observed on software line in quote example. Pricing unclear. |
| Concurrent quote submissions | Low | Creator counter increment may have race condition at scale. Low risk for v1 volume. |
| NPD items (CMU18/4) | Low | Not quotable yet — mark as inactive in item master |
| Physics config (CMU qty) | Medium | CMU quantity is variable per system config — needs user-entered "channel count" to calculate |
| FX rates not live | Low | Manual entry per quote acceptable for v1; v2 could pull from API |
| Creator plan limits | Unknown | Verify record/form limits under current Zoho One license |

---

## Open Questions for Bill/Brian

1. Should Quote and SOW numbers use separate sequences? (Observed: they appear separate)
2. What is the required number format — `QUOTE0004` (current) or `QUOTE-2026-0001` (year-based)?
3. What was the last issued Quote number? (Seed the counter)
4. What was the last issued SOW number? (Seed the counter)
5. Are quote numbers assigned before or after customer approval?
6. Should cancelled quotes keep their assigned numbers? (Recommendation: yes, mark Cancelled)
7. Where is the item master today — Books, CRM, spreadsheet, Creator, or other?
8. Who owns item costs and margin rules (who can edit Price_Rules)?
9. What is the minimum acceptable gross margin percent? (Needed for margin floor)
10. What is Bevco's distributor tier with Acme BMS — Partner or Distributor?
11. What is the current markup rate applied to all lines?
12. What is the flat international wire transfer charge per quote?
13. Are distributor discounts fixed by tier/volume, or are they manually approved?
14. Should BMS and Battery quotes use different templates or the same?
15. Should the app create official Zoho Books estimates, or only draft internal quotes (v1)?
16. Should final PDFs be generated in Creator, Books, or manually stored in WorkDrive?
17. Who needs permission to create quotes? Who can approve margin overrides?
18. Is there a cell/channel count field needed to drive CMU quantity in n-BMS configs?
19. Are there other BMS suppliers beyond Acme BMS whose pricing needs to be modeled?
20. How is software license activation handled — does Bevco need to capture customer email per license?

---

## Go / No-Go Recommendation

### Quote App (BI1-T71)

```
Creator can store item/rule tables and generate calculated outputs.
Recommendation: BUILD CREATOR PROTOTYPE
Blocked by: Markup rate, distributor tier, and minimum margin confirmation from Bill/Brian.
```

### Numbering App (BI1-T93)

```
Creator can store persistent records and enforce unique IDs.
Recommendation: BUILD CREATOR NUMBERING APPLET
Blocked by: Quote number format confirmation from Bill/Brian (QUOTE0004 vs QUOTE-YYYY-0001).
```

### Production Deployment

```
Item master, pricing rules, document numbering seed values, and permissions not yet confirmed.
Recommendation: RESEARCH COMPLETE — WAITING ON BUSINESS INPUT BEFORE PRODUCTION BUILD
```

---

## Next Steps

1. Share this research and the follow-up summary with Bill/Brian
2. Get answers to Open Questions 1–5, 10–12 (highest priority blockers)
3. Confirm Creator access in Bevco's Zoho One org
4. Begin Document_Type + Document_Number_Log forms as the numbering prototype (lowest risk, no external dependencies)
5. Import Acme BMS price list into Items form via CSV
6. Validate pricing formula in Creator against QUOTE0004 pattern before adding new quotes
