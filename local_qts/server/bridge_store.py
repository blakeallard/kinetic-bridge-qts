from __future__ import annotations

import json
from typing import Any

from . import db
from .quotes import local_numeric_id

# In-memory fallback if crm_bridge table write fails shape-wise; primary is Postgres.
_MEMORY: dict[str, dict[str, Any]] = {}


def create_bridge(action: str, query_text: str, payload_json: str | None) -> str:
    record_id = local_numeric_id("7")
    # Process action synchronously via bridge module
    from . import bridge

    result, status = bridge.dispatch(action, query_text, payload_json)
    result_str = json.dumps(result)
    try:
        payload_obj: Any
        if payload_json:
            try:
                payload_obj = json.loads(payload_json)
            except json.JSONDecodeError:
                payload_obj = {"raw": payload_json}
        else:
            payload_obj = {}
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO crm_bridge
                      (zoho_record_id, action, query_text, payload_json, result_json, request_status)
                    VALUES (%s, %s, %s, %s::jsonb, %s::jsonb, %s)
                    """,
                    (
                        record_id,
                        action,
                        query_text or "",
                        json.dumps(payload_obj),
                        result_str,
                        status,
                    ),
                )
    except Exception:
        # Still succeed for the widget even if logging insert fails
        pass
    _MEMORY[record_id] = {
        "ID": record_id,
        "Action_field": action,
        "Query_Text": query_text or "",
        "Payload_JSON": payload_json or "",
        "Result_jSON": result_str,
        "Request_Status": status,
    }
    return record_id


def _json_field(val: Any) -> str:
    if val is None:
        return "{}"
    if isinstance(val, str):
        return val
    return json.dumps(val)


def get_bridge(record_id: str) -> dict[str, Any] | None:
    if record_id in _MEMORY:
        return _MEMORY[record_id]
    row = db.fetch_one(
        "SELECT * FROM crm_bridge WHERE zoho_record_id = %s",
        (record_id,),
    )
    if not row:
        return None
    return {
        "ID": row["zoho_record_id"],
        "Action_field": row["action"] or "",
        "Query_Text": row["query_text"] or "",
        "Payload_JSON": _json_field(row["payload_json"]),
        "Result_jSON": _json_field(row["result_json"]),
        "Request_Status": row["request_status"] or "",
    }


def list_bridges(filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT * FROM crm_bridge ORDER BY id DESC LIMIT 100"
    )
    out = []
    for row in rows:
        rec = {
            "ID": row["zoho_record_id"],
            "Action_field": row["action"] or "",
            "Query_Text": row["query_text"] or "",
            "Payload_JSON": _json_field(row["payload_json"]),
            "Result_jSON": _json_field(row["result_json"]),
            "Request_Status": row["request_status"] or "",
        }
        if filters:
            ok = all(str(rec.get(k, "")) == str(v) for k, v in filters.items())
            if not ok:
                continue
        out.append(rec)
    return out
