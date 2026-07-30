from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from . import db, quotes
from .config import LOCAL_ID_PREFIX
from .kit_expand import expand_kit

CLOSED_STAGES = {"Closed Won", "Closed Lost", "Closed Lost to Competition"}


def _parse_payload(payload_json: str | None) -> dict[str, Any]:
    if not payload_json:
        return {}
    try:
        data = json.loads(payload_json)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _raw(module: str, record_id: str) -> dict[str, Any] | None:
    row = db.fetch_one(
        """
        SELECT record_id, raw FROM zoho_crm.records
        WHERE module_api_name = %s AND record_id = %s AND deleted_at IS NULL
        """,
        (module, str(record_id)),
    )
    if not row:
        return None
    raw = row["raw"]
    if isinstance(raw, str):
        raw = json.loads(raw)
    return raw


def _upsert_record(module: str, record_id: str, raw: dict[str, Any]) -> None:
    raw = dict(raw)
    raw["id"] = record_id
    now = datetime.now(timezone.utc).isoformat()
    raw["Modified_Time"] = now
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO zoho_crm.records (module_api_name, record_id, modified_time, raw, synced_at, deleted_at)
                VALUES (%s, %s, now(), %s::jsonb, now(), NULL)
                ON CONFLICT (module_api_name, record_id) DO UPDATE SET
                  raw = EXCLUDED.raw,
                  modified_time = now(),
                  synced_at = now(),
                  deleted_at = NULL
                """,
                (module, record_id, json.dumps(raw)),
            )


def _search_contacts(query: str) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []
    like = f"%{q}%"
    rows = db.fetch_all(
        """
        SELECT record_id, raw FROM zoho_crm.records
        WHERE module_api_name = 'Contacts' AND deleted_at IS NULL
          AND (
            raw->>'Email' ILIKE %s
            OR raw->>'Last_Name' ILIKE %s
            OR raw->>'First_Name' ILIKE %s
            OR raw->>'Full_Name' ILIKE %s
            OR COALESCE(raw#>>'{Account_Name,name}', raw->>'Account_Name') ILIKE %s
          )
        ORDER BY modified_time DESC NULLS LAST
        LIMIT 40
        """,
        (like, like, like, like, like),
    )
    matches = []
    seen = set()
    for row in rows:
        cid = row["record_id"]
        if cid in seen:
            continue
        seen.add(cid)
        raw = row["raw"] if isinstance(row["raw"], dict) else json.loads(row["raw"])
        acct = raw.get("Account_Name") or {}
        account_id = ""
        account_name = ""
        if isinstance(acct, dict):
            account_id = str(acct.get("id") or "")
            account_name = acct.get("name") or ""
        elif isinstance(acct, str) and acct:
            account_id = acct
            account_raw = _raw("Accounts", acct)
            account_name = (
                (account_raw or {}).get("Account_Name")
                or (account_raw or {}).get("account_name")
                or ""
            )
        matches.append(
            {
                "contact_id": cid,
                "name": raw.get("Full_Name")
                or " ".join(
                    x for x in [raw.get("First_Name") or "", raw.get("Last_Name") or ""] if x
                ).strip(),
                "email": raw.get("Email") or "",
                "phone": raw.get("Phone") or "",
                "account_id": account_id,
                "account_name": account_name,
            }
        )
    return matches


def _search_leads(query: str) -> list[dict[str, Any]]:
    q = query.strip()
    if not q:
        return []
    like = f"%{q}%"
    rows = db.fetch_all(
        """
        SELECT record_id, raw FROM zoho_crm.records
        WHERE module_api_name = 'Leads' AND deleted_at IS NULL
          AND COALESCE(raw->>'$converted', 'false') NOT IN ('true', 'True', '1')
          AND (
            raw->>'Email' ILIKE %s
            OR raw->>'Last_Name' ILIKE %s
            OR raw->>'First_Name' ILIKE %s
            OR raw->>'Full_Name' ILIKE %s
            OR raw->>'Company' ILIKE %s
          )
        ORDER BY modified_time DESC NULLS LAST
        LIMIT 40
        """,
        (like, like, like, like, like),
    )
    matches = []
    for row in rows:
        raw = row["raw"] if isinstance(row["raw"], dict) else json.loads(row["raw"])
        matches.append(
            {
                "lead_id": row["record_id"],
                "name": raw.get("Full_Name")
                or " ".join(
                    x for x in [raw.get("First_Name") or "", raw.get("Last_Name") or ""] if x
                ).strip(),
                "email": raw.get("Email") or "",
                "phone": raw.get("Phone") or "",
                "company": raw.get("Company") or "",
            }
        )
    return matches


def _addr(raw: dict[str, Any], prefix: str, zip_key: str = "Code") -> dict[str, str]:
    return {
        "street": raw.get(f"{prefix}_Street") or "",
        "city": raw.get(f"{prefix}_City") or "",
        "state": raw.get(f"{prefix}_State") or "",
        "code": raw.get(f"{prefix}_{zip_key}") or raw.get(f"{prefix}_Zip") or "",
        "country": raw.get(f"{prefix}_Country") or "",
    }


def _get_customer(contact_id: str) -> dict[str, Any]:
    raw = _raw("Contacts", contact_id)
    if not raw:
        return {"error": f"Contact {contact_id} not found"}
    out: dict[str, Any] = {
        "contact_id": contact_id,
        "first_name": raw.get("First_Name") or "",
        "last_name": raw.get("Last_Name") or "",
        "name": raw.get("Full_Name")
        or " ".join(
            x for x in [raw.get("First_Name") or "", raw.get("Last_Name") or ""] if x
        ).strip(),
        "email": raw.get("Email") or "",
        "phone": raw.get("Phone") or "",
        "mailing_address": {
            "street": raw.get("Mailing_Street") or "",
            "city": raw.get("Mailing_City") or "",
            "state": raw.get("Mailing_State") or "",
            "code": raw.get("Mailing_Zip") or "",
            "country": raw.get("Mailing_Country") or "",
        },
    }
    acct = raw.get("Account_Name") or {}
    if isinstance(acct, dict):
        account_id = str(acct.get("id") or "")
        out["account_name"] = acct.get("name") or ""
    elif isinstance(acct, str) and acct:
        account_id = acct
        out["account_name"] = ""
    else:
        account_id = ""
        out["account_name"] = ""
    out["account_id"] = account_id
    if account_id:
        account = _raw("Accounts", account_id)
        if account:
            if not out["account_name"]:
                out["account_name"] = account.get("Account_Name") or ""
            out["billing_address"] = _addr(account, "Billing")
            out["shipping_address"] = _addr(account, "Shipping")
    return out


def _create_customer(payload: dict[str, Any]) -> dict[str, Any]:
    last_name = (payload.get("last_name") or "").strip()
    if not last_name:
        return {"error": "create_customer requires last_name"}
    email = (payload.get("email") or "").strip()
    if email:
        rows = db.fetch_all(
            """
            SELECT record_id FROM zoho_crm.records
            WHERE module_api_name = 'Contacts' AND deleted_at IS NULL
              AND lower(raw->>'Email') = lower(%s)
            LIMIT 1
            """,
            (email,),
        )
        if rows:
            return {
                "duplicate": True,
                "contact_id": rows[0]["record_id"],
                "message": "A CRM Contact with this email already exists; reusing it.",
            }

    account_id = ""
    company = (payload.get("company") or "").strip()
    if company:
        found = db.fetch_all(
            """
            SELECT record_id FROM zoho_crm.records
            WHERE module_api_name = 'Accounts' AND deleted_at IS NULL
              AND lower(COALESCE(raw->>'Account_Name', '')) = lower(%s)
            LIMIT 1
            """,
            (company,),
        )
        if found:
            account_id = found[0]["record_id"]
        else:
            account_id = f"{LOCAL_ID_PREFIX}-A-{uuid4().hex[:10]}"
            _upsert_record(
                "Accounts",
                account_id,
                {
                    "Account_Name": company,
                    "Billing_Street": payload.get("billing_street") or "",
                    "Billing_City": payload.get("billing_city") or "",
                    "Billing_State": payload.get("billing_state") or "",
                    "Billing_Code": payload.get("billing_code") or "",
                    "Billing_Country": payload.get("billing_country") or "",
                },
            )

    first = (payload.get("first_name") or "").strip()
    contact_id = f"{LOCAL_ID_PREFIX}-C-{uuid4().hex[:10]}"
    contact_raw: dict[str, Any] = {
        "First_Name": first,
        "Last_Name": last_name,
        "Full_Name": f"{first} {last_name}".strip(),
        "Email": email,
        "Phone": payload.get("phone") or "",
        "Mailing_Street": payload.get("billing_street") or "",
        "Mailing_City": payload.get("billing_city") or "",
        "Mailing_State": payload.get("billing_state") or "",
        "Mailing_Zip": payload.get("billing_code") or "",
        "Mailing_Country": payload.get("billing_country") or "",
    }
    if account_id:
        contact_raw["Account_Name"] = {"id": account_id, "name": company}
    _upsert_record("Contacts", contact_id, contact_raw)
    return {"contact_id": contact_id, "account_id": account_id, "duplicate": False}


def _deal_row(deal_id: str, raw: dict[str, Any]) -> dict[str, Any]:
    stage = raw.get("Stage") or ""
    acct = raw.get("Account_Name") or {}
    if isinstance(acct, str):
        acct = {"name": acct}
    contact = raw.get("Contact_Name") or {}
    if isinstance(contact, str):
        contact = {"name": contact}
    return {
        "deal_id": deal_id,
        "deal_name": raw.get("Deal_Name") or "",
        "stage": stage,
        "amount": raw.get("Amount") if raw.get("Amount") is not None else "",
        "modified_time": str(raw.get("Modified_Time") or ""),
        "account_name": acct.get("name") or "",
        "contact_name": contact.get("name") or "",
        "is_closed": stage in CLOSED_STAGES,
    }


def _search_deals(payload: dict[str, Any]) -> dict[str, Any]:
    contact_id = str(payload.get("contact_id") or "").strip()
    account_id = str(payload.get("account_id") or "").strip()
    if not contact_id and not account_id:
        return {"error": "search_deals requires contact_id and/or account_id in Payload_JSON"}

    clauses = []
    params: list[Any] = []
    if contact_id:
        clauses.append("(raw#>>'{Contact_Name,id}' = %s OR raw->>'Contact_Name' = %s)")
        params.extend([contact_id, contact_id])
    if account_id:
        clauses.append("(raw#>>'{Account_Name,id}' = %s OR raw->>'Account_Name' = %s)")
        params.extend([account_id, account_id])

    sql = f"""
        SELECT record_id, raw FROM zoho_crm.records
        WHERE module_api_name = 'Deals' AND deleted_at IS NULL
          AND ({' OR '.join(clauses)})
        ORDER BY modified_time DESC NULLS LAST
        LIMIT 50
    """
    rows = db.fetch_all(sql, params)
    deals = []
    seen = set()
    for row in rows:
        did = row["record_id"]
        if did in seen:
            continue
        seen.add(did)
        raw = row["raw"] if isinstance(row["raw"], dict) else json.loads(row["raw"])
        deals.append(_deal_row(did, raw))
    return {"deals": deals}


def _get_deal(deal_id: str) -> dict[str, Any]:
    raw = _raw("Deals", deal_id)
    if not raw:
        return {"error": f"Deal {deal_id} not found"}
    return _deal_row(deal_id, raw)


def _create_deal(payload: dict[str, Any]) -> dict[str, Any]:
    deal_name = str(payload.get("deal_name") or "").strip()
    if not deal_name:
        return {"error": "create_deal requires deal_name in Payload_JSON"}
    contact_id = str(payload.get("contact_id") or "").strip()
    account_id = str(payload.get("account_id") or "").strip()
    account_name = str(payload.get("account_name") or "").strip()
    deal_id = f"{LOCAL_ID_PREFIX}-D-{uuid4().hex[:10]}"
    closing = (date.today() + timedelta(days=30)).isoformat()
    raw: dict[str, Any] = {
        "Deal_Name": deal_name,
        "Stage": "Proposal/Price Quote",
        "Closing_Date": closing,
        "Amount": 0,
    }
    if account_id:
        raw["Account_Name"] = {"id": account_id, "name": account_name}
    elif account_name:
        raw["Account_Name"] = account_name
    if contact_id:
        contact = _raw("Contacts", contact_id)
        cname = ""
        if contact:
            cname = contact.get("Full_Name") or contact.get("Last_Name") or ""
        raw["Contact_Name"] = {"id": contact_id, "name": cname}
    _upsert_record("Deals", deal_id, raw)
    return {
        "deal_id": deal_id,
        "deal_name": deal_name,
        "stage": "Proposal/Price Quote",
    }


def _get_lead(lead_id: str) -> dict[str, Any]:
    raw = _raw("Leads", lead_id)
    if not raw:
        return {"error": f"CRM Lead {lead_id} not found"}
    return {
        "lead_id": lead_id,
        "name": raw.get("Full_Name")
        or " ".join(
            x for x in [raw.get("First_Name") or "", raw.get("Last_Name") or ""] if x
        ).strip(),
        "email": raw.get("Email") or "",
        "phone": raw.get("Phone") or "",
        "company": raw.get("Company") or "",
        "address": {
            "street": raw.get("Street") or "",
            "city": raw.get("City") or "",
            "state": raw.get("State") or "",
            "code": raw.get("Zip_Code") or "",
            "country": raw.get("Country") or "",
        },
    }


def _get_quote_lines(quote_id: str) -> dict[str, Any]:
    rec = quotes.get_quote(quote_id)
    if not rec:
        return {"error": f"Quote_Request {quote_id} not found"}
    lines = []
    for line in rec.get("Quote_Lines") or []:
        lines.append(
            {
                "part_number": line.get("Part_Number") or "",
                "description": line.get("Description") or "",
                "qty": line.get("Qty") or 0,
                "unit_price": line.get("Unit_Price") if line.get("Unit_Price") != "" else "",
                "fx_unit_price": line.get("FX_Unit_Price") if line.get("FX_Unit_Price") != "" else "",
                "line_total_usd": line.get("Line_Total_USD") if line.get("Line_Total_USD") != "" else "",
                "line_total_fx": line.get("Line_Total_FX") if line.get("Line_Total_FX") != "" else "",
                "kit_warning": line.get("Kit_Warning") or "",
            }
        )
    return {
        "lines": lines,
        "crm_deal_id": rec.get("CRM_Deal_ID") or "",
        "crm_contact_id": rec.get("CRM_Contact_ID") or "",
        "sign_request_id": rec.get("Sign_Request_ID") or "",
        "status": rec.get("Status") or "",
    }


def _sync_quote_to_crm(quote_id: str) -> dict[str, Any]:
    rec = quotes.get_quote(quote_id)
    if not rec:
        return {"error": "sync_quote_to_crm requires a Quote_Request record ID in Query_Text"}
    deal_id = (rec.get("CRM_Deal_ID") or "").strip()
    lines = rec.get("Quote_Lines") or []
    amount = 0.0
    for line in lines:
        try:
            lt = line.get("Line_Total_USD")
            if lt != "" and lt is not None:
                amount += float(lt)
            else:
                qty = float(line.get("Qty") or 0)
                unit = float(line.get("Unit_Price") or 0)
                amount += qty * unit
        except (TypeError, ValueError):
            pass
    amount = round(amount, 2)

    if deal_id:
        raw = _raw("Deals", deal_id) or {"Deal_Name": f"Local deal {deal_id}"}
        raw["Amount"] = amount
        if (raw.get("Stage") or "") not in CLOSED_STAGES:
            # forward-only soft bump for local testing
            if not raw.get("Stage"):
                raw["Stage"] = "Proposal/Price Quote"
        _upsert_record("Deals", deal_id, raw)

        # Replace Associated_Products for this deal (local sandbox)
        with db.connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE zoho_crm.records
                    SET deleted_at = now()
                    WHERE module_api_name = 'Associated_Products'
                      AND deleted_at IS NULL
                      AND (raw#>>'{Deal_Name,id}' = %s OR raw->>'Parent_Id' = %s)
                    """,
                    (deal_id, deal_id),
                )
                for i, line in enumerate(lines, start=1):
                    ap_id = f"{LOCAL_ID_PREFIX}-AP-{uuid4().hex[:10]}"
                    ap_raw = {
                        "Deal_Name": {"id": deal_id},
                        "Parent_Id": deal_id,
                        "Product_Code": line.get("Part_Number") or "",
                        "Product_Name": line.get("Description") or line.get("Part_Number") or "",
                        "Quantity": line.get("Qty") or 0,
                        "List_Price": line.get("Unit_Price") or 0,
                        "Line_Number": i,
                    }
                    cur.execute(
                        """
                        INSERT INTO zoho_crm.records
                          (module_api_name, record_id, modified_time, raw, synced_at)
                        VALUES ('Associated_Products', %s, now(), %s::jsonb, now())
                        ON CONFLICT (module_api_name, record_id) DO UPDATE SET
                          raw = EXCLUDED.raw, modified_time = now(), synced_at = now(), deleted_at = NULL
                        """,
                        (ap_id, json.dumps(ap_raw)),
                    )

    return {
        "status": "synced",
        "quote_id": quote_id,
        "crm_deal_id": deal_id,
        "amount": amount,
        "local": True,
    }


def _get_quote_by_number(query: str) -> dict[str, Any]:
    qno = (query or "").strip()
    if not qno:
        return {"error": "get_quote_by_number requires a quote number in Query_Text"}
    rec = quotes.get_quote_by_number(qno)
    if not rec:
        return {"error": f"No local quote found for {qno}", "description": ""}
    # Shape expected by widget: CRM quote-ish with description back-ref
    return {
        "quote_number": rec.get("Quote_Number") or qno,
        "description": f"QTS Quote_Request ID: {rec.get('ID')}",
        "subject": rec.get("Quote_Number") or qno,
        "grand_total": "",
        "local": True,
        "creator_quote_request_id": rec.get("ID"),
    }


def _expand_kit(payload: dict[str, Any]) -> dict[str, Any]:
    kit_key = str(payload.get("kit_key") or "").strip()
    if not kit_key:
        return {"error": "expand_kit requires kit_key in Payload_JSON"}
    series_text = str(payload.get("series_cell_count") or "").strip()
    series: int | None = None
    if series_text:
        try:
            series = int(float(series_text))
        except ValueError:
            return {
                "error": f'expand_kit: series_cell_count must be a whole number (got "{series_text}")'
            }
    result = expand_kit(kit_key, series)
    if result.get("error"):
        return {"error": result["error"]}
    return result


def dispatch(
    action: str, query_text: str | None, payload_json: str | None
) -> tuple[dict[str, Any], str]:
    action_name = (action or "").strip()
    query = (query_text or "").strip()
    payload = _parse_payload(payload_json)
    out: dict[str, Any] = {}

    try:
        if action_name == "search_customers":
            out = {"matches": _search_contacts(query)}
        elif action_name == "get_customer":
            if not query:
                out = {"error": "get_customer requires a Contact ID in Query_Text"}
            else:
                out = _get_customer(query)
        elif action_name == "create_customer":
            out = _create_customer(payload)
        elif action_name == "search_leads":
            out = {"lead_matches": _search_leads(query)}
        elif action_name == "get_lead":
            if not query:
                out = {"error": "get_lead requires a CRM Lead ID in Query_Text"}
            else:
                out = _get_lead(query)
        elif action_name == "search_deals":
            out = _search_deals(payload)
        elif action_name == "get_deal":
            if not query:
                out = {"error": "get_deal requires a CRM Deal record ID in Query_Text"}
            else:
                out = _get_deal(query)
        elif action_name == "create_deal":
            out = _create_deal(payload)
        elif action_name == "get_quote_lines":
            if not query:
                out = {"error": "get_quote_lines requires a Quote_Request record ID in Query_Text"}
            else:
                out = _get_quote_lines(query)
        elif action_name == "sync_quote_to_crm":
            if not query:
                out = {"error": "sync_quote_to_crm requires a Quote_Request record ID in Query_Text"}
            else:
                out = _sync_quote_to_crm(query)
        elif action_name == "expand_kit":
            out = _expand_kit(payload)
        elif action_name == "get_quote_by_number":
            out = _get_quote_by_number(query)
        elif action_name == "books_diag":
            out = {
                "organizations": [],
                "taxes": [],
                "tax_authorities": [],
                "local_stub": True,
                "message": "Books API stubbed in local_qts — no Zoho Books calls.",
            }
        elif action_name == "get_tax":
            out = {"taxes": [], "local_stub": True}
        elif action_name == "":
            out = {"error": "Missing Action_field"}
        else:
            out = {"error": f"Unknown Action: {action_name}"}
    except Exception as exc:  # noqa: BLE001 — surface to widget
        return {"error": f"{action_name} failed: {exc}"}, "error"

    if out.get("error"):
        return out, "error"
    return out, "done"
