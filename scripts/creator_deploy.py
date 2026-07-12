#!/usr/bin/env python3
"""Deploy a Deluge custom function to Zoho Creator DEV (proof of concept).

Targets the internal Creator builder save endpoint discovered/verified by
Blake on 2026-07-11. UNOFFICIAL and unstable by nature: it may change without
notice and rides a personal browser session, not OAuth.

Session material (never stored in the repo):
    ~/.config/qts/creator_session   (chmod 600 REQUIRED)
containing:
    cookie=<full Cookie header value from an authenticated Creator request>
    zccpn=<csrf token>              (optional; extracted from the cookie if absent)

Usage:
    python3 scripts/creator_deploy.py fn_sync_to_crm            # dry-run (default)
    python3 scripts/creator_deploy.py fn_sync_to_crm --deploy   # real POST (dev only)

Secrets are never printed. Default is dry-run. Production is unreachable by
construction: the URL is pinned to the dev appbuilder path.
"""

import json
import os
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SESSION_PATH = os.path.expanduser("~/.config/qts/creator_session")

# Dev builder path ONLY. There is deliberately no way to point this at
# production.
BASE = "https://creator.zoho.com/appbuilder/bevcollc/qts"
ENDPOINT = BASE + "/workflowbuilder/edit/populateCustomFunction"
APPID = "4929688000000038127"

# Allowlist. functionids extracted from the dev builder edit pages
# 2026-07-11 (method validated against the known fn_sync_to_crm id).
FUNCTIONS = {
    "fn_sync_to_crm": {
        "functionid": "4929688000000038300",
        "source": "deploy_ready/fn_sync_to_crm.creator.deluge",
        "mirror": "functions/fn_sync_to_crm.deluge",
        "scripttype": "workflowmodify",
    },
    "fn_sync_to_sheet": {
        "functionid": "4929688000000038346",
        "source": "deploy_ready/fn_sync_to_sheet.creator.deluge",
        "mirror": "functions/fn_sync_to_sheet.deluge",
        "scripttype": "workflowmodify",
    },
    "fn_generate_pdf": {
        "functionid": "4929688000000040014",
        "source": "deploy_ready/fn_generate_pdf.debug.deluge",
        "mirror": "functions/fn_generate_pdf.deluge",
        "scripttype": "workflowmodify",
    },
}


def fail(msg):
    print("[ERROR] " + msg)
    sys.exit(1)


def load_session(strict):
    if not os.path.exists(SESSION_PATH):
        if strict:
            fail("session file not found: " + SESSION_PATH)
        print("session: NOT CONFIGURED (%s missing) - fine for dry-run" % SESSION_PATH)
        return "", ""
    mode = stat.S_IMODE(os.stat(SESSION_PATH).st_mode)
    if mode & 0o077:
        fail("session file must be chmod 600 (current: %o): %s" % (mode, SESSION_PATH))
    cookie = ""
    zccpn = ""
    with open(SESSION_PATH, "r", encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if line.startswith("cookie="):
                cookie = line[len("cookie="):].strip()
            elif line.startswith("zccpn="):
                zccpn = line[len("zccpn="):].strip()
    if not cookie:
        fail("session file has no cookie= line")
    if not zccpn:
        m = re.search(r"(?:^|;\s*)zccpn=([^;]+)", cookie)
        if not m:
            fail("no zccpn= line and no zccpn cookie found in cookie header")
        zccpn = m.group(1).strip()
    # Never print values. Report presence only.
    print("session: cookie present (%d chars), zccpn present (%d chars)"
          % (len(cookie), len(zccpn)))
    return cookie, zccpn


def brace_balance(text):
    # Count braces outside double-quoted string literals (Deluge strings use
    # double quotes; JSON payloads built as strings contain braces that must
    # not count toward code structure).
    opens = 0
    closes = 0
    for line in text.split("\n"):
        in_string = False
        prev = ""
        i = 0
        while i < len(line):
            ch = line[i]
            if in_string:
                if ch == '"' and prev != "\\":
                    in_string = False
            else:
                if ch == "/" and prev == "/":
                    break  # // comment: ignore rest of line
                if ch == '"':
                    in_string = True
                elif ch == "{":
                    opens += 1
                elif ch == "}":
                    closes += 1
            prev = ch
            i += 1
    return opens, closes


def validate_source(cfg):
    src_path = os.path.join(REPO_ROOT, cfg["source"])
    mirror_path = os.path.join(REPO_ROOT, cfg["mirror"])
    if not os.path.exists(src_path):
        fail("source missing: " + cfg["source"])
    if not os.path.exists(mirror_path):
        fail("mirror missing: " + cfg["mirror"])
    with open(src_path, "r", encoding="utf-8") as fh:
        source = fh.read()
    with open(mirror_path, "r", encoding="utf-8") as fh:
        mirror = fh.read()
    if not source.strip():
        fail("source file is empty")
    if source != mirror:
        fail("deploy_ready and functions copies are NOT byte-identical - refusing")
    opens, closes = brace_balance(source)
    if opens != closes:
        fail("brace imbalance in source: %d open vs %d close" % (opens, closes))
    print("source: %s (%d bytes, braces %d/%d, mirror byte-identical)"
          % (cfg["source"], len(source.encode("utf-8")), opens, closes))
    return source


def build_form(cfg, name, source, zccpn):
    return {
        "appid": APPID,
        "freeflow": "false",
        "zccpn": zccpn,
        "zohoruntime": str(int(time.time() * 1000)),
        "language": "0",
        "script": source,
        "scripttype": cfg["scripttype"],
        "functionid": cfg["functionid"],
        "functionName": name,
        "sb_tracking": "true",
        "sb_compCategory": "Function",
    }


def deploy(name, cfg, form, cookie):
    body = urllib.parse.urlencode(form).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    req.add_header("Accept", "*/*")
    req.add_header("X-Requested-With", "XMLHttpRequest")
    req.add_header("Origin", "https://creator.zoho.com")
    req.add_header("Referer", BASE.replace("/appbuilder/", "/appbuilder/")
                   + "/customFunction/" + name + "/edit")
    req.add_header("Cookie", cookie)
    req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36")
    req.add_header("Accept-Language", "en-US,en;q=0.8")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            status = resp.status
            text = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as err:
        fail("HTTP %d from Creator (auth expired or endpoint changed?)" % err.code)
    except urllib.error.URLError as err:
        fail("network error: %s" % err.reason)
    try:
        payload = json.loads(text)
    except ValueError:
        fail("HTTP %d: non-JSON response (session expired? refresh %s)"
             % (status, SESSION_PATH))
    resp_status = str(payload.get("status", ""))
    line_number = payload.get("lineNumber", None)
    if resp_status == "success" and str(line_number) == "-1":
        print("[SUCCESS] %s saved (status=success, lineNumber=-1)" % name)
        return
    message = payload.get("message") or payload.get("error") or json.dumps(payload)[:400]
    if line_number is not None and str(line_number) != "-1":
        fail("compile/save failure at line %s: %s" % (line_number, message))
    fail("save failure: %s" % message)


def main():
    args = sys.argv[1:]
    do_deploy = "--deploy" in args
    names = [a for a in args if not a.startswith("--")]
    if len(names) != 1:
        fail("usage: creator_deploy.py <function_name> [--deploy]")
    name = names[0]
    if name not in FUNCTIONS:
        fail("function not in PoC allowlist: " + name
             + " (allowed: " + ", ".join(sorted(FUNCTIONS)) + ")")
    cfg = FUNCTIONS[name]
    source = validate_source(cfg)
    cookie, zccpn = load_session(do_deploy)
    form = build_form(cfg, name, source, zccpn)
    body_len = len(urllib.parse.urlencode(form).encode("utf-8"))
    print("target: %s (dev builder, appid %s, functionid %s)"
          % (ENDPOINT, APPID, cfg["functionid"]))
    print("form: %d fields, %d bytes urlencoded" % (len(form), body_len))
    if not do_deploy:
        print("[DRY-RUN] no request sent. Re-run with --deploy to save to Creator dev.")
        return
    deploy(name, cfg, form, cookie)


if __name__ == "__main__":
    main()
