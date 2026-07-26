# QTS Quote-To-Signature — UI copy (Bevco Ops style)

Layout/style alternative for the Creator quote widget. **Does not replace** production `widget.html` / `widget.css`.

Visual language matched to `~/bevco/dashboard/ops.html` (Manrope, IBM Plex Mono, copper `#c4a574` + teal `#7eb8c9`).

| File | Role |
|---|---|
| `widget.packbay.html` | Shell titled **QTS Quote-To-Signature** (same element IDs) |
| `widget.packbay.css` | Ops-dashboard styles |
| `logo.svg` | Matching mark |

**Runtime:** pair with production `~/bevco/qts-quote-builder/app/widget.js`.

**Preview:**
```bash
cd ~/bevco/qts-quote-builder && python3 -m http.server 8765
# http://localhost:8765/app/widget.packbay.html
```

**Production import** still uses `dist/qts-quote-builder.zip` → `app/widget.html`.
