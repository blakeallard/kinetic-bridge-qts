# Creator Deploy CLI (PoC) — BI1-T71

Zoho Task ID: `2543412000001469015`
Added: 2026-07-11 (Round 50)

`scripts/creator_deploy.py` saves a Deluge custom function directly into the
**Zoho Creator DEV builder** (`bevcollc/qts`), replacing the manual paste/save
loop. It POSTs to the internal builder endpoint
`workflowbuilder/edit/populateCustomFunction` (verified live 2026-07-11).

**Unofficial endpoint.** It may change without notice, and it authenticates
with a personal browser session, not OAuth. Treat every run as supervised.

## Session material (never stored in the repo)

Create `~/.config/qts/creator_session` with `chmod 600` (the script refuses
wider permissions), containing:

```
cookie=<full Cookie header value copied from an authenticated Creator request>
zccpn=<csrf token>        # optional — extracted from the zccpn cookie if omitted
```

Refresh it by copying the `Cookie` request header from any authenticated
creator.zoho.com request in browser devtools. Sessions expire; an expired
session surfaces as a non-JSON/HTTP-error response, never a silent failure.
Cookie/CSRF values are never printed by the script.

## Usage

```
python3 scripts/creator_deploy.py fn_sync_to_crm            # dry-run (default)
python3 scripts/creator_deploy.py fn_sync_to_crm --deploy   # real save to DEV
```

## Safety rails

- Allowlist: `fn_sync_to_crm` only (PoC).
- URL pinned to the dev appbuilder path — production is unreachable by
  construction.
- Default is dry-run; `--deploy` required for any network write.
- Refuses to deploy unless `deploy_ready/fn_sync_to_crm.creator.deluge` and
  `functions/fn_sync_to_crm.deluge` are byte-identical, non-empty, and
  brace-balanced.
- Response parsing: `status=success` + `lineNumber=-1` → `[SUCCESS]`;
  otherwise `[ERROR]` with Creator's exact message and line number.

## After a successful deploy

Verify once in the Creator editor that the function body matches the repo
source (first supervised run only), then run the live QA loop (see
`docs/CURRENT_HANDOFF.md`).
