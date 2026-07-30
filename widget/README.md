# Kinetic Bridge QTS widget

Canonical Creator Pack Bay widget for the Kinetic Bridge quote builder (BI1-T71).

## Layout

| Path | Purpose |
| ---- | ------- |
| `app/widget.js` | Main UI + `publishQuotePackage` / CRM bridge calls |
| `app/widget.html` / `widget.css` | Markup + styles |
| `plugin-manifest.json` | Pack Bay manifest |
| `dist/qts-quote-builder.zip` | Upload artifact for Creator |
| `tests/widget_state_test.js` | State tests |

## Build / upload

From this directory (repo-relative — no machine home paths):

```bash
cd widget
# Rebuild ZIP from app/ per your Pack Bay process, then upload dist/qts-quote-builder.zip in Creator
```

Legacy checkout `~/bevco/qts-quote-builder` is **not** source of truth (see `MOVED_TO_T71.md` there).

## Related Deluge / Flow

Publish pipeline: `scripts/qts_publish/`  
Creator sync: `functions/fn_sync_to_crm.deluge`  
Tomorrow paste map: `docs/QTS_TOMORROW_PASTE_CHECKLIST.md`
