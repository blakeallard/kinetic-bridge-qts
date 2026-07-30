# QTS two-button CRM — verification (Stage 5)

Date: 2026-07-29  
Repo: BI1-T71

## Local (verified this session)

| Check | Result |
| ----- | ------ |
| Widget exposes `publishQuotePackage` | Code present in `qts-quote-builder/app/widget.js` |
| Two buttons only (Save / Email); no Update CRM deal | `widget.html` + packbay mirrors |
| Unit tests `node tests/widget_state_test.js` | **ALL TESTS PASS** (2026-07-29) |
| Modular Deluge under `scripts/qts_publish/` | 13 step/orchestrator files + COMPAT + README |
| T110 `generate_and_file_quote_document.deluge` | Quotes gated on `send_email`; Deal attach always; empty products fail loud |
| Save path skips Quotes/email/stage/CONFIRMED | Documented in orchestrator + COMPAT gating |

## Live Zoho (needs Blake — dry-run preferred)

**2026-07-29 evening:** Stage 5 live testing **paused** — Creator **External Calls** daily quota exhausted. Resume after ~00:00 Super Admin TZ. Check **Creator → Usage Details → External Calls** before retrying. See plan section *Creator external-call limits*.

Do **not** burn live client email unless intentional. Prefer internal contact + dry-run mail skip if Flow supports it.

### Matrix

| # | Action | Expect |
| - | ------ | ------ |
| 1 | **Save Quote Package** (first time) | Status `PDF Filed`; Deal Associated Products match lines; Writer PDF on Deal; WorkDrive `CURRENT/`; **no** new CRM Quotes; **no** email; stage unchanged |
| 2 | **Save Quote Package** again (edit lines) | Products update; one current Deal PDF; prior PDF in WorkDrive `DRAFTS/` with `r{n}_{timestamp}`; still **no** Quotes |
| 3 | **Email Quote Package** | Status `Package Requested`; WorkDrive `CONFIRMED/` written; CRM Quotes upsert (`Kinetic Bridge Quote {qno}`); PDF on Quote + Deal; sendmail; stage → **Negotiation/Review** |
| 4 | **Email** again after line change | Quote updated; prior CURRENT/CONFIRMED archived to `DRAFTS/`; one current attach each |

### Flow wiring checklist (Blake)

1. Creator Status trigger includes both `PDF Filed` and `Package Requested`.
2. Decision: `Package Requested` → `send_email=true`; `PDF Filed` → `false`.
3. Prefer T71 modules in `scripts/qts_publish/` OR re-paste COMPAT / updated T110 function.
4. Set `QTS_QUOTES_ROOT_FOLDER_ID` in `workdrive_ensure_quote_folders` when known (name `QTS Quotes` until then).
5. Confirm WorkDrive connection on Flow can create folders + upload (may need dedicated WD connection if `zoho_crm_to_zoho_flow` lacks scopes — **do not add secrets in repo**; configure in Zoho UI).
6. Creator fields for revision snapshot: see `QTS_TWO_BUTTON_CRM_CREATOR_REVISION.md` (optional; non-blocking).

### Widget deploy

```bash
# From qts-quote-builder — rebuild/upload widget ZIP per existing Creator packbay process
cd /Users/blakeallard/bevco/qts-quote-builder
node tests/widget_state_test.js
```

Pack Bay mirror: T71 `artifacts/qts-widget-ui-packbay/`

### Flow dry-run notes

- Code-path verification without live mail: call orchestrator / COMPAT with `send_email=false` only.
- For email branch without sendmail: temporarily skip `send_quote_email` step in Flow Decision (test Quotes + CONFIRMED + stage separately).

## Known limitations

- WorkDrive root folder ID is locked: `wctzef9e0b057e781406896d8866994e93156` (`My Folders/QTS Quotes`) in `workdrive_ensure_quote_folders.deluge`.
- Prefer modular Flow modules from `scripts/qts_publish/` (`publish_quote_package` orchestrator). COMPAT lacks WorkDrive; monolith `generate_and_file_quote_document.deluge` also lacks WorkDrive.
- After 2026-07-30 review fixes: Deal is fetched once per publish; prior Deal quote PDFs are deleted before attach; product search is batched (≤8 ORs); empty product lookup no longer wipes Deal Associated Products.
- Creator `Prior_Revision_Snapshot` / WD ID fields may not exist yet — snapshot is best-effort.
- Zoho Flow may require pasting each module as a separate custom function (orchestrator uses `thisapp.*` calls).
- T110 COMPAT script does not yet implement WorkDrive CURRENT/CONFIRMED/DRAFTS — use T71 modular steps for full WD layout.
