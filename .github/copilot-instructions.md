# Copilot Instructions (Repository)

`AGENTS.md` is the canonical shared policy for this repository.
If any instruction conflicts with `AGENTS.md`, follow `AGENTS.md`.

## Required read order (before changes)

1. `AGENTS.md`
2. `README.md`
3. `TASK.md`
4. `STATUS.md` or `QTS_PROJECT_STATUS.md` as relevant
5. `docs/PROCESS.md`
6. Read `docs/CURRENT_HANDOFF.md` only when continuing in-progress work or resuming an active session.

Also read `CLAUDE.md` or `CODEX.md` only for tool-specific deltas.

## Required session loop

1. Inspect current state (`git status --short`) and relevant context docs.
2. Make bounded, reviewable changes only.
3. Run relevant verification commands.
4. Record verification outcomes in PR notes or handoff context.
5. Update `docs/CURRENT_HANDOFF.md` only when the session meaningfully changes repo state, resolves a blocker, or acts as a bounded implementation/review session.

## Scope and safety rules

- Scope work to BI1-T71 and this repository.
- Do not modify Zoho/Creator/CRM/Sheet/WorkDrive unless explicitly approved.
- The Kinetic Bridge QTS widget lives in-repo at `widget/` (edit there; do not use a separate absolute checkout path).
- Do not edit legacy folder: `/Users/blakeallard/bevco/apps/quote_app`.- Keep implementation in `scripts/`, durable docs in `docs/`, and approved artifacts in `artifacts/`.
- Preserve Deluge as full-function files (no partial function fragments).
- Do not invent business rules, field mappings, deployment status, or completion status without direct evidence from repo state, documented handoff, or explicit user confirmation.
- Do not commit secrets, tokens, `.env` files, private customer data, or credential-bearing URLs.
- Do not delete or rewrite existing work without explicit approval.
- Do not push to the default branch without explicit approval.

## Documentation behavior

- `docs/CURRENT_HANDOFF.md` is temporary active-session context.
- Permanent decisions and durable process/project knowledge must live in `README.md`, `docs/`, `AGENTS.md`, `CLAUDE.md`, or `CODEX.md`.
