---
applyTo: "deploy_ready/**/*.deluge"
---

# Deploy-ready Instructions

Follow `AGENTS.md` and `docs/PROCESS.md`.

## Purpose

`deploy_ready/` contains Creator paste-ready Deluge sources used for controlled deployment steps.

## Rules

- Keep files paste-ready and complete (no partial fragments).
- Make only scoped, reviewable edits required by the active task.
- Preserve compatibility with current deployment/runbook expectations.
- Do not perform production deployment actions unless explicitly approved.
- Capture what changed and why in session handoff or PR context.

## Safety

- No secrets, tokens, private customer data, or credential-bearing URLs.
- No unrelated refactors or broad rewrites in this folder.
