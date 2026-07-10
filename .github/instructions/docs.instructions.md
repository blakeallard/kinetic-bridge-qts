---
applyTo: "docs/**/*.md,README.md,TASK.md,STATUS.md,QTS_PROJECT_STATUS.md,AGENTS.md,CLAUDE.md,CODEX.md"
---

# Documentation Instructions

Follow `AGENTS.md` as canonical repository policy.

## Documentation model

- Put durable project/process decisions in permanent docs (`README.md`, `docs/`, `AGENTS.md`).
- Keep `CLAUDE.md` and `CODEX.md` thin and tool-specific.
- Use `docs/CURRENT_HANDOFF.md` for temporary active-session checkpointing only when the session meaningfully changes repo state, resolves a blocker, or acts as a bounded implementation/review session.

## Handoff behavior

When a handoff update is required, include:

- current objective
- assumptions
- files changed
- verification outcomes
- current git status
- blocker/open question
- recommended next command/prompt

## Writing rules

- Keep updates concise, operational, and review-friendly.
- Do not include secrets, private customer/vendor details, or credential-bearing URLs.
- Do not treat temporary handoff notes as the sole record of approved business rules.
