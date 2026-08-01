# QTS Deluge learning plan — Creator, Flow, CRM, Writer, WorkDrive

**Audience:** Blake  
**Goal:** Learn every Deluge function / workflow that moves a quote from widget → Creator → CRM → PDF/email, in a safe order (cheapest External Calls first), with Deluge taught along the way.

**Everything you need to study is in this one file.** Companion inventory only (action list, not lessons): [`QTS_CREATOR_WORKFLOWS_AND_FUNCTIONS.md`](./QTS_CREATOR_WORKFLOWS_AND_FUNCTIONS.md).

---

## How to use this plan

1. Read **top to bottom** — one lesson at a time. Do not jump to Flow until Lessons 0–4 click.
2. For each function: open the cited `.deluge` beside this doc; skim top → bottom, then re-read the called-out blocks.
3. Scratch note per function: *inputs → side effects → return → who calls me*.
4. Prefer **reading** over live Save/Email while External Calls are tight.
5. Exercises have answers immediately under them — attempt first, then check.

### Twin files (don’t get confused)

| Kind | Folder | Meaning |
| ---- | ------ | ------- |
| Canonical source | `functions/`, `workflows/` | What we edit in git |
| Paste twin | `deploy_ready/*.creator.deluge` | Exact text to paste into Creator |
| Flow CFs | `scripts/zoho_flow/QTS_Saved_Draft_To_Writer/` | Paste into **Flow** custom functions |
| Live-only | `build_quote_merge_payload` | Exists in Flow UI only — **not in this repo** |

---

## Big picture (one mental model)

```
┌─────────────┐     addRecords      ┌────────────────┐
│   Widget    │ ──────────────────► │  CRM_Bridge    │  (Creator form)
│  (JS only)  │     Action_field    │  workflows      │
└─────────────┘                     └───────┬────────┘
                                            │ zoho.crm.* / thisapp.fn_*
                                            ▼
                                    ┌────────────────┐
                                    │ Quote_Request  │
                                    │ Quote_Lines    │
                                    │ Item_Master    │
                                    └───────┬────────┘
                         Status = PDF Filed / Package Requested
                                            │
                                            ▼
                                    ┌────────────────┐
                                    │  Zoho Flow     │
                                    │  build_merge   │──► Writer merge PDF
                                    │  publish_pkg   │──► WorkDrive / CRM / email
                                    └────────────────┘
```

| Product | Runs when | Talks to |
| ------- | --------- | -------- |
| **Creator** | Form workflow / custom function / user input | Creator forms, `zoho.crm.*`, occasional `invokeurl` |
| **Flow** | Trigger on Creator Status | Writer, WorkDrive, CRM attach, `sendmail` via connections |
| **Widget** | JS only | Triggers Deluge via CRM_Bridge + Status writes |

---

## Learning order (do this sequence)

| # | Lesson | App |
| - | ------ | --- |
| 0 | Deluge vocabulary | — |
| 1 | Quote data model + `fn_get_next_number` | Creator |
| 2 | Pricing: tier → discount → calc (+ tier deep dive) | Creator |
| 3 | Line / currency user-input workflows | Creator |
| 4 | Kits | Creator |
| 5 | CRM_Bridge pattern | Creator→CRM |
| 6 | Bridge read path | Creator→CRM |
| 7 | Bridge write path + `fn_sync_to_crm` | Creator→CRM |
| 8 | FX + Sheet | Creator |
| 9 | Legacy PDF / Sign (context) | Creator |
| 10 | Flow canvas + `build_quote_merge_payload` | Flow |
| 11 | Flow helpers | Flow |
| 12 | `publish_quote_package` | Flow |
| 13 | Widget ↔ Deluge contract | JS |

**Skip until later:** Books tax (`get_tax`, `books_diag`), disabled monolith CRM Bridge, `_do_not_paste_for_live_workdrive/*`, `_inline_only_not_separate_flow_cfs/*` (reference after Lesson 12).

---

# Lesson 0 — Deluge vocabulary

### Types

| Type | Example in QTS | Why it matters |
| ---- | -------------- | -------------- |
| `string` | `p_type_code`, `"QUOTE0001"` | IDs, Status, prefixes |
| `int` / `long` | `next_seq`, CRM IDs | Counting, record IDs |
| `decimal` / `float` | money, discount fraction | Prices |
| `bool` | `found`, `send_email` | Branches |
| `Map` | bridge `out`, Flow `result` | JSON-like bags |
| `List` | CRM search rows, `line_items` | Arrays |

### Null-safety (house style)

```deluge
x = ifnull(rec.Prefix1, "").toString().trim();
```

1. `ifnull` — empty → default  
2. `.toString()` — force string  
3. `.trim()` — strip spaces  

### Form query

```deluge
for each rec in Document_Types[Type_Code == p_type_code]
{
	// rec is one matching row
}
```

`Form[Field == value]` is Creator’s filter. Inside the loop, `rec.FieldName` reads/writes that row.

### Call another Creator function

```deluge
thisapp.fn_calc_quote_lines(p_quote_id);
price = thisapp.fn_get_tier_price(part, qty);
```

### CRM (burns External Calls)

```deluge
rec = zoho.crm.getRecordById("Contacts", id);
list = zoho.crm.searchRecords("Products", criteria);
```

### HTTP

```deluge
resp = invokeurl
[
	url :"https://..."
	type :GET
	connection:"flow_to_workdrive_full_access"   // Flow
];
```

### Return shapes

| Pattern | Meaning |
| ------- | ------- |
| `void fn_…` | Side effects only |
| `map` / `Map` | `{status, reason, …}` — Flow helpers |
| `string` / `float` | Scalar helper |

### Function vs workflow

| | Custom function | Form workflow |
| - | --------------- | ------------- |
| Entry | Parameters | `input` = the row |
| Call | `thisapp.fn_name(...)` | Zoho runs on trigger |
| Example | `fn_get_next_number` | `sync_quote_to_crm` bridge |

### Practice

Open [`functions/fn_get_next_number.deluge`](../functions/fn_get_next_number.deluge) and label every type you see (string, bool, int…).

---

# Lesson 1 — Quote data model + numbering

**Code:** [`functions/fn_get_next_number.deluge`](../functions/fn_get_next_number.deluge)  
**Skim:** [`QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md`](./QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md)

### Forms (nouns)

| Form | Role |
| ---- | ---- |
| `Quote_Request` | Header: customer, currency, Status, CRM IDs, Payment_Terms, totals |
| `Quote_Lines` | Lines: SKU, qty, prices, Kit_Warning |
| `Item_Master` | Price book: Part_Number, Price_T1…T9, Tier_Scheme, Discountable |
| `Document_Types` | Prefix + `Last_Sequence` per doc type |
| `Document_Number_Log` | Audit of issued numbers |
| `FX_Rates_Cache` | FX rates for calc |

### Status → Flow

| Status | Button | Flow branch |
| ------ | ------ | ----------- |
| `PDF Filed` | Save Quote Package | `send_email = false` |
| `Package Requested` | Email Quote Package | `send_email = true` |

### Line-by-line: `fn_get_next_number`

```deluge
string fn_get_next_number(string p_type_code)
```

| Lines | What happens | Deluge idea |
| ----- | ------------ | ----------- |
| 1 | Returns a `string` | Return type |
| 3–4 | `found = false`, `doc_num = ""` | Locals |
| 5 | Query `Document_Types` by `Type_Code` | Form criteria |
| 7–8 | `next_seq = Last_Sequence + 1` | `ifnull` + math |
| 9–12 | Build `QUOTE` + 4-digit pad | String concat / `subString` |
| 13 | Write `rec.Last_Sequence` | Mutate row |
| 14–22 | `insert into Document_Number_Log` | Audit row |
| 23 | `break` | First match only |
| 25–28 | Unknown type → `"ERROR:UNKNOWN_TYPE"` | Failure string |
| 29 | Return `doc_num` | Happy path |

**Who calls it?** No repo function writes `Quote_Number` directly — a **live Creator workflow** (outside git) calls this. Readers: `fn_sync_to_crm`, Flow merge, PDF paths.

**External Calls?** No — Creator forms only.

### Exercises

1. If `Last_Sequence` is `25` and `Prefix1` is `QUOTE`, what string is returned?  
2. Name five `Quote_Request` fields the widget cares about.  
3. Does this function spend External Calls? Why?

**Answers:** (1) `QUOTE0026`. (2) e.g. `Status`, `CRM_Deal_ID`, `CRM_Contact_ID`, `Payment_Terms`, `Currency`, `Quote_Number`, `Markup_Rate_Pct`. (3) No — no `zoho.crm.*`.

### Checkpoint

- [ ] `ifnull` + form criteria without notes  
- [ ] Quote_Request vs Quote_Lines vs Item_Master  
- [ ] Walk `fn_get_next_number`  
- [ ] Save vs Email Status values  

---

# Lesson 2 — Pricing cluster (most important)

**Read in order:**

1. [`functions/fn_get_tier_price.deluge`](../functions/fn_get_tier_price.deluge)  
2. [`functions/fn_get_discount.deluge`](../functions/fn_get_discount.deluge)  
3. [`functions/fn_calc_quote_lines.deluge`](../functions/fn_calc_quote_lines.deluge) (+ [`deploy_ready/fn_calc_quote_lines.creator.deluge`](../deploy_ready/fn_calc_quote_lines.creator.deluge))  
4. Skim [`functions/fn_calc_line_price_draft.deluge`](../functions/fn_calc_line_price_draft.deluge)  
5. Then the **Deep dive** section at the end of this lesson  

### Call graph

```
sync_quote_to_crm (bridge)
  → thisapp.fn_calc_quote_lines(quote_id)
       ├─ thisapp.fn_get_tier_price(part, qty)     → list EUR
       ├─ thisapp.fn_get_discount(type, qty, soft) → fraction 0.10
       └─ FX_Rates_Cache + Markup_Rate_Pct
  → thisapp.fn_sync_to_crm(quote_id)   ← Lesson 7
```

### 2a — `fn_get_tier_price(part, qty) → float`

| Idea | Detail |
| ---- | ------ |
| Lookup | `Item_Master[Part_Number == p_part_number]` |
| Tiers | List Price_T1…T9 (index 0–8) |
| Scheme | `hardware` vs `license`; blank → hardware |
| Walk-down | If mapped tier null, try lower indices |
| Sentinel | `-1` = no price (not free) |

Hardware bands (qty → index): ≤19→0, ≤99→1, ≤259→2, … else →8.  
License: ≤1→0 … ≤24→4, else →5.

### 2b — `fn_get_discount(customer_type, qty, is_software) → decimal`

| Idea | Detail |
| ---- | ------ |
| Returns | **Fraction** (10% → `0.10`) |
| Table | `Price_Rules` by Customer_Type, Product_Type, qty band |
| Caller duty | If `Discountable = N`, skip and use 0 |

### 2c — `fn_calc_quote_lines(quote_id) → void`

Odd quote loop (parser house rule):

```deluge
for each quote in Quote_Request
{
	if(quote.ID == quote_id_long) { ... }
}
```

See [`CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md`](./CREATOR_DELUGE_PARSER_COMPATIBILITY_NOTES.md).

**Per line:** Line_Number → resolve part → **preserve** widget price if `PRICE_LOCKED` / `«DISC:` / `«MARGIN:` in Kit_Warning → else tier → discount → FX → totals. Unpriced → `[NO PRICE ON FILE…]`.

### 2d — `fn_calc_line_price_draft`

Same math as a **Map** return (“what would this cost?”) without committing the whole quote.

### Worked example

SKU `100816`, qty `5`, hardware → tier_index **0** (Price_T1). Distributor hardware 1–9 → discount `0.10` if Discountable Y.

### Exercises

1. License SKU qty `10` — which tier_index?  
2. Why is Discountable=N handled by the **caller**, not inside `fn_get_discount`?  
3. What Kit_Warning checks set `preserve_widget_price`?

**Answers:** (1) **4**. (2) Function doesn’t see the SKU row. (3) `PRICE_LOCKED`, `«DISC:`, `«MARGIN:`.

### Checkpoint

- [ ] Call graph calc → tier + discount  
- [ ] `-1` vs `0`  
- [ ] Discount is a fraction  
- [ ] Why loop+if for quote ID  
- [ ] Widget can lock Unit_Price  

---

## Lesson 2 deep dive — `fn_get_tier_price` (annotated)

**Background:** [`TIER_SCHEME_LINE_ITEM_FUNCTIONALITY_AUDIT.md`](./TIER_SCHEME_LINE_ITEM_FUNCTIONALITY_AUDIT.md)

```deluge
float fn_get_tier_price(string p_part_number, int p_qty)
```

**Who calls it:** `fn_calc_quote_lines`, `fn_calc_line_price_draft`, line qty/part workflows.  
**Who does not:** `fn_sync_to_crm`, Flow publish (they use already-calculated money).

1. `tier_price = -1` — start pessimistic  
2. Find Item_Master row; `break` after first  
3. Build `tiers` list T1…T9 (`null` = unpublished)  
4. Scheme: only `hardware` / `license`; else → hardware  
5. Map qty → `tier_index` (bands above)  
6. Walk down while `tiers.get(i) == null`  
7. Return price or leave `-1`  

**Confusions:** `-1` ≠ free; blank scheme ≠ license; this function does **not** discount or write the line.

**Practice:** In Creator Item_Master (read-only), open `100816`, note Tier_Scheme + T1–T3; predict Tn for qty 5 and 100.

---

# Lesson 3 — Line / currency user-input workflows

| Workflow | Path | Trigger | Behavior |
| -------- | ---- | ------- | -------- |
| part_select | [`workflows/on_user_input_quote_lines_part_select.deluge`](../workflows/on_user_input_quote_lines_part_select.deluge) | Part_Select | Autofill description / seed price |
| qty | [`workflows/on_user_input_quote_lines_qty.deluge`](../workflows/on_user_input_quote_lines_qty.deluge) | Qty | Re-price line |
| currency_fx | [`workflows/on_user_input_quote_currency_fx.deluge`](../workflows/on_user_input_quote_currency_fx.deluge) | Currency | Refresh FX on quote |

**Deluge:** `input.Field` = the row being edited (workflows only). Widget does much of this in JS now; still learn for native Creator edits.

---

# Lesson 4 — Kits

| Piece | Path |
| ----- | ---- |
| Resolver | [`functions/fn_get_kit_components.deluge`](../functions/fn_get_kit_components.deluge) |
| Button | [`workflows/expand_kit_button.deluge`](../workflows/expand_kit_button.deluge) |
| Spec | [`PHASE_C_DELUGE_PLAN.md`](./PHASE_C_DELUGE_PLAN.md), [`BMS_KIT_AUTOPOPULATION_SPEC.md`](./BMS_KIT_AUTOPOPULATION_SPEC.md) |

```
Widget expand_kit / Expand_Kit button
  → fn_get_kit_components(kit_key, series_cells)
  → returns components + qtys
  → workflow inserts Quote_Lines
```

**Deluge:** pure Map resolver vs mutating workflow; cell-count bounds; blocked/held components.

---

# Lesson 5 — CRM_Bridge pattern

**Inventory:** [`QTS_CREATOR_WORKFLOWS_AND_FUNCTIONS.md`](./QTS_CREATOR_WORKFLOWS_AND_FUNCTIONS.md)  
**Monolith reference (do not enable):** [`deploy_ready/crm_bridge_on_create.creator.deluge`](../deploy_ready/crm_bridge_on_create.creator.deluge)

```
Widget bridgeCall(action, payload)
  → addRecords(CRM_Bridge, { Action_field, Query_Text, Payload_JSON })
  → Form workflow on Created (one workflow per Action)
  → Result_jSON + Request_Status
  → widget reads CRM_Bridge_Report
```

Live = **split** workflows; monolith **CRM Bridge** stays **Disabled**.

```deluge
action_name = ifnull(input.Action_field, "");
out = Map();
// ... work ...
input.Request_Status = "done";
input.Result_jSON = out.toString();
```

Every `zoho.crm.*` spends External Calls.

---

# Lesson 6 — Bridge read path

Study cheapest → riskiest:

| # | Action | CRM? | Repo |
| - | ------ | ---- | ---- |
| 1 | `get_quote_lines` | No | monolith block |
| 2 | `get_quote_by_number` | No | **live-only gap** |
| 3 | `search_customers` | Yes — 1 OR search | [`deploy_ready/crm_bridge_actions/search_customers.creator.deluge`](../deploy_ready/crm_bridge_actions/search_customers.creator.deluge) |
| 4 | `search_leads` | Yes — batched | [`deploy_ready/crm_bridge_actions/search_leads.creator.deluge`](../deploy_ready/crm_bridge_actions/search_leads.creator.deluge) |
| 5 | `get_customer` / `get_lead` | getRecordById | monolith |
| 6 | `search_deals` / `get_deal` | related / id | monolith |

**Rule:** one OR `searchRecords` ≪ a loop of five searches.

---

# Lesson 7 — Bridge write path + Deal sync

### Thin workflow [`deploy_ready/crm_bridge_actions/sync_quote_to_crm.creator.deluge`](../deploy_ready/crm_bridge_actions/sync_quote_to_crm.creator.deluge)

```deluge
thisapp.fn_calc_quote_lines(quote_id_text);
thisapp.fn_sync_to_crm(quote_id_text);
```

### [`functions/fn_sync_to_crm.deluge`](../functions/fn_sync_to_crm.deluge) (+ deploy twin)

| Responsibility | Notes |
| -------------- | ----- |
| Resolve Contact | May convert Lead |
| Ensure Deal | Amount / Stage |
| Associated Products | Batched Product lookup |
| Not CRM Quotes | Flow email path owns Quotes |
| Write-back | CRM_* IDs on Quote_Request |

---

# Lesson 8 — FX + Sheet

| Function | Path | Role |
| -------- | ---- | ---- |
| `fn_refresh_fx_rates` | [`functions/fn_refresh_fx_rates.deluge`](../functions/fn_refresh_fx_rates.deluge) | FX API → `FX_Rates_Cache` (~1/day) |
| `fn_sync_to_sheet` | [`functions/fn_sync_to_sheet.deluge`](../functions/fn_sync_to_sheet.deluge) | Quote snapshot → Sheet |

---

# Lesson 9 — Legacy PDF / Sign (context only)

| Function | Path |
| -------- | ---- |
| `fn_generate_pdf` | [`functions/fn_generate_pdf.deluge`](../functions/fn_generate_pdf.deluge) |
| `fn_send_to_sign` | [`functions/fn_send_to_sign.deluge`](../functions/fn_send_to_sign.deluge) |

Flow owns live Save/Email publish. Read for merge-field ideas; don’t paste as the live path. See [`WRITER_MERGE_SIGN_R6000_R2011_FINDINGS.md`](./WRITER_MERGE_SIGN_R6000_R2011_FINDINGS.md).

---

# Lesson 10 — Flow canvas + `build_quote_merge_payload`

**Flow:** `QTS Saved Draft To Writer`  
**Repo README:** [`scripts/zoho_flow/QTS_Saved_Draft_To_Writer/README.md`](../scripts/zoho_flow/QTS_Saved_Draft_To_Writer/README.md)

```
Creator Status (PDF Filed | Package Requested)
  → Decision send_email
  → build_quote_merge_payload   ← LIVE ONLY (not in git)
  → publish_quote_package(...)
```

| Key | Correct | Wrong |
| --- | ------- | ----- |
| `line_items` | Array `{name, qty, unit_price, total}` | — |
| Money | `$6,321.84` / `€…` | Raw unformatted only |
| `payment_terms` | From Payment_Terms | Forever hardcoded |
| `line_items_block` | Not in table cells | Text dump in Description |

Sample JSON shape: [`artifacts/qts_writer_fields_sample_v2.json`](../artifacts/qts_writer_fields_sample_v2.json)

**Exercise:** Flow History → count `merge_data.line_items` vs widget lines.

---

# Lesson 11 — Flow helpers

Folder: [`scripts/zoho_flow/QTS_Saved_Draft_To_Writer/`](../scripts/zoho_flow/QTS_Saved_Draft_To_Writer/)

| # | Function | Job |
| - | -------- | --- |
| 1 | `assert_deal_has_products` | Gate: Deal has products |
| 2 | `ensure_deal_contact_link` | Deal ↔ Contact |
| 3 | `workdrive_ensure_quote_folders` | CURRENT / DRAFTS / CONFIRMED |
| 4 | `workdrive_archive_to_drafts` | Prior PDF → DRAFTS |
| 5 | `snapshot_creator_revision` | Best-effort; never hard-blocks |
| 6 | `advance_deal_stage` | → Negotiation/Review (Email only) |

```deluge
result = Map();
result.put("status", "ok");
result.put("reason", "");
return result;
```

| Connection | Use |
| ---------- | --- |
| `flow_to_workdrive_full_access` | WorkDrive |
| `zoho_crm_to_zoho_flow` | CRM notes/attach |
| `writer_to_flow` | Writer merge |

Do **not** paste `_inline_only_not_separate_flow_cfs/` as separate CFs (no File param type).

---

# Lesson 12 — `publish_quote_package`

**File:** [`scripts/zoho_flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge`](../scripts/zoho_flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge)

```deluge
map publish_quote_package(
  deal_id, contact_id, contact_email, merge_data,
  send_email, quote_request_id, cc_email, workdrive_parent_folder_id
)
```

```
validate → dedupe lock note
  → assert products → ensure contact
  → Writer merge (template h5zhu205… = qts_quote_template_v4)
  → WorkDrive CURRENT (+ CONFIRMED if email)
  → archive → Deal PDF attach
  → if send_email: CRM Quote → sendmail → advance stage
```

| `send_email` | Status | Behavior |
| ------------ | ------ | -------- |
| `false` | PDF Filed | Save package; no client email / no stage |
| `true` | Package Requested | Full package + email + stage |

**Why one function?** Flow has no File parameter type — PDF stays local inside the orchestrator.

### Exercises

1. Who calls `fn_calc_quote_lines` on sync?  
2. Why not separate Flow CFs for merge/email?  
3. Live v4 template document id?

**Answers:** (1) `sync_quote_to_crm` workflow. (2) No File param type. (3) `h5zhu2051759ecefd4148816cf61ad65a9cbc`.

---

# Lesson 13 — Widget ↔ Deluge contract

**File:** [`widget/app/widget.js`](../widget/app/widget.js) — search `bridgeCall`, `Status`, `Payment_Terms`, `publishQuote`

| Widget action | Effect |
| ------------- | ------ |
| Search CRM | `search_customers` + `search_leads` |
| Select customer | `get_customer` / `get_lead` |
| Save Quote Package | sync → Status `PDF Filed` → Flow |
| Email Quote Package | sync → Status `Package Requested` → Flow |
| Payment terms | `Payment_Terms` → merge `payment_terms` |
| Margin % | Kit_Warning sidecars; `fn_calc` preserve |

---

# Master cheat sheet

| Concern | Owner |
| ------- | ----- |
| Line prices / tiers | `fn_get_tier_price` + `fn_calc_quote_lines` |
| Kit BOM | `fn_get_kit_components` |
| CRM search | CRM_Bridge actions |
| Deal products | `fn_sync_to_crm` |
| PDF | Flow `publish_quote_package` |
| Merge JSON | Flow `build_quote_merge_payload` (live) |
| WorkDrive | Flow `workdrive_*` |
| Client email | Flow (`send_email=true`) |
| Quote number | `fn_get_next_number` |
| FX cache | `fn_refresh_fx_rates` |

---

# 7-day pace

| Day | Lessons |
| --- | ------- |
| 1 | 0 + 1 + 2a (+ deep dive start) |
| 2 | 2b–2d + 3 |
| 3 | 4–5 |
| 4 | 6–7 (read-heavy) |
| 5 | 8–9 |
| 6 | 10–11 |
| 7 | 12–13 + one Flow History dry-run |

---

# Practice protocol (when External Calls allow)

1. Creator → Usage Details → External Calls  
2. One sacrificial Deal  
3. One Save: widget → sync → Status → Flow History → `publish_quote_package`  
4. `merge_data.line_items` count = widget lines  

---

# Done criteria (you “know” a function when…)

1. Who calls it?  
2. Params / return?  
3. Reads / writes?  
4. External Calls?  
5. What breaks if it fails?  

---

# Appendix — file index

### Creator functions (`functions/`)

`fn_get_next_number`, `fn_get_tier_price`, `fn_get_discount`, `fn_calc_quote_lines`, `fn_calc_line_price_draft`, `fn_get_kit_components`, `fn_sync_to_crm`, `fn_refresh_fx_rates`, `fn_sync_to_sheet`, `fn_generate_pdf`, `fn_send_to_sign`

### Creator workflows

`crm_bridge_on_create` (+ `deploy_ready/crm_bridge_actions/*`), `on_user_input_quote_lines_part_select`, `on_user_input_quote_lines_qty`, `on_user_input_quote_currency_fx`, `expand_kit_button`

### Flow (`scripts/zoho_flow/QTS_Saved_Draft_To_Writer/`)

`assert_deal_has_products`, `ensure_deal_contact_link`, `workdrive_ensure_quote_folders`, `workdrive_archive_to_drafts`, `snapshot_creator_revision`, `advance_deal_stage`, `publish_quote_package`  
Live-only: `build_quote_merge_payload`  
Reference only: `_inline_only_not_separate_flow_cfs/`, `_do_not_paste_for_live_workdrive/`
