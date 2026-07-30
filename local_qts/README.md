# Local QTS (Postgres sandbox)

Run the QTS Quote Builder against your **local kinetic-quote Postgres** (QTS catalog + `zoho_crm` mirror) with **zero Zoho API / Creator External Calls**.

## Prerequisites

1. Local Supabase for `kinetic-quote` is running:

```sh
cd ~/Dev/bevco/kinetic-quote
supabase start
# DB: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

2. CRM mirror populated (optional but recommended for customer search):

```sh
cd ~/Dev/bevco/kinetic-quote/tools/zoho_crm_sync
# incremental/full sync as documented in that tool's README
```

## Start

```sh
cd local_qts
cp .env.example .env   # optional
./run.sh
```

Open **http://127.0.0.1:8789**

Health check: **http://127.0.0.1:8789/api/health**

## What works locally

| Feature | Backend |
| --- | --- |
| Item picker / FX | `public.item_master`, `fx_rates_cache` |
| Kit dropdown | `public.kit_components` |
| Kit expand | [`kit_bom/kit_components.csv`](../kit_bom/kit_components.csv) |
| CRM search / get / create | `zoho_crm.records` (creates use `LOCAL_*` / sandbox ids) |
| Deals search / create / sync | `zoho_crm.records` + Associated_Products (local only) |
| Quote draft save / load / discard | `public.quote_request` + `quote_lines` |
| Save / Email Quote Package | Status + Deal sync stubbed (no Writer / WorkDrive / email) |

## Architecture

```
Browser (index.html + widget.js)
  → zoho-local-shim.js  (replaces widgetsdk)
  → FastAPI /api/creator/*
  → Postgres :54322
```

Production Creator Deluge and the upload ZIP are **not** modified.

## Smoke checks

```sh
curl -s http://127.0.0.1:8789/api/health | python3 -m json.tool
curl -s -X POST http://127.0.0.1:8789/api/creator/getAllRecords \
  -H 'content-type: application/json' \
  -d '{"reportName":"Item_Master_Report","page":1,"pageSize":5}' | python3 -m json.tool | head -40
curl -s -X POST http://127.0.0.1:8789/api/creator/addRecord \
  -H 'content-type: application/json' \
  -d '{"formName":"CRM_Bridge","data":{"data":{"Action_field":"search_customers","Query_Text":"harbinger"}}}' 
# then getRecordById with returned ID and read Result_jSON
```
