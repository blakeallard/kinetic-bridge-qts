---
applyTo: "scripts/**/*.py,scripts/**/*.sh,audit/**/*.py,import_preview/**/*.py,pulse.sh"
---

# Scripts Instructions

Follow repository-wide policy in `AGENTS.md` and `docs/PROCESS.md`.

## Working rules

- Prefer small, reviewable script changes with clear diffs.
- Keep behavior deterministic and auditable.
- Do not add credentials, tokens, or private data to scripts, outputs, or logs.
- Do not add destructive/default-live side effects unless explicitly requested.
- Keep existing script interfaces stable unless the task explicitly requires a change.
- Document assumptions and verification steps in handoff or PR notes.

## Scope boundaries

- Do not perform Zoho/Creator/CRM/Sheet/WorkDrive mutations unless explicitly approved.
- Do not write automation against the legacy folder `/Users/blakeallard/bevco/apps/quote_app`.
