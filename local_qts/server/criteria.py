from __future__ import annotations

import re
from typing import Any


_CLAUSE = re.compile(
    r"""
    (?P<field>[A-Za-z_][A-Za-z0-9_]*)
    \s*==\s*
    (?:
        "(?P<qstr>[^"]*)"
        |
        '(?P<sqstr>[^']*)'
        |
        (?P<bare>[A-Za-z0-9_.\-]+)
    )
    """,
    re.VERBOSE,
)


def parse_criteria(criteria: str | None) -> dict[str, Any]:
    """Parse a tiny subset of Creator criteria: `Field == "value" && Field2 == 123`."""
    if not criteria or not str(criteria).strip():
        return {}
    out: dict[str, Any] = {}
    for m in _CLAUSE.finditer(criteria):
        field = m.group("field")
        raw = m.group("qstr")
        if raw is None:
            raw = m.group("sqstr")
        if raw is None:
            raw = m.group("bare")
        out[field] = raw
    return out
