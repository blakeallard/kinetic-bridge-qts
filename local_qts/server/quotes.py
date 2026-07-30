from __future__ import annotations

import random
import re
import time
from datetime import date, datetime
from typing import Any

from . import db


def local_numeric_id(prefix_digit: str = "9") -> str:
    """Creator-shaped numeric id so widget regexes (\\d+) still work."""
    return f"{prefix_digit}{int(time.time() * 1000)}{random.randint(100, 999)}"

_MONTHS = {
    "Jan": 1,
    "Feb": 2,
    "Mar": 3,
    "Apr": 4,
    "May": 5,
    "Jun": 6,
    "Jul": 7,
    "Aug": 8,
    "Sep": 9,
    "Oct": 10,
    "Nov": 11,
    "Dec": 12,
}


def _parse_creator_date(val: Any) -> date | None:
    if val is None or val == "":
        return None
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    s = str(val).strip()
    # ISO
    try:
        return date.fromisoformat(s[:10])
    except ValueError:
        pass
    # dd-MMM-yyyy
    m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{4})$", s)
    if m:
        day, mon, year = int(m.group(1)), _MONTHS.get(m.group(2).title()), int(m.group(3))
        if mon:
            return date(year, mon, day)
    return None


def _fmt_date(d: date | None) -> str:
    if not d:
        return ""
    return d.strftime("%d-%b-%Y")


def _next_quote_number(conn) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT document_number FROM document_number_log
            WHERE type_code = 'QUOTE'
            ORDER BY issued_at DESC NULLS LAST, id DESC
            LIMIT 200
            """
        )
        nums = []
        for row in cur.fetchall():
            dn = row["document_number"] or ""
            m = re.search(r"(\d+)$", dn)
            if m:
                nums.append(int(m.group(1)))
        cur.execute(
            """
            SELECT quote_number FROM quote_request
            WHERE quote_number IS NOT NULL
            """
        )
        for row in cur.fetchall():
            m = re.search(r"(\d+)$", row["quote_number"] or "")
            if m:
                nums.append(int(m.group(1)))
        nxt = (max(nums) if nums else 0) + 1
        qno = f"QUOTE{nxt:04d}"
        zoho_id = local_numeric_id("8")
        cur.execute(
            """
            INSERT INTO document_number_log
              (zoho_record_id, type_code, document_number, status, notes, issued_at)
            VALUES (%s, 'QUOTE', %s, 'Active', 'local_qts', now())
            """,
            (zoho_id, qno),
        )
        return qno


def _lines_for(zoho_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT line_number, part_number, description, qty, unit_price, fx_unit_price,
               line_total_usd, line_total_fx, kit_warning
        FROM quote_lines
        WHERE quote_request_zoho_id = %s
        ORDER BY line_number
        """,
        (zoho_id,),
    )
    return [
        {
            "Part_Number": r["part_number"] or "",
            "Description": r["description"] or "",
            "Qty": float(r["qty"]) if r["qty"] is not None else 0,
            "Unit_Price": float(r["unit_price"]) if r["unit_price"] is not None else "",
            "FX_Unit_Price": float(r["fx_unit_price"]) if r["fx_unit_price"] is not None else "",
            "Line_Total_USD": float(r["line_total_usd"]) if r["line_total_usd"] is not None else "",
            "Line_Total_FX": float(r["line_total_fx"]) if r["line_total_fx"] is not None else "",
            "Kit_Warning": r["kit_warning"] or "",
        }
        for r in rows
    ]


def _row_to_creator(r: dict[str, Any], include_lines: bool = True) -> dict[str, Any]:
    out = {
        "ID": r["zoho_record_id"],
        "Quote_Number": r["quote_number"] or "",
        "Status": r["status"] or "",
        "Customer_Name": r["customer_name"] or "",
        "Customer_Company": r["customer_company"] or "",
        "Customer_Email": r["customer_email"] or "",
        "Customer_Phone": r["customer_phone"] or "",
        "Customer_Type": r["customer_type"] or "",
        "CRM_Lead_ID": r["crm_lead_id"] or "",
        "CRM_Contact_ID": r["crm_contact_id"] or "",
        "CRM_Account_ID": r["crm_account_id"] or "",
        "CRM_Deal_ID": r["crm_deal_id"] or "",
        "Notes": r["notes"] or "",
        "Quote_Date": _fmt_date(r["quote_date"]),
        "Valid_Until": _fmt_date(r["valid_until"]),
        "old_currency": r["old_currency"] or "",
        "Currency": r["old_currency"] or "USD",
        "EUR_USD_Rate": str(r["eur_usd_rate"]) if r["eur_usd_rate"] is not None else "",
        "FX_Charge_Mode": r["fx_charge_mode"] or "",
        "Markup_Rate_Pct": str(r["markup_rate_pct"]) if r["markup_rate_pct"] is not None else "",
        "Lifecycle_Stamped": bool(r["lifecycle_stamped"]) if r["lifecycle_stamped"] is not None else False,
        "Sign_Request_ID": "",
        "Payment_Terms": "",
    }
    if include_lines:
        out["Quote_Lines"] = _lines_for(r["zoho_record_id"])
    return out


def list_quotes(filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT * FROM quote_request
        ORDER BY id DESC
        """
    )
    out = []
    for r in rows:
        rec = _row_to_creator(r, include_lines=False)
        if filters:
            ok = True
            for k, v in filters.items():
                if str(rec.get(k, "")) != str(v):
                    ok = False
                    break
            if not ok:
                continue
        out.append(rec)
    return out


def get_quote(record_id: str) -> dict[str, Any] | None:
    r = db.fetch_one(
        "SELECT * FROM quote_request WHERE zoho_record_id = %s",
        (str(record_id),),
    )
    if not r:
        return None
    return _row_to_creator(r, include_lines=True)


def get_quote_by_number(quote_number: str) -> dict[str, Any] | None:
    r = db.fetch_one(
        "SELECT * FROM quote_request WHERE quote_number = %s ORDER BY id DESC LIMIT 1",
        (quote_number.strip(),),
    )
    if not r:
        return None
    return _row_to_creator(r, include_lines=True)


def _replace_lines(conn, zoho_id: str, lines: list[dict[str, Any]] | None) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM quote_lines WHERE quote_request_zoho_id = %s", (zoho_id,))
        if not lines:
            return
        for i, line in enumerate(lines, start=1):
            qty = line.get("Qty")
            try:
                qty_n = float(qty) if qty is not None and qty != "" else None
            except (TypeError, ValueError):
                qty_n = None
            unit = line.get("Unit_Price")
            try:
                unit_n = float(unit) if unit is not None and unit != "" else None
            except (TypeError, ValueError):
                unit_n = None
            total = line.get("Line_Total_USD")
            try:
                total_n = float(total) if total is not None and total != "" else None
            except (TypeError, ValueError):
                total_n = None
            if total_n is None and unit_n is not None and qty_n is not None:
                total_n = round(unit_n * qty_n, 2)
            # Look up description from item_master when missing
            desc = line.get("Description") or ""
            part = line.get("Part_Number") or ""
            if not desc and part:
                cur.execute(
                    "SELECT description FROM item_master WHERE part_number = %s LIMIT 1",
                    (part,),
                )
                im = cur.fetchone()
                if im:
                    desc = im["description"] or ""
            cur.execute(
                """
                INSERT INTO quote_lines
                  (quote_request_zoho_id, line_number, part_number, description, qty,
                   unit_price, line_total_usd, kit_warning, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'local_qts')
                """,
                (
                    zoho_id,
                    i,
                    part,
                    desc,
                    qty_n,
                    unit_n,
                    total_n,
                    line.get("Kit_Warning") or "",
                ),
            )


def create_quote(field_map: dict[str, Any]) -> str:
    zoho_id = local_numeric_id("9")
    lines = field_map.get("Quote_Lines")
    with db.connect() as conn:
        qno = field_map.get("Quote_Number") or _next_quote_number(conn)
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO quote_request (
                  zoho_record_id, quote_number, status, customer_name, customer_company,
                  customer_email, customer_phone, customer_type, old_currency,
                  quote_date, valid_until, crm_lead_id, crm_contact_id,
                  crm_account_id, crm_deal_id, notes
                ) VALUES (
                  %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                """,
                (
                    zoho_id,
                    qno,
                    field_map.get("Status") or "Draft",
                    field_map.get("Customer_Name") or "",
                    field_map.get("Customer_Company") or "",
                    field_map.get("Customer_Email") or "",
                    field_map.get("Customer_Phone") or "",
                    field_map.get("Customer_Type") or "",
                    field_map.get("Currency") or field_map.get("old_currency") or "USD",
                    _parse_creator_date(field_map.get("Quote_Date")),
                    _parse_creator_date(field_map.get("Valid_Until")),
                    field_map.get("CRM_Lead_ID") or "",
                    field_map.get("CRM_Contact_ID") or "",
                    field_map.get("CRM_Account_ID") or "",
                    field_map.get("CRM_Deal_ID") or "",
                    field_map.get("Notes") or "",
                ),
            )
        _replace_lines(conn, zoho_id, lines if isinstance(lines, list) else None)
    return zoho_id


def update_quote(record_id: str, field_map: dict[str, Any]) -> str:
    zoho_id = str(record_id)
    existing = db.fetch_one(
        "SELECT zoho_record_id FROM quote_request WHERE zoho_record_id = %s",
        (zoho_id,),
    )
    if not existing:
        raise ValueError(f"Quote_Request {zoho_id} not found")

    cols = {
        "Status": "status",
        "Customer_Name": "customer_name",
        "Customer_Company": "customer_company",
        "Customer_Email": "customer_email",
        "Customer_Phone": "customer_phone",
        "Customer_Type": "customer_type",
        "CRM_Lead_ID": "crm_lead_id",
        "CRM_Contact_ID": "crm_contact_id",
        "CRM_Account_ID": "crm_account_id",
        "CRM_Deal_ID": "crm_deal_id",
        "Notes": "notes",
        "Quote_Number": "quote_number",
    }
    sets = []
    params: list[Any] = []
    for src, col in cols.items():
        if src in field_map:
            sets.append(f"{col} = %s")
            params.append(field_map[src])
    if "Currency" in field_map:
        sets.append("old_currency = %s")
        params.append(field_map["Currency"])
    if "Quote_Date" in field_map:
        sets.append("quote_date = %s")
        params.append(_parse_creator_date(field_map["Quote_Date"]))
    if "Valid_Until" in field_map:
        sets.append("valid_until = %s")
        params.append(_parse_creator_date(field_map["Valid_Until"]))
    sets.append("synced_at = now()")

    with db.connect() as conn:
        if sets:
            with conn.cursor() as cur:
                params.append(zoho_id)
                cur.execute(
                    f"UPDATE quote_request SET {', '.join(sets)} WHERE zoho_record_id = %s",
                    params,
                )
        if "Quote_Lines" in field_map:
            lines = field_map.get("Quote_Lines")
            _replace_lines(conn, zoho_id, lines if isinstance(lines, list) else None)
    return zoho_id


def delete_quote(record_id: str, require_draft: bool = True) -> None:
    zoho_id = str(record_id)
    row = db.fetch_one(
        "SELECT status FROM quote_request WHERE zoho_record_id = %s",
        (zoho_id,),
    )
    if not row:
        raise ValueError(f"Quote_Request {zoho_id} not found")
    if require_draft and (row["status"] or "") != "Draft":
        raise ValueError(f"Refuse delete: status is {row['status']!r}, not Draft")
    with db.connect() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM quote_lines WHERE quote_request_zoho_id = %s", (zoho_id,))
            cur.execute("DELETE FROM quote_request WHERE zoho_record_id = %s", (zoho_id,))
