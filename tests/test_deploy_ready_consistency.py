import re
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DEPLOY = REPO / "deploy_ready"
WIDGET_ZIP = REPO / "widget" / "dist" / "qts-quote-builder.zip"


def test_widget_zip_has_manifest_and_app():
    with zipfile.ZipFile(WIDGET_ZIP) as z:
        names = z.namelist()
    assert "plugin-manifest.json" in names
    assert "app/widget.html" in names
    assert "app/lib/widgetsdk-min.js" in names


def test_widget_zip_matches_app_source():
    with zipfile.ZipFile(WIDGET_ZIP) as z:
        zipped = z.read("app/widget.js")
    source = (REPO / "widget" / "app" / "widget.js").read_bytes()
    assert zipped == source, "widget/dist zip is stale — rebuild before deploying"


def test_deluge_braces_balanced():
    for f in DEPLOY.rglob("*.deluge"):
        text = re.sub(r'"(?:[^"\\]|\\.)*"', '""', f.read_text())
        assert text.count("{") == text.count("}"), f"unbalanced braces in {f}"


def test_search_workflows_have_min_length_guard():
    crm_bridge = DEPLOY / "creator" / "workflow" / "form_workflows" / "crm_bridge"
    for name in ("search_customers", "search_leads"):
        text = (crm_bridge / f"{name}.creator.deluge").read_text()
        assert "query_text.len() >= 3" in text, f"{name} lost the 3-char guard"
