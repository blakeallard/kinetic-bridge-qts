# QTS Quote Builder — agent rules

## Production UI (do not regress)

Zoho Creator loads **`app/widget.html`** + **`app/widget.css`** (`plugin-manifest.json` `index-url`).

The correct live look is **Pack Bay (graphite / amber volt)** — vertical battery cell rail + oversized volt readout.
Source of truth recovered from `dist/qts-quote-builder-pre-autosave-20260727.zip` packbay files.

**Not** the Bevco Ops copper/teal Manrope restyle. **Not** the bento/dock experiment. **Not** the old invoice/document theme.

### When changing behavior (`widget.js`)

- Do **not** restyle or replace `widget.html` / `widget.css`.
- Keep existing element **IDs** so JS bindings keep working.
- If markup must change for a new control, update both production and packbay mirrors.

### Mirrors

| Production | Mirror |
|---|---|
| `app/widget.html` | `app/widget.packbay.html` |
| `app/widget.css` | `app/widget.packbay.css` |
| `app/assets/logo.svg` | `app/assets/logo.packbay.svg` |

### Upload zip

```bash
cd widget
zip -r dist/qts-quote-builder.zip plugin-manifest.json app -x "*.DS_Store"
```
