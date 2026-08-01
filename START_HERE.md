# START HERE — where everything actually is

**One rule:** `deploy_ready/` is the single source of truth for anything that gets pasted
into Zoho. Its folder path = the Zoho destination. If a file exists both here and anywhere
else in the repo, **the `deploy_ready/` copy wins**; the others are legacy/working copies.

**Repo root:** `/Users/blakeallard/bevco/repos/bi1-t71-implement-zoho-based-form-template-for-quotes-item-master-price-book-automated-calculations`

---

## "I want to…" → go here

| I want to… | File / folder | Zoho destination |
|---|---|---|
| Change a CRM_Bridge action (search, sync) | `deploy_ready/creator/workflow/form_workflows/crm_bridge/<action>.creator.deluge` | Creator → QTS (Dev) → Workflow → Form workflows → CRM_Bridge → that workflow |
| Change a Quote_Request workflow (kit button, on-input) | `deploy_ready/creator/workflow/form_workflows/quote_request/` | Creator → QTS (Dev) → Workflow → Form workflows → Quote_Request |
| Change a Creator function (calc, sync, PDF, FX refresh) | `deploy_ready/creator/workflow/functions/fn_*.creator.deluge` | Creator → QTS (Dev) → Workflow → Functions |
| Change the quote widget UI/logic | `widget/app/widget.js` (+ .html/.css) → rebuild ZIP `widget/dist/qts-quote-builder.zip` | Creator → QTS (Dev) → widget component → upload ZIP |
| Change the publish flow (Writer PDF, email, WorkDrive) | `deploy_ready/flow/QTS_Saved_Draft_To_Writer/<fn>.deluge` | flow.zoho.com → "QTS Saved Draft To Writer" → that custom function |
| Re-import Item_Master / FX rates | `deploy_ready/creator/imports/*.csv` | Creator (Prod or Dev) → report → Import |
| Deploy anything → exact ordered steps | `docs/PRODUCTION_ROLLOUT_2026-07-31.md` | — |
| Full path→destination table | `docs/DEPLOYMENT_MAP.md` | — |
| See what happened last session | `docs/CURRENT_HANDOFF.md` | — |

**After any Creator change:** paste/upload into **Development**, then publish Dev → Stage → Production
(Environments page). Data records never copy between environments; only app design does.

## Legacy copies — do NOT edit these

| Path | What it is |
|---|---|
| `functions/*.deluge` | Old working copies of the Creator functions. Superseded by `deploy_ready/creator/workflow/functions/`. |
| `workflows/*.deluge` | Old working copies of form workflows. Superseded by `deploy_ready/creator/workflow/form_workflows/`. |
| `artifacts/qts-widget-ui-packbay/` | Old widget snapshot. Superseded by `widget/app/`. |
| `local_qts/` | Local sandbox (Postgres-backed). Not what's deployed. |
| `import_preview/` | CSV generator tooling + intermediate previews. Final CSVs live in `deploy_ready/creator/imports/`. |
| `deploy_ready/creator/workflow/form_workflows/crm_bridge/DISABLED_monolith_*` | Reference only. Never paste, never re-enable. |

## Outside this repo

| Thing | Where |
|---|---|
| CRM → Postgres mirror (weekly launchd sync) | `/Users/blakeallard/bevco/repos/kinetic-quote/tools/zoho_crm_sync/` + `~/Library/LaunchAgents/com.blake.zoho-crm-sync.plist` |
| BE-9 task poller (cron) | `/Users/blakeallard/bevco/automations/bevco-zoho-poller/` |
| Raw vendor price files | `/Users/blakeallard/bevco/data/desktop-2026-07/` |

## Zoho quick facts

- App: **QTS** (`bevcollc/qts`) — Dev + Stage + **Production (live since 2026-07-31)**
- Item_Master `Tier_Scheme` dropdown accepts exactly `Hardware` / `License` (case-sensitive)
- `Item_Status` field's internal link name is `Item` (API only; UI shows Item_Status)
- FX rates: `fn_refresh_fx_rates` + daily 6 AM schedule (added 2026-07-31)
- Quote numbering: Document_Types.QUOTE `Last_Sequence` (Production continued at 34)
