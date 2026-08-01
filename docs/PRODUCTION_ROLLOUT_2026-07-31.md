# QTS Production Rollout + API Optimization Deploy — 2026-07-31

Ordered checklist. All Creator edits happen in the **Development** environment first;
step 6 publishes everything to Production in one shot. Zoho Flow (step 7) is separate
from Creator environments and is pasted directly.

**Repo root:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations`

---

## Step 1 — Paste: search_customers (Creator, Development)

- **File:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflows/crm_bridge/search_customers.creator.deluge`
- **Where in Zoho:** Creator → QTS (Edit, Development) → **Workflow** tab → Form workflows → CRM_Bridge form → workflow **"CRM Bridge - search_customers"** → open its 1 Action → select-all, replace entire script → Save.

## Step 2 — Paste: search_leads (Creator, Development)

- **File:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/workflows/crm_bridge/search_leads.creator.deluge`
- **Where in Zoho:** same Workflow tab → workflow **"search_leads"** → open its 1 Action → replace entire script → Save.

## Step 3 — Upload: widget ZIP (Creator, Development)

- **File:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/widget/dist/qts-quote-builder.zip`
- **Where in Zoho:** Creator → QTS (Edit, Development) → the QTS Quote Builder **widget** component → replace/re-upload ZIP.

## Step 4 (optional, recommended) — Item_Master fields + re-import

- **Where in Zoho:** Creator → QTS (Edit, Development) → Design → **Item_Master** form → drag in three **Single Line** fields named exactly `Active`, `Item_Status`, `Quote_Warning` → Save.
- **Then import:** Item_Master report → Import →
  `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/imports/item_master_import_FULL.csv`
- **If skipping the new fields**, import instead:
  `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/creator/imports/item_master_import_CORRECTED.csv`
- Note: `Tier_Scheme` values must be exactly `Hardware` / `License` (both files already are).

## Step 5 — Quick smoke test in Development

- Open the widget → CRM search with 2 chars → expect "Type at least 3 characters"; with 3+ chars → results.
- Repeat the same search within 5 min → instant (cache; no bridge call).
- Build a small quote → Save → publish path still works.

## Step 6 — Publish Development → Stage → Production

- **Where in Zoho:** Creator dashboard (creator.zoho.com → admin) → QTS card → **Environment** menu, or inside the builder: Environments / "Publish to Stage" → then "Publish to Production".
- This carries ALL of steps 1–4 (workflow code, widget, form fields, imported data schema) into Production and — the main goal — moves live usage onto **Production daily quotas** instead of Development's reduced limits.
- After publish: repeat the smoke test against the Production URL.
- **Do NOT touch** the Disabled "CRM Bridge" monolith workflow at any point (reference copy: `deploy_ready/creator/workflows/crm_bridge/DISABLED_monolith_crm_bridge_on_create.creator.deluge`).

## Step 7 — Paste: publish_quote_package (Zoho Flow — separate from Creator)

- **File:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations/deploy_ready/flow/QTS_Saved_Draft_To_Writer/publish_quote_package.deluge`
- **Where in Zoho:** flow.zoho.com → flow **"QTS Saved Draft To Writer"** → custom function **`publish_quote_package`** → replace entire script → Save → re-enable flow if it toggled off.

## Step 8 — Already done (local machine, no Zoho action)

- `~/Library/LaunchAgents/com.blake.zoho-crm-sync.plist` changed from every-120-seconds to **weekly (Mon 9:00 AM)**, RunAtLoad off. Backup: `~/Library/LaunchAgents/com.blake.zoho-crm-sync.plist.bak-2026-07-31`.
- Manual refresh when needed:
  `cd /Users/blakeallard/bevco/repos/kinetic-quote/tools/zoho_crm_sync && .venv/bin/python -m sync --mode incremental --apply`

## Step 9 — Verify next day

- CRM → Setup → Developer Space → API → API Usage: expect total to fall from ~21.6k to ~1–2k/day (self client line should collapse).
- Creator: no more development-limit errors (now on Production quotas).

---

# What changed and why it's more efficient

## 1. CRM sync throttled: every 2 minutes → weekly  *(biggest win, CRM API meter)*
The launchd job `com.blake.zoho-crm-sync` mirrors all ~30 CRM modules into kinetic-quote's
local Postgres (read-only warehouse). At a 120 s interval it ran ~450–720×/day, each run
issuing a metadata fetch plus per-module COQL and delete-check calls — including modules
where COQL isn't even supported (Solutions, Tasks, Vendors), which burned calls for nothing.
Fingerprint on the dashboard: `_Coql` ~7k/day, uniform ~536 credits on every module,
"self client" app, single user, ~92% of all credits. Weekly incremental sync still catches
every change (it pulls by `Modified_Time`), so the data is identical — just less fresh.
**Effect: ~20k/day → ~60/week on the CRM API meter.**

## 2. QTS moved to Production environment  *(fixes the daily "Creator development limit")*
Creator Development/Stage environments run on sharply reduced daily quotas for integration
tasks (`zoho.crm.*` in Deluge) and external calls. Every widget action routes through a
CRM_Bridge form submission whose workflow calls CRM — so real daily quote-building was
draining a quota sized for testing. Production runs on the full Zoho One quota.
**Effect: the limit you were hitting almost daily should stop being hit at all.**

## 3. Minimum 3-character CRM search (server + client)
`search_customers` and `search_leads` previously ran on any non-empty query. A 1–2 char
query like "da" makes CRM scan `starts_with` across Email/First/Last/Company and returns
huge, useless result sets — several integration calls wasted per short query. Now the
bridge returns empty for <3 chars (server-side guard, can't be bypassed) and the widget
blocks the call client-side with a "Type at least 3 characters" message (no form submission
at all, so no Creator integration task is consumed).
**Effect: eliminates the wasted-search class entirely; each avoided search saves 1 form
submission + 1–2 CRM integration calls.**

## 4. 5-minute client-side search cache (widget)
Repeat searches for the same string within 5 minutes are served from widget memory —
zero bridge submissions, zero CRM calls. Stacks with #3: cache is checked first, then the
3-char guard, and only then does a call go out.

## 5. Publish race-detection loop: 10 GET calls → 2
`publish_quote_package` guarded against duplicate publishes by creating a dedupe Note and
then issuing **ten** sequential `GET /Deals/{id}` calls purely as a delay before checking
for competing notes. Two GETs provide the same eventual-consistency window.
**Effect: 8 CRM calls saved per quote publish, publish completes faster.**

## 6. Item_Master import fixed (correctness, not credits)
Import failed 44/44 because `Tier_Scheme` is a case-sensitive dropdown accepting only
`Hardware`/`License` and the CSV had lowercase values; three CSV columns also had no
matching form fields. Fixed CSVs live in `deploy_ready/creator/imports/`; the three
missing fields (`Active`, `Item_Status`, `Quote_Warning`) must be added in the form
builder (Creator has no field-creation API).

## Not addressed yet (next round)
- `get_quote_lines` / `expand_kit` fire per-line/per-kit — batching + product pre-cache
  (see `docs/CRM_API_OPTIMIZATION_PLAN.md`, optimizations 3–4).
- Sync tool refinements (`--watch-modules`, skip COQL-unavailable modules) — matters less
  now that it runs weekly.
