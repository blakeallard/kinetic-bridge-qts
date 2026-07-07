# Agent Process

This file defines the standard agent loop for Claude/Codex sessions in this
repository.

## Purpose

- Keep the active task state easy to resume across short agent sessions.
- Separate temporary handoff context from permanent project documentation.
- Make review/verification steps explicit before commit or push.

## Files

- `docs/CURRENT_HANDOFF.md`
  Temporary active-session handoff file. Update it before stopping work.
  It is gitignored and should not be treated as permanent documentation.
- `CLAUDE.md`
  Session-level instructions for Claude/Codex.
- `AGENTS.md`
  High-level repository instructions shared across agents.
- `README.md`, `TASK.md`, and relevant docs in `docs/`
  Permanent project context and task-specific documentation.

## Required Session Loop

1. Start by reading:
   `README.md`, `TASK.md`, `docs/PROCESS.md`, `CLAUDE.md`, and `AGENTS.md`.
2. Inspect the current repo state before assuming anything:
   run `git status --short` and read the relevant local context files.
3. Do the requested work with bounded, reviewable changes.
4. Run the relevant verification commands and capture PASS/FAIL results.
5. Before stopping, update `docs/CURRENT_HANDOFF.md` with the active checkpoint.
6. Before commit review, remove stale scratch context and keep only intended
   repo changes in the working tree.

## What Goes In CURRENT_HANDOFF

Keep it concise and operational. Include:

- Current objective
- Key assumptions in force
- Files changed
- Checks run with PASS/FAIL
- Current git status
- Open review question or blocker
- Recommended next command or prompt

## Documentation Rules

- Put durable process/project knowledge in permanent docs such as
  `README.md`, `docs/`, `CLAUDE.md`, or `AGENTS.md`.
- Put short-lived session state only in `docs/CURRENT_HANDOFF.md`.
- Do not use the temporary handoff file as the sole record of an approved
  business rule or technical decision.

## Commit/Push Rules

- Do not commit unless explicitly approved when approval is required by the
  current task instructions.
- Do not push unless explicitly approved.
- Prefer commit contents that are narrow, reviewable, and directly tied to the
  active task.
