# deploy_ready — paste-ready scripts, organized by destination

Every file here is a paste/upload artifact. The directory tells you WHERE it goes.
Full deployment instructions with destinations: `docs/DEPLOYMENT_MAP.md`.

The tree mirrors Zoho's UI navigation exactly — each directory level is a click:

```
deploy_ready/
├── creator/                            → Creator → QTS (Edit, Development)
│   ├── workflow/                       →   Workflow tab
│   │   ├── form_workflows/             →     Form workflows section
│   │   │   ├── crm_bridge/             →       CRM_Bridge form (one file = one workflow)
│   │   │   └── quote_request/          →       Quote_Request form
│   │   ├── functions/                  →     Functions section (fn_*)
│   │   └── schedules/                  →     Schedules section (daily FX refresh)
│   └── imports/                        →   report → Import (CSV files)
├── flow/
│   └── QTS_Saved_Draft_To_Writer/      → flow.zoho.com → that flow's custom functions
└── (widget ZIP stays at widget/dist/qts-quote-builder.zip — build output, not duplicated here)
```

## Old → new path map (for older docs referencing flat paths)

| Old path | New path |
|---|---|
| `deploy_ready/crm_bridge_actions/*.deluge` | `deploy_ready/creator/workflow/form_workflows/crm_bridge/` |
| `deploy_ready/crm_bridge_on_create.creator.deluge` | `deploy_ready/creator/workflow/form_workflows/crm_bridge/DISABLED_monolith_crm_bridge_on_create.creator.deluge` |
| `deploy_ready/fn_*.deluge` | `deploy_ready/creator/workflow/functions/` |
| `deploy_ready/expand_kit_button.creator.deluge`, `on_user_input_*.deluge` | `deploy_ready/creator/workflow/form_workflows/quote_request/` |
| `scripts/zoho_flow/QTS_Saved_Draft_To_Writer/` | `deploy_ready/flow/QTS_Saved_Draft_To_Writer/` |
| `import_preview/item_master_import_CORRECTED.csv` / `_FULL.csv` | `deploy_ready/creator/imports/` |

## Rules

- `DISABLED_monolith_*` files are reference-only. Do NOT paste or re-enable them.
- One file = one paste target. Never paste a `crm_bridge/` action file into a different action's workflow.
- `flow/*/_do_not_paste_for_live_workdrive` and `_inline_only_not_separate_flow_cfs` markers still apply.
