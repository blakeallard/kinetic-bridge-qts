# Creator App Schema — Kinetic_Quote

App name: `Kinetic_Quote`
Platform: Zoho Creator (Zoho One Enterprise)
Version: v1 prototype

---

## App Structure Overview

```
Kinetic_Quote
├── Forms (7)
│   ├── Quote_Request
│   ├── Items
│   ├── Price_Rules
│   ├── Quote_Lines
│   ├── Quote_Output
│   ├── Document_Type
│   └── Document_Number_Log
└── Reports (5)
    ├── Active_Quotes
    ├── Quote_Line_Detail
    ├── Profit_Summary
    ├── Document_Log_Report
    └── Items_Master_View
```

---

## Form 1: Quote_Request

**Purpose:** Captures the incoming quote inquiry. The header record for all line items and the output.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Request_ID | Auto Number | Yes | Auto | Internal ID |
| Quote_Number | Single Line | No | Blank | Populated after number assignment |
| Customer_Name | Single Line | Yes | — | |
| Customer_Email | Email | No | — | |
| Company | Single Line | No | — | |
| Inquiry_Type | Dropdown | Yes | — | Values: BMS, Battery, Distributor, Other |
| Product_Family | Dropdown | Yes | — | Values: n-BMS, n3-BMS, c-BMS24, c-BMS24X, i-BMS, Mixed, Other |
| Customer_Currency | Dropdown | Yes | USD | Values: USD, DKK, EUR |
| EUR_USD_Rate | Decimal | Yes | — | Manual entry. EUR → USD exchange rate |
| DKK_USD_Rate | Decimal | Conditional | — | Required if Customer_Currency = DKK |
| Markup_Rate | Decimal | Yes | — | Bevco markup applied to all lines (e.g., 0.20 = 20%) |
| Payment_Terms | Single Line | Yes | NET 15 | Default matches observed |
| Shipping_Terms | Single Line | Yes | FCA | Default matches observed |
| Wire_Charge_Amount | Currency | No | 0 | Flat international wire transfer fee (amount TBD from Bill/Brian) |
| Request_Source | Dropdown | No | Manual | Values: Manual, Email, CRM, Projects |
| Related_CRM_Record | URL | No | — | Link only |
| Related_Project_Task | URL | No | — | Link only |
| Request_Description | Multi Line | Yes | — | User notes / inquiry details |
| Status | Dropdown | Yes | Draft | Values: Draft, Pricing, Review, Approved, Sent, Closed |
| Created_By | Name | Yes | Current user | Auto |
| Created_Time | Date-Time | Yes | Current time | Auto |

**Validation rules:**
- `EUR_USD_Rate` must be > 0
- `DKK_USD_Rate` must be > 0 if `Customer_Currency = DKK`
- `Markup_Rate` must be >= 0 and <= 1
- `Status` transition from Approved → triggers document number assignment workflow

**Lookup relationships:**
- One-to-many with Quote_Lines (via Request_ID)
- One-to-one with Quote_Output (via Request_ID)
- One-to-one with Document_Number_Log (via Quote_Number)

---

## Form 2: Items

**Purpose:** Item master — stores Lithium Balance SKUs and EUR list prices at each volume break.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| SKU | Single Line | Yes | — | Unique. Lithium Balance part number |
| Item_Name | Single Line | Yes | — | Full product name |
| Product_Family | Dropdown | Yes | — | Values: n-BMS, n3-BMS, c-BMS24, c-BMS24X, i-BMS |
| Category | Dropdown | Yes | — | Values: Hardware, Software, Accessory |
| Sub_Category | Single Line | No | — | MCU, CMU, Wire Harness, Creator License, Service Tool, Sensor, Adapter |
| EUR_Price_1_9 | Currency | Yes | — | EUR, qty 1–9 |
| EUR_Price_10_99 | Currency | Yes | — | EUR, qty 10–99 |
| EUR_Price_100_249 | Currency | Yes | — | EUR, qty 100–249 |
| EUR_Price_250_499 | Currency | Yes | — | EUR, qty 250–499 |
| EUR_Price_500_999 | Currency | Yes | — | EUR, qty 500–999 |
| EUR_Price_1000_2499 | Currency | Yes | — | EUR, qty 1,000–2,499 |
| EUR_Price_2500_plus | Currency | Yes | — | EUR, qty 2,500+ |
| Software_EUR_Price | Currency | Conditional | — | For software items — separate discount/pricing |
| Distributor_Discount_Eligible | Checkbox | Yes | true | From price list X-flag |
| Active | Checkbox | Yes | true | Hide inactive items from quote selection |
| NPD | Checkbox | Yes | false | Not yet released — block from quoting |
| Lead_Time_Notes | Single Line | No | — | e.g., "2–3 weeks" |
| Source_Record_ID | Single Line | No | — | External sync ID |

**Validation rules:**
- `SKU` must be unique across all Items records
- `NPD = true` blocks item from appearing in Quote_Lines lookup
- All EUR price fields must be > 0

**Helper function (Deluge — for Quote_Lines):**
```
function getEURPrice(sku, qty) {
  item = Items[SKU == sku];
  if (qty < 10) return item.EUR_Price_1_9;
  if (qty < 100) return item.EUR_Price_10_99;
  if (qty < 250) return item.EUR_Price_100_249;
  if (qty < 500) return item.EUR_Price_250_499;
  if (qty < 1000) return item.EUR_Price_500_999;
  if (qty < 2500) return item.EUR_Price_1000_2499;
  return item.EUR_Price_2500_plus;
}
```

**Sample sanitized records (structure only):**

| SKU | Item_Name | Family | Category | Sub_Category | EUR_1_9 | Discount_Eligible | Active |
|---|---|---|---|---|---|---|---|
| [part#] | n-BMS MCU – Master Control Unit | n-BMS | Hardware | MCU | [numeric EUR] | true | true |
| [part#] | n-BMS CMU 12/2 – top mount isoSPI | n-BMS | Hardware | CMU | [numeric EUR] | true | true |
| [part#] | n-BMS CMU 12/2 wire harness kit | n-BMS | Accessory | Wire Harness | [numeric EUR] | false | true |
| [part#] | n-BMS wire harness kit for MCU | n-BMS | Accessory | Wire Harness | [numeric EUR] | false | true |
| [part#] | n-BMS Creator License FULL | n-BMS | Software | Creator License | — | true | true |
| [part#] | n-BMS Service Tool | n-BMS | Software | Service Tool | — | true | true |
| [part#] | Peak CAN adapter | n-BMS | Accessory | Adapter | [numeric EUR] | false | true |

---

## Form 3: Price_Rules

**Purpose:** Stores discount percentages and margin floors by customer type, tier, and volume.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Rule_Name | Single Line | Yes | — | Human-readable label |
| Customer_Type | Dropdown | Yes | — | Values: Direct, Distributor, Partner, Internal |
| Distributor_Tier | Dropdown | Conditional | — | Values: Partner, Distributor (if Customer_Type = Distributor/Partner) |
| Product_Category | Dropdown | No | — | Values: Hardware, Software, All |
| Volume_Min | Number | Yes | 0 | Inclusive lower bound |
| Volume_Max | Number | Yes | 999999 | Inclusive upper bound |
| Discount_Percent | Decimal | Yes | 0 | Applied to EUR list price (e.g., 0.30 = 30%) |
| Minimum_Margin_Percent | Decimal | Yes | — | Margin floor — triggers warning (e.g., 0.25 = 25%) |
| Effective_Start | Date | No | — | |
| Effective_End | Date | No | — | |
| Active | Checkbox | Yes | true | |

**Validation rules:**
- `Discount_Percent` must be >= 0 and < 1
- `Minimum_Margin_Percent` must be >= 0 and < 1
- `Volume_Min` <= `Volume_Max`
- Only one active rule should match a given customer_type + tier + volume + category combination

**Sample sanitized records (structure only — actual percentages TBD from Bill/Brian):**

| Rule_Name | Customer_Type | Tier | Category | Vol_Min | Vol_Max | Discount% | Min_Margin% |
|---|---|---|---|---|---|---|---|
| Partner HW 1-9 | Partner | Partner | Hardware | 1 | 9 | [%] | [%] |
| Partner HW 10-99 | Partner | Partner | Hardware | 10 | 99 | [%] | [%] |
| Distributor HW 1-9 | Distributor | Distributor | Hardware | 1 | 9 | [%] | [%] |
| Distributor SW | Distributor | Distributor | Software | 1 | 999999 | [%] | [%] |
| Direct | Direct | — | All | 1 | 999999 | 0% | [%] |

---

## Form 4: Quote_Lines

**Purpose:** Individual line items on a quote. Pricing is calculated by Deluge on submission.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Quote_Request | Lookup (Quote_Request) | Yes | — | Parent quote |
| Item | Lookup (Items) | Yes | — | Selected SKU |
| Quantity | Decimal | Yes | — | Must be > 0 |
| EUR_List_Price | Currency | Yes | Auto-filled | Pulled from Items via volume break lookup |
| EUR_USD_Rate | Decimal | Yes | Auto-filled | From Quote_Request.EUR_USD_Rate |
| DKK_USD_Rate | Decimal | Conditional | Auto-filled | From Quote_Request.DKK_USD_Rate |
| Distributor_Discount_Pct | Decimal | Yes | Auto-filled | From Price_Rules lookup |
| Markup_Rate | Decimal | Yes | Auto-filled | From Quote_Request.Markup_Rate |
| Customer_Unit_Price_USD | Currency | Yes | Calculated | Core pricing formula |
| Customer_Unit_Price_DKK | Currency | Conditional | Calculated | If Customer_Currency = DKK |
| Minimum_Allowed_Price | Currency | Yes | Calculated | = unit_cost / (1 - min_margin) |
| Final_Unit_Price_USD | Currency | Yes | Calculated | max(customer_price, minimum_allowed) |
| Line_Revenue_USD | Currency | Yes | Calculated | Final_Unit_Price × Quantity |
| Unit_Cost_USD | Currency | Yes | — | From item cost (requires DKK cost data) |
| Line_Cost_USD | Currency | Yes | Calculated | Unit_Cost × Quantity |
| Gross_Margin_Amount | Currency | Yes | Calculated | Revenue - Cost |
| Gross_Margin_Pct | Decimal | Yes | Calculated | Margin / Revenue |
| Minimum_Margin_Pct | Decimal | Yes | Auto-filled | From Price_Rules |
| Margin_Warning | Checkbox | Yes | Calculated | true if margin < floor |
| Lead_Time_Notes | Single Line | No | Auto-filled | From Items.Lead_Time_Notes |
| Notes | Multi Line | No | — | Override reason |

**Deluge — on Quote_Line submit:**
```
quote = Quote_Request[ID == input.Quote_Request];
item = Items[SKU == input.Item.SKU];
qty = input.Quantity;

// Volume break price
eur_price = getEURPrice(item.SKU, qty);

// Exchange rates and markup from parent quote
eur_usd = quote.EUR_USD_Rate;
markup = quote.Markup_Rate;

// Discount lookup
rule = Price_Rules[
  Customer_Type == quote.Customer_Type
  && Volume_Min <= qty
  && Volume_Max >= qty
  && Active == true
][0];
discount_pct = rule.Discount_Percent;
min_margin_pct = rule.Minimum_Margin_Percent;

// Core pricing formula
raw_price = (eur_price * eur_usd * (1 - discount_pct)) * (1 + markup);

// Minimum price guard
min_price = input.Unit_Cost_USD / (1 - min_margin_pct);
final_price = if(raw_price < min_price) min_price else raw_price;

// Calculated fields
line_revenue = final_price * qty;
line_cost = input.Unit_Cost_USD * qty;
margin_amt = line_revenue - line_cost;
margin_pct = margin_amt / line_revenue;
margin_warn = margin_pct < min_margin_pct;

// Update record
input.EUR_List_Price = eur_price;
input.EUR_USD_Rate = eur_usd;
input.Distributor_Discount_Pct = discount_pct;
input.Markup_Rate = markup;
input.Customer_Unit_Price_USD = raw_price;
input.Minimum_Allowed_Price = min_price;
input.Final_Unit_Price_USD = final_price;
input.Line_Revenue_USD = line_revenue;
input.Line_Cost_USD = line_cost;
input.Gross_Margin_Amount = margin_amt;
input.Gross_Margin_Pct = margin_pct;
input.Minimum_Margin_Pct = min_margin_pct;
input.Margin_Warning = margin_warn;
```

**Note:** `Unit_Cost_USD` is currently a manual entry field for v1. In v2, this would be auto-populated from the DKK cost data (from distributor invoice / price list). The observed formula was: `unit_cost_usd = dkk_line_cost / qty / dkk_usd_rate`. This requires the DKK cost data from the distributor invoice, which is not in the price list — confirm source with Bill/Brian.

---

## Form 5: Quote_Output

**Purpose:** Final summary per quote including totals, profit, fees, and document links.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Quote_Request | Lookup (Quote_Request) | Yes | — | |
| Quote_Number | Single Line | Yes | — | From Document_Number_Log |
| Total_Revenue_USD | Currency | Yes | Calculated | Sum of Quote_Lines.Line_Revenue_USD |
| Total_Cost_USD | Currency | Yes | Calculated | Sum of Quote_Lines.Line_Cost_USD |
| Gross_Margin_Amount | Currency | Yes | Calculated | Revenue - Cost |
| Gross_Margin_Pct | Decimal | Yes | Calculated | Margin / Revenue |
| FX_Charge_Amount | Currency | Yes | Calculated | Total_Revenue × 0.015 |
| Wire_Charge_Amount | Currency | No | 0 | From Quote_Request.Wire_Charge_Amount |
| Total_Fees | Currency | Yes | Calculated | FX + Wire |
| Net_Net_Profit | Currency | Yes | Calculated | Gross_Margin - Total_Fees |
| Has_Margin_Warnings | Checkbox | Yes | Calculated | true if any line has Margin_Warning |
| Approval_Status | Dropdown | Yes | Draft | Values: Draft, Needs Approval, Approved, Rejected |
| Generated_Document_Link | URL | No | — | WorkDrive or Books link |
| WorkDrive_Folder_Link | URL | No | — | Storage location |
| Created_By | Name | Yes | Auto | |
| Created_Time | Date-Time | Yes | Auto | |

**Workflow rule — on all Quote_Lines saved:**
- Recalculate Quote_Output totals (Deluge aggregate across lines)

---

## Form 6: Document_Type

**Purpose:** Defines numbering sequences for QUOTE and SOW.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Type_Code | Single Line | Yes | — | Unique. Values: QUOTE, SOW |
| Prefix | Single Line | Yes | — | e.g., QUOTE or SOW |
| Last_Issued_Number | Number | Yes | 0 | Current counter — incremented atomically |
| Padding_Length | Number | Yes | 4 | Number of digits (zero-padded) |
| Include_Year | Checkbox | Yes | false | If true: PREFIX-YYYY-NNNN; if false: PREFIXNNNN |
| Active | Checkbox | Yes | true | Only active sequences used |

**Seed records (pending Bill/Brian confirmation of last issued numbers):**

| Type_Code | Prefix | Last_Issued_Number | Padding | Include_Year |
|---|---|---|---|---|
| QUOTE | QUOTE | 4 | 4 | false |
| SOW | SOW | 0 | 4 | false |

> Note: `Last_Issued_Number` for QUOTE seeded to 4 based on `QUOTE0004` being the most recent observed quote. Confirm actual last number with Bill/Brian before setting.

---

## Form 7: Document_Number_Log

**Purpose:** Permanent audit log of every document number issued, reserved, or cancelled.

| Field Name | Creator Field Type | Required | Default | Notes |
|---|---|---|---|---|
| Document_Type | Lookup (Document_Type) | Yes | — | QUOTE or SOW |
| Document_ID | Single Line | Yes | — | Unique. e.g., QUOTE0005 |
| Sequence_Number | Number | Yes | — | Numeric part only |
| Status | Dropdown | Yes | Reserved | Values: Reserved, Issued, Cancelled, Voided |
| Requested_By | Single Line | Yes | Auto | Current user |
| Requested_Time | Date-Time | Yes | Auto | |
| Linked_Quote_Request | Lookup (Quote_Request) | No | — | |
| Linked_Books_Estimate_ID | Single Line | No | — | |
| Linked_Project_Task_ID | Single Line | No | — | |
| Linked_WorkDrive_URL | URL | No | — | |
| Notes | Multi Line | No | — | Correction/cancellation reason |

**Validation rules:**
- `Document_ID` must be unique across all records — enforced by Creator unique field constraint
- Status transitions: Reserved → Issued (allowed) / Reserved → Cancelled (allowed) / Issued → Voided (allowed with Notes) / Cancelled → any (blocked)
- Once Issued or Voided, the number is permanently locked

**Deluge — document number generation function:**
```
function issueDocumentNumber(type_code, quote_request_id) {
  doc_type = Document_Type[Type_Code == type_code && Active == true][0];
  next_num = doc_type.Last_Issued_Number + 1;
  
  // Format the ID
  padded = right(("0000" + next_num.toString()), doc_type.Padding_Length);
  if (doc_type.Include_Year) {
    year = zoho.currentdate.getYear().toString();
    doc_id = doc_type.Prefix + "-" + year + "-" + padded;
  } else {
    doc_id = doc_type.Prefix + padded;
  }
  
  // Collision check (should not occur if counter is properly managed)
  existing = Document_Number_Log[Document_ID == doc_id];
  if (existing.size() > 0) {
    return "ERROR: Collision detected on " + doc_id;
  }
  
  // Write log record
  log_record = map();
  log_record.put("Document_Type", doc_type.ID);
  log_record.put("Document_ID", doc_id);
  log_record.put("Sequence_Number", next_num);
  log_record.put("Status", "Reserved");
  log_record.put("Requested_By", zoho.loginuserid);
  log_record.put("Requested_Time", zoho.currenttime);
  log_record.put("Linked_Quote_Request", quote_request_id);
  zoho.creator.addRecord("Kinetic_Quote", "Document_Number_Log", log_record);
  
  // Increment counter
  doc_type.Last_Issued_Number = next_num;
  
  return doc_id;
}
```

---

## Reports

### 1. Active_Quotes
- Source: Quote_Request
- Filter: Status IN (Draft, Pricing, Review, Approved)
- Columns: Request_ID, Company, Customer_Name, Inquiry_Type, Product_Family, Status, Created_Time, Quote_Number
- Sort: Created_Time DESC

### 2. Quote_Line_Detail
- Source: Quote_Lines
- Filter: none (all lines)
- Columns: Quote_Request, Item.SKU, Item.Item_Name, Quantity, Final_Unit_Price_USD, Line_Revenue_USD, Gross_Margin_Pct, Margin_Warning
- Conditional highlight: Margin_Warning = true → red row
- Group by: Quote_Request

### 3. Profit_Summary
- Source: Quote_Output
- Filter: Approval_Status != Draft
- Columns: Quote_Number, Company (via Quote_Request), Total_Revenue_USD, Gross_Margin_Pct, FX_Charge_Amount, Wire_Charge_Amount, Net_Net_Profit, Has_Margin_Warnings
- Sort: Created_Time DESC
- Note: internal view only — restrict to admin/manager role

### 4. Document_Log_Report
- Source: Document_Number_Log
- Filter: none (all records)
- Columns: Document_ID, Document_Type.Type_Code, Status, Requested_By, Requested_Time, Linked_Quote_Request, Notes
- Search by: Document_ID, Requested_By, Status, date range
- Sort: Requested_Time DESC

### 5. Items_Master_View
- Source: Items
- Filter: Active = true
- Columns: SKU, Item_Name, Product_Family, Category, EUR_Price_1_9, EUR_Price_10_99, Distributor_Discount_Eligible, NPD, Lead_Time_Notes
- NPD items highlighted in orange
- Export to CSV available

---

## Automation / Workflow Rules

| Trigger | Action | Notes |
|---|---|---|
| Quote_Lines — On Submit | Run pricing Deluge | Fills calculated fields |
| Quote_Lines — On Submit | Update Quote_Output totals | Recalculate revenue/cost/margin |
| Quote_Request — Status changes to Approved | Run issueDocumentNumber("QUOTE", ID) | Assigns QUOTE#### |
| Quote_Output — Has_Margin_Warnings = true | Alert Created_By | Notify of margin issue |
| Document_Number_Log — Status changes to Issued | Update Quote_Request.Quote_Number | Sync number to parent |

---

## Notes / Constraints

- **Unit cost source:** The `Unit_Cost_USD` field in Quote_Lines is a manual entry in v1. In v2, this should be derived from distributor invoices or a cost table. The observed pattern was: DKK cost per line (from invoice) ÷ quantity ÷ DKK-USD rate = USD unit cost.
- **CMU quantity physics:** For n-BMS quotes, the number of CMU modules (1–30) depends on the customer's cell count and voltage config. A `System_Config_Notes` field or a separate `BMS_Config` form may be needed in v2 to handle this.
- **Software license notes:** Software line items require customer email/user ID for activation — the `Notes` field on Quote_Lines is the capture point for v1. A dedicated field may be needed.
- **NPD items blocked:** Items with `NPD = true` must be excluded from the Quote_Lines item lookup dropdown.
- **FX rate freshness:** Exchange rates are manually entered per quote in v1. A date field or "rate as of" label should be shown to the user to remind them to verify current rates.
