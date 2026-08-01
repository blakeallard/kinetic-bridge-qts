# QTS Bryan meeting backlog — 2026-07-30

Parent plan: [`QTS_TWO_BUTTON_CRM_PLAN.md`](./QTS_TWO_BUTTON_CRM_PLAN.md) (Stages 6–10).  
Stage 5 paste/verify (still first): [`QTS_TOMORROW_PASTE_CHECKLIST.md`](./QTS_TOMORROW_PASTE_CHECKLIST.md).

Sources: Blake notes from meeting with Bryan; vendor workbook legend verified in-repo.

---

## Locked product decisions

| Topic | Locked value |
| ----- | ------------ |
| **Margin** | Company profit **markup** % (facilitate / consult the deal) — not cost-based gross margin |
| **Disc %** | **Keep** existing column (incentive discounts for legacy→new swaps, etc.) |
| **Header Margin** | Editable in column header; applying a % sets **all current lines’ Margin %** |
| **Per-line Margin** | Editable; changes **only that line** |
| **Base / “original” price** | Item Master **list** (EUR tier → USD via FX cache) |
| **Sale formula** | `Sale_USD = round(List_EUR × usdPerEur × (1 − Disc%/100) × (1 + Margin%/100), 2)` |
| **Manual Sale** | Existing price-lock stays; locked lines skip auto recompute until unlocked |
| **Item Master X** | Vendor legend: **X = can be discounted** → `Discountable=Y` |
| **Daily FX** | Schedule `fn_refresh_fx_rates` once/day (~1 External Call) — **approved as cost-efficient** |

### Vendor source of truth (Discountable)

Workbook:  
`/Users/blakeallard/bevco/data/references/lithium_balance/BMS Pricelist/Acme BMS BMS_July 01_RSP_Distributor.xlsx`

- Sheet **`Distrib discount`** cell A1: *“Discount to RSP on products marked with X (N column in RSP sheet)”*
- Sheet **`RSP_EUR`**: DISTRIB DISCOUNT column carries the `X` markers
- Same sheet holds Partner / Distributor % bands (HW volume + Software flat)

Round 80 import (`import_preview/generate_preview.py`) currently maps `X` → `Discountable=N` — **inverted**. Runtime Deluge/widget already honor `Y`/`N` correctly; fix import + re-seed data.

---

## Stage order

```text
Stage 5  paste + E2E (External Calls headroom)
    ↓
Stage 7  Discountable polarity  +  Stage 9  daily FX schedule
    ↓
Stage 6  Margin column (widget + persist)
    ↓
Stage 8  company-name CRM search
    ↓
Stage 10 Item Master spreadsheet revamp (above & beyond)
```

---

## Stage 6 — Margin % column

### Behavior

1. Widget quote grid gains a **Margin %** column beside **Disc %**.
2. Header Margin input → set every line’s `marginPct` → recompute Sale from list.
3. Per-line Margin → only that row.
4. Disc % unchanged (independent incentive lever).

### Build surfaces (when implementing)

| Piece | Path |
| ----- | ---- |
| Widget UI | `widget/app/widget.html` |
| Widget logic | `widget/app/widget.js` |
| Packbay mirror (if kept in sync) | `widget/app/widget.packbay.html`, `artifacts/qts-widget-ui-packbay/` |
| Creator line calc | `deploy_ready/creator/workflow/functions/fn_calc_quote_lines.creator.deluge` ← paste to function `fn_calc_quote_lines` |
| Source twin | `functions/fn_calc_quote_lines.deluge` |

### Persist

- Carry `marginPct` (and Disc %) in quote payload / Creator fields so reload does not zero them.
- Save-time calc must not wipe widget Disc/Margin; honor stored fields or price-lock.

### Verify

| Step | Expect |
| ---- | ------ |
| Header Margin = 15 | All unlocked lines: sale = list×FX×(1−disc)×1.15 |
| One line Margin = 10 | Only that line uses 1.10; others stay 15 |
| Change Disc % | Price moves with disc; margin still applied |
| Manual Sale lock | Auto margin/disc recompute skipped for that line |

---

## Stage 7 — Discountable polarity fix

### Code / data

| Piece | Path / target |
| ----- | ------------- |
| Import mapping | `import_preview/generate_preview.py` — flip X→Y, default N |
| Preview CSV | `import_preview/item_master_import_preview.csv` (regenerate) |
| Report | `import_preview/import_preview_report.md` |
| Live Creator | Form **Item_Master** field **Discountable** — re-import / bulk update |
| Runtime (no polarity change) | `fn_get_discount`, `fn_calc_quote_lines` — already gate on `Y` |

### Verify

- SKUs with workbook `X` → `Discountable=Y` and receive Partner/Distributor % when Customer_Type matches.
- Non-X accessories → `N`, discount 0 unless overridden.
- Confirm `200001` override still desired under corrected rule.

---

## Stage 8 — Search by company (Leads / Deals / Contacts)

### Today

| Action | Company search? |
| ------ | --------------- |
| `search_leads` | Yes — `Company:starts_with` |
| `search_customers` | No — name/email only (Account display-only) |
| Deals in main bar | No — related records after contact/account select |

### Build surfaces (when implementing)

| Piece | Path | Creator / CRM target |
| ----- | ---- | -------------------- |
| Contact/company search | `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_customers.creator.deluge` | Workflow **CRM Bridge - search_customers** |
| Leads (keep/extend) | `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_leads.creator.deluge` | Workflow **search_leads** |
| Deal text search | new bridge action or extend monolith blocks in `deploy_ready/crm_bridge_on_create.creator.deluge` | New/updated **search_deals** (or company deal search) workflow |
| Widget merge/UI | `widget/app/widget.js`, `widget/app/widget.html` | Rebuild/upload widget ZIP |

Keep External Calls cheap: batched OR criteria, no per-result CRM loops.

---

## Stage 9 — Daily FX cache refresh

### Existing function (no rewrite required for MVP)

| Repo file | Creator target |
| --------- | -------------- |
| [`functions/fn_refresh_fx_rates.deluge`](../functions/fn_refresh_fx_rates.deluge) | Function **`fn_refresh_fx_rates`** |

- 1× `invokeurl` → `https://open.er-api.com/v6/latest/USD`
- Upserts EUR, GBP, CAD, AUD, JPY, CNY, KRW, DKK into **FX_Rates_Cache**
- Cost: **~1 External Call / day** if scheduled once — approved

### Blake actions (Zoho UI — no paste if function already live)

1. Creator → **Workflows → Schedules** (or equivalent) → daily job calling `fn_refresh_fx_rates`.
2. Optional now: **run function once manually** to refresh stale rates before pricing QA.

### Doc note (corrected 2026-07-30)

Older runbooks claimed DKK was missing from `fn_refresh_fx_rates`. That is **false** — the function already upserts DKK. Stale checklist items in `TIER_SCHEME_CREATOR_DEPLOYMENT_RUNBOOK.md` and `QUOTE_FORM_FIELD_DEPENDENCY_AUDIT.md` were corrected.

---

## Stage 10 — Item Master spreadsheet revamp (above & beyond)

**Intent:** Creator Item_Master is already becoming the better operational source. Rebuild the **vendor/ops workbook** so it is efficient, intuitive, and aligned with:

- Correct DISTRIB DISCOUNT / X semantics and Partner/Distributor bands
- Creator Item_Master fields (tiers, Discountable, kit flags, currency)
- Kit config sheets reconciled with live `Kit_Components` (42-row BOM era)
- Clear change log / revision discipline (replace opaque multi-tab RSP layout)

**Deliverable (when implemented):** new workbook under something like `artifacts/item_master_workbook_revamp/` + short design note; import path updated to read the new layout.  
**Not** a replacement for Creator as quote-time system of record.

---

## Paste / replace map — ready now vs later

### Ready now (Stage 5 — do first)

See [`QTS_TOMORROW_PASTE_CHECKLIST.md`](./QTS_TOMORROW_PASTE_CHECKLIST.md).

| Repo file | Paste into |
| --------- | ---------- |
| `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_customers.creator.deluge` | Creator workflow **CRM Bridge - search_customers** |
| `deploy_ready/creator/workflow/form_workflows/crm_bridge/search_leads.creator.deluge` | Creator workflow **search_leads** |
| `deploy_ready/creator/workflow/functions/fn_sync_to_crm.creator.deluge` | Creator function **`fn_sync_to_crm`** |
| `deploy_ready/flow/QTS_Saved_Draft_To_Writer/*.deluge` helpers | Zoho Flow custom functions (same names) |
| `deploy_ready/flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge` | Flow **`publish_quote_package`** — paste **last** |

Do **not** paste: `generate_and_file_quote_document.deluge` / `.COMPAT.deluge` for live WorkDrive; do **not** re-paste disabled monolith CRM Bridge or `sync_quote_to_crm` unless that action itself changes.

### Ready now (Stage 9 — schedule only)

| Repo file | Where |
| --------- | ----- |
| `functions/fn_refresh_fx_rates.deluge` | Creator function **`fn_refresh_fx_rates`** (paste only if live copy drifts) + **daily Schedule** |

### Not built yet (Stages 6–8, 10) — paste targets after implementation

| Stage | Will produce / touch | Paste / deploy target |
| ----- | -------------------- | --------------------- |
| 6 | Updated `widget/` ZIP; possibly `fn_calc_quote_lines` | Creator widget upload; function **`fn_calc_quote_lines`** |
| 7 | Regenerated import CSV + Item_Master updates | Creator **Item_Master** import / field update (not a Deluge paste) |
| 8 | Updated `search_customers` / `search_leads` / deal search + widget | Same Creator workflows + widget ZIP |
| 10 | New workbook under `artifacts/` | Ops/vendor file + import script path — not a Creator function paste |
