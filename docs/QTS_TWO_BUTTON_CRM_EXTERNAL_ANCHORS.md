# QTS two-button CRM — external anchors

Paths are **repo-relative** (Kinetic Bridge QTS product repo = this T71 tree).

## Widget (canonical — in this repo)

| Piece | Path |
| ----- | ---- |
| Primary widget app | `widget/app/widget.js` |
| Primary widget HTML | `widget/app/widget.html` |
| Widget CSS | `widget/app/widget.css` |
| Widget tests | `widget/tests/widget_state_test.js` |
| Pack Bay ZIP | `widget/dist/qts-quote-builder.zip` |
| Pack Bay UI mirror | `artifacts/qts-widget-ui-packbay/` |

Legacy local folder `qts-quote-builder` outside this repo is retired as source of truth.

## Flow / publish Deluge (this repo)

Organized by Zoho Flow name under [`scripts/zoho_flow/`](../scripts/zoho_flow/).

| Piece | Path |
| ----- | ---- |
| Flow folder | `scripts/zoho_flow/QTS_Saved_Draft_To_Writer/` → live Flow **QTS Saved Draft To Writer** |
| Orchestrator | `…/publish_quote_package.deluge` |
| Modular helpers | `…/*.deluge` (same folder) |
| COMPAT / monolith (no WorkDrive) | `…/_do_not_paste_for_live_workdrive/` |

## Creator

| Piece | Path |
| ----- | ---- |
| `fn_sync_to_crm` | `deploy_ready/fn_sync_to_crm.creator.deluge` |
| Bridge actions | `deploy_ready/crm_bridge_actions/` |

## Historical T110 notes

Older Flow copies may still exist under the BI1-T110 email-intelligence repo. **Publish ownership is T71 / this product repo** — do not treat T110 as canonical for Save/Email Quote Package.
