from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import bridge_store, catalog, quotes
from .config import FRONTEND_DIR, PORT, STATIC_DIR
from .criteria import parse_criteria

app = FastAPI(title="Local QTS", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def _field_map(body: dict[str, Any]) -> dict[str, Any]:
    data = body.get("data")
    if isinstance(data, dict) and isinstance(data.get("data"), dict):
        return data["data"]
    if isinstance(data, dict):
        return data
    return {}


@app.get("/api/health")
def health() -> dict[str, Any]:
    try:
        from . import db

        row = db.fetch_one(
            "SELECT count(*) AS n FROM zoho_crm.records WHERE deleted_at IS NULL"
        )
        items = db.fetch_one(
            "SELECT count(*) AS n FROM item_master WHERE retired_at IS NULL"
        )
        return {
            "ok": True,
            "crm_records": row["n"] if row else 0,
            "item_master": items["n"] if items else 0,
            "mode": "local_postgres",
        }
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "error": str(exc)}


@app.post("/api/creator/init")
def creator_init() -> dict[str, Any]:
    return {"code": 3000, "message": "local init ok"}


@app.post("/api/creator/getAllRecords")
async def creator_get_all(request: Request) -> dict[str, Any]:
    body = await request.json()
    report = body.get("reportName") or body.get("report_name") or ""
    return catalog.get_all_records(
        report,
        criteria=body.get("criteria"),
        page=body.get("page") or 1,
        page_size=body.get("pageSize") or body.get("page_size") or 200,
    )


@app.post("/api/creator/getRecordById")
async def creator_get_by_id(request: Request) -> dict[str, Any]:
    body = await request.json()
    report = (body.get("reportName") or body.get("report_name") or "").strip()
    record_id = str(body.get("id") or "")
    if not record_id:
        raise HTTPException(400, "id required")

    if report in ("Quote_Request_Report", "Quote_Request"):
        rec = quotes.get_quote(record_id)
        if not rec:
            raise HTTPException(404, f"Quote_Request {record_id} not found")
        return {"code": 3000, "data": rec}

    if report in ("CRM_Bridge_Report", "CRM_Bridge"):
        rec = bridge_store.get_bridge(record_id)
        if not rec:
            raise HTTPException(404, f"CRM_Bridge {record_id} not found")
        return {"code": 3000, "data": rec}

    resp = catalog.get_all_records(report, criteria=f'ID == "{record_id}"')
    rows = resp.get("data") or []
    if not rows:
        raise HTTPException(404, f"{report} record {record_id} not found")
    return {"code": 3000, "data": rows[0]}


@app.post("/api/creator/addRecord")
async def creator_add(request: Request) -> dict[str, Any]:
    body = await request.json()
    form = (body.get("formName") or body.get("form_name") or "").strip()
    fields = _field_map(body)

    if form in ("CRM_Bridge",):
        action = fields.get("Action_field") or fields.get("Action") or ""
        query = fields.get("Query_Text") or ""
        payload = fields.get("Payload_JSON")
        record_id = bridge_store.create_bridge(action, query, payload)
        return {"code": 3000, "data": {"ID": record_id}}

    if form in ("Quote_Request",):
        record_id = quotes.create_quote(fields)
        return {"code": 3000, "data": {"ID": record_id}}

    raise HTTPException(400, f"Unsupported formName for local add: {form}")


@app.post("/api/creator/updateRecord")
async def creator_update(request: Request) -> dict[str, Any]:
    body = await request.json()
    report = (body.get("reportName") or body.get("report_name") or "").strip()
    record_id = str(body.get("id") or "")
    fields = _field_map(body)
    if not record_id:
        raise HTTPException(400, "id required")

    if report in ("Quote_Request_Report", "Quote_Request"):
        quotes.update_quote(record_id, fields)
        return {"code": 3000, "data": {"ID": record_id}}

    raise HTTPException(400, f"Unsupported reportName for local update: {report}")


@app.post("/api/creator/deleteRecord")
async def creator_delete(request: Request) -> dict[str, Any]:
    body = await request.json()
    report = (body.get("reportName") or body.get("report_name") or "").strip()
    criteria = body.get("criteria") or ""
    filters = parse_criteria(criteria)
    record_id = filters.get("ID")
    if not record_id:
        raise HTTPException(400, "delete requires ID in criteria")

    if report in ("Quote_Request_Report", "Quote_Request"):
        require_draft = "Status" in filters
        try:
            quotes.delete_quote(str(record_id), require_draft=require_draft)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"code": 3000, "data": [{"ID": record_id}]}

    raise HTTPException(400, f"Unsupported reportName for local delete: {report}")


@app.get("/")
def index() -> FileResponse:
    path = FRONTEND_DIR / "index.html"
    if not path.exists():
        raise HTTPException(404, "frontend/index.html missing")
    return FileResponse(path)


@app.get("/{asset_path:path}")
def frontend_asset(asset_path: str) -> FileResponse:
    if asset_path.startswith("api/") or asset_path.startswith("static/"):
        raise HTTPException(404)
    candidate = (FRONTEND_DIR / asset_path).resolve()
    root = FRONTEND_DIR.resolve()
    if not str(candidate).startswith(str(root)) or not candidate.is_file():
        raise HTTPException(404, asset_path)
    return FileResponse(candidate)


def run() -> None:
    import uvicorn

    uvicorn.run(
        "server.main:app",
        host="127.0.0.1",
        port=PORT,
        reload=False,
    )


if __name__ == "__main__":
    run()
