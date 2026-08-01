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
# Pack Bay layout: plugin-manifest.json + app/ at ZIP root (flattening app/ breaks the page)
zip -r dist/qts-quote-builder.zip plugin-manifest.json app -x "*.DS_Store"
# then upload dist/qts-quote-builder.zip in Creator
```

Legacy checkout `~/bevco/qts-quote-builder` is **not** source of truth (see `MOVED_TO_T71.md` there).

## Related Deluge / Flow

Publish pipeline: `scripts/zoho_flow/QTS_Saved_Draft_To_Writer/`  
Creator sync: `functions/fn_sync_to_crm.deluge`  
Tomorrow paste map: `docs/QTS_TOMORROW_PASTE_CHECKLIST.md`
