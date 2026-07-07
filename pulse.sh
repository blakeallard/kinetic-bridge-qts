#!/usr/bin/env bash
set -euo pipefail

git fetch origin >/dev/null 2>&1

echo "## GIT"
git status -sb
echo "ahead behind: $(git rev-list --left-right --count origin/main...HEAD)"

echo
echo "## ISSUE #1"
gh issue view 1 --json title,state,url,comments --jq '{title,state,url,comment_count:(.comments|length)}'

echo
echo "## LATEST COMMITS"
git log --oneline --decorate -n 5

echo
echo "## HANDOFF"
tail -n 30 docs/CURRENT_HANDOFF.md 2>/dev/null || echo "missing docs/CURRENT_HANDOFF.md"

echo
echo "## NEXT"
echo "Run Claude/Codex: read Issue #1 + repo docs, continue next documented task, post handoff to Issue #1."
