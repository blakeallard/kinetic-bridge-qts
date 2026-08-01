# CRM_Bridge workflows that exist ONLY in the live app (no repo copy yet)

These 11 per-action workflows are Enabled in Creator but their Deluge has never been
exported into this repo. Creator has no API to read workflow code — each must be
copied out of the UI (Workflow tab → workflow → Action → copy script) into a
`<action>.creator.deluge` file here.

- get_customer
- get_lead
- create_customer
- search_deals
- get_deal
- create_deal
- get_quote_lines
- get_quote_by_number
- expand_kit
- get_tax
- books_diag

Until exported, the live app is the only copy — do not assume this folder is the
complete bridge.
