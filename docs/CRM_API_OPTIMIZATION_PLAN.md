# CRM API Optimization Plan

**Created:** 2026-07-31  
**Baseline (24h):** ~27,844 API credits  
**Target:** Reduce by 40–60%

## Current Usage Breakdown

| Module | Credits | % of Total | Root Cause |
|--------|---------|------------|------------|
| Leads | ~7,400 | 27% | Broad `starts_with` searches on every keystroke |
| Contacts | ~1,400 | 5% | Duplicate contact checks, address lookups |
| Deals | ~414 | 1.5% | Multiple `getRecordById` for same Deal |
| Products | ~188 | 0.7% | Searches in batches (already optimized) |
| Quotes | ~143 | 0.5% | Search + upsert on every publish |

**Other heavy hitters:**
- Zoho Flow invocations (~1,400+)
- Deduplication race-detection loop (10× GET calls per publish)

---

## Optimization 1: Lead Search Debouncing + Caching

**File:** `crm_bridge_on_create.creator.deluge` (lines 693–743)

**Problem:** Every character typed in the widget's Lead picker fires a CRM search:
```deluge
lead_criteria = "(Email:starts_with:" + query_text + ")or(Last_Name:starts_with:" + query_text + ")..."
found_leads = zoho.crm.searchRecords("Leads", lead_criteria);
```

**Widget-side fix (widget.js):**
```javascript
// Add debounce to lead search input
let leadSearchTimeout = null;
const LEAD_SEARCH_DEBOUNCE_MS = 400;

leadInput.addEventListener('input', () => {
  clearTimeout(leadSearchTimeout);
  leadSearchTimeout = setTimeout(() => {
    const q = leadInput.value.trim();
    if (q.length >= 3) {  // Minimum 3 chars
      searchLeads(q);
    }
  }, LEAD_SEARCH_DEBOUNCE_MS);
});
```

**Server-side improvement:** Cache Lead search results for 60s using Creator's data store or a simple in-memory map per session.

**Estimated savings:** 50–70% of Lead API calls → ~3,700–5,200 credits/day

---

## Optimization 2: Eliminate Redundant Deal Fetches in `publish_quote_package`

**File:** `scripts/zoho_flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge`

**Problem:** Same Deal is fetched 4+ times:
- Line 220: `deal_record = zoho.crm.getRecordById("Deals", ...)`
- Line 540, 618, 824: Conditional refetches

**Fix:** Pass `deal_record` through all helper functions and reuse it:

```deluge
// At line 220 (already done):
deal_record = zoho.crm.getRecordById("Deals", safe_deal_id.toLong());

// Replace lines 540, 618, 824 with:
if(deal_record == null || deal_record.isEmpty())
{
    deal_record = zoho.crm.getRecordById("Deals", safe_deal_id.toLong());
}
// Then always use deal_record, never refetch
```

**Estimated savings:** 2–3 credits per publish × ~50 publishes/day = ~100–150 credits/day

---

## Optimization 3: Remove Race-Detection GET Loop

**File:** `publish_quote_package.deluge` (lines 140–160)

**Problem:** A 10-iteration loop that burns API calls as a "delay":
```deluge
for each delay_tick in delay_ticks
{
    invokeurl
    [
        url :"https://www.zohoapis.com/crm/v2/Deals/" + safe_deal_id + "?fields=id"
        type :GET
        connection:"zoho_crm_to_zoho_flow"
    ];
}
```

**Fix:** Use Deluge's `sleep()` or reduce to 2–3 calls max:

```deluge
// Option A: Use actual delay (if available in Flow context)
// sleep(500); // 500ms delay

// Option B: Reduce to 2 dummy calls max
dummy_delay = invokeurl
[
    url :"https://www.zohoapis.com/crm/v2/Deals/" + safe_deal_id + "?fields=id"
    type :GET
    connection:"zoho_crm_to_zoho_flow"
];
dummy_delay = invokeurl
[
    url :"https://www.zohoapis.com/crm/v2/Deals/" + safe_deal_id + "?fields=id"
    type :GET
    connection:"zoho_crm_to_zoho_flow"
];
```

**Or:** Use a database-backed lock (Creator record) instead of CRM Notes for deduplication.

**Estimated savings:** 8 credits per publish × ~50 publishes/day = ~400 credits/day

---

## Optimization 4: Batch Contact + Account Lookup

**File:** `crm_bridge_on_create.creator.deluge` (`get_customer` action, lines 57–116)

**Problem:** Separate API calls for Contact and Account:
```deluge
contact = zoho.crm.getRecordById("Contacts", contact_id_text.toLong());
// ...
account = zoho.crm.getRecordById("Accounts", account_id_text.toLong());
```

**Fix:** Use COQL or Related Records API to fetch both in one call:
```deluge
// Single COQL query
coql = "SELECT id, Full_Name, Email, Phone, Account_Name.id, Account_Name.Billing_Street, ... FROM Contacts WHERE id = '" + contact_id_text + "'";
result = invokeurl
[
    url :"https://www.zohoapis.com/crm/v5/coql"
    type :POST
    parameters:'{"select_query":"' + coql + '"}'
    connection:"zoho_crm_connection"
];
```

**Estimated savings:** 1 credit per customer lookup × ~200 lookups/day = ~200 credits/day

---

## Optimization 5: Widget-Side Contact/Lead Caching

**File:** `widget/app/widget.js`

**Implementation:**
```javascript
// In-memory cache with TTL
const CRM_CACHE = {
  contacts: new Map(),
  leads: new Map(),
  TTL_MS: 5 * 60 * 1000 // 5 minutes
};

function cacheContact(id, data) {
  CRM_CACHE.contacts.set(id, { data, ts: Date.now() });
}

function getCachedContact(id) {
  const entry = CRM_CACHE.contacts.get(id);
  if (entry && (Date.now() - entry.ts) < CRM_CACHE.TTL_MS) {
    return entry.data;
  }
  return null;
}

// Before calling bridge
async function loadContact(contactId) {
  const cached = getCachedContact(contactId);
  if (cached) return cached;
  
  const result = await CRM_Bridge('get_customer', contactId);
  if (result) cacheContact(contactId, result);
  return result;
}
```

**Estimated savings:** 30–50% of repeated Contact lookups → ~400–700 credits/day

---

## Optimization 6: Product Lookup Pre-Cache

**File:** `fn_sync_to_crm.deluge` (lines 333–385)

**Current state:** Products are searched in batches of 8 (already good).

**Further optimization:** Cache Products in Creator `Item_Master` or a lookup table so we don't hit CRM Products API at all:

```deluge
// Instead of:
product_matches = zoho.crm.searchRecords("Products", product_criteria);

// Use Creator Item_Master which already has Part_Number:
for each item in Item_Master[Part_Number == part_no]
{
    crm_product_id = ifnull(item.CRM_Product_ID, "");
    if(crm_product_id != "")
    {
        product_by_code.put(part_no, crm_product_id);
    }
}
```

**Prerequisite:** Add `CRM_Product_ID` field to `Item_Master` form and populate it once.

**Estimated savings:** 100% of Product searches → ~188 credits/day

---

## Implementation Priority

| Priority | Optimization | Est. Savings | Effort |
|----------|-------------|--------------|--------|
| 🔴 HIGH | 1. Lead search debounce | ~4,000/day | Low (widget change) |
| 🔴 HIGH | 3. Remove race loop | ~400/day | Low (delete code) |
| 🟡 MED | 5. Widget contact cache | ~500/day | Medium |
| 🟡 MED | 2. Reuse Deal record | ~150/day | Low |
| 🟢 LOW | 4. Batch Contact+Account | ~200/day | Medium |
| 🟢 LOW | 6. Product pre-cache | ~188/day | High (schema change) |

**Total estimated savings: ~5,400+ credits/day (19% reduction)**

With Lead debouncing alone, you could save 15–20% of daily API usage.

---

## Quick Wins (< 30 min each)

### Win 1: Lead Search Debounce
Add to `widget.js`:
```javascript
// Top of file
let _leadDebounce = null;

// In searchLeads or wherever lead input is handled
function debouncedLeadSearch(query) {
  clearTimeout(_leadDebounce);
  _leadDebounce = setTimeout(() => {
    if (query.length >= 3) {
      actualLeadSearch(query);
    }
  }, 400);
}
```

### Win 2: Delete Race Loop
In `publish_quote_package.deluge`, replace lines 140–159:
```deluge
// DELETE THIS ENTIRE BLOCK:
// delay_ticks = List();
// delay_ticks.add(1);
// ... (10 items)
// for each delay_tick in delay_ticks { invokeurl... }

// REPLACE WITH (if delay is truly needed):
// Single dummy call is enough for eventual consistency
invokeurl
[
    url :"https://www.zohoapis.com/crm/v2/Deals/" + safe_deal_id + "?fields=id"
    type :GET
    connection:"zoho_crm_to_zoho_flow"
];
```

### Win 3: Minimum Search Length
In `crm_bridge_on_create.creator.deluge`, add minimum length check:
```deluge
// At line 699, before search:
if(query_text.len() < 3)
{
    out.put("lead_matches", List());
    input.Request_Status = "done";
}
else
{
    // existing search logic
}
```

---

## Monitoring

After implementing, monitor API usage at:
- **CRM → Setup → Developer Space → API → API Usage**
- Compare day-over-day to verify savings

Track these metrics:
1. Total daily credits
2. Leads module credits (should drop 50%+)
3. Peak usage hours (should flatten)
