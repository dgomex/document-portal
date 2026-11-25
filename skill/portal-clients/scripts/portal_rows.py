#!/usr/bin/env python3
"""Helpers that match the portal's own rules (library/src/util in the portal repo).

Usage:
  python portal_rows.py new-id CL [--existing CL-AAAAAA,CL-BBBBBB]
  python portal_rows.py check-client '{"name": "...", "email": "...", "language": "pt"}' [--clients clients.json]
  python portal_rows.py check-case '{"client_id": "CL-...", "case_name": "..."}' --clients clients.json
  python portal_rows.py cell '=SUM(A1)'
  python portal_rows.py check-items '[{"case_id": "CS-...", "title": "- Passaporte"}]' --cases CS-AAAAAA,CS-BBBBBB

clients.json: a list of {"client_id", "email", "additional_emails", "active"} read from the sheet.
check-items prints the rows ready to write (bullets stripped, formulas neutralised) and the problems found.
Prints JSON. Exit code 1 when a check finds problems.
"""
import json
import re
import secrets
import sys

CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
ID = re.compile(r"^(CL|CS|UP)-[0-9A-HJKMNP-TV-Z]{6}$")
EMAIL = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$")
# The Checklist levels the portal accepts ("requested" only on rows from before 0.6.0).
LEVELS = ("required", "optional", "waived", "requested")
BULLET = re.compile(r"^\s*(?:[-*•–—+]+|\(?\d{1,3}[.)]|\(?[a-z][.)])\s+", re.IGNORECASE)
DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def new_id(prefix, existing=()):
    taken = set(existing)
    while True:
        candidate = prefix + "-" + "".join(secrets.choice(CROCKFORD) for _ in range(6))
        if candidate not in taken:
            return candidate


def is_id(value, prefix):
    return bool(ID.match(str(value or ""))) and str(value).startswith(prefix + "-")


def norm_email(value):
    return str(value or "").strip().lower()


def is_email(value):
    e = norm_email(value)
    return len(e) <= 254 and bool(EMAIL.match(e))


def email_list(value):
    parts = [norm_email(p) for p in re.split(r"[;,\s]+", str(value or "")) if p.strip()]
    return [p for p in parts if is_email(p)], [p for p in parts if not is_email(p)]


def truthy(value):
    return value is True or str(value).strip().lower() in ("true", "verdadeiro", "sim", "yes", "1")


def cell(value):
    """Neutralise formula injection, as the portal does."""
    return "'" + value if isinstance(value, str) and re.match(r"^[=+\-@\t\r]", value) else value


def check_client(row, clients=()):
    problems = []
    name = str(row.get("name") or "").strip()
    if not 1 <= len(name) <= 120:
        problems.append("name must be 1-120 characters")
    if not is_email(row.get("email")):
        problems.append("invalid email: %s" % row.get("email"))
    extra_ok, extra_bad = email_list(row.get("additional_emails"))
    if extra_bad:
        problems.append("invalid additional_emails: " + ", ".join(extra_bad))
    if row.get("language") and row["language"] not in ("pt", "en", "es"):
        problems.append("language must be pt, en or es")
    wanted = {norm_email(row.get("email"))} | set(extra_ok)
    for c in clients:
        if c.get("client_id") and c.get("client_id") == row.get("client_id"):
            continue
        theirs = {norm_email(c.get("email"))} | set(email_list(c.get("additional_emails"))[0])
        for e in sorted(wanted & theirs):
            state = "active" if truthy(c.get("active")) else "inactive"
            problems.append("email %s already used by %s (%s)" % (e, c.get("client_id"), state))
    return problems


def check_case(row, clients=()):
    problems = []
    name = str(row.get("case_name") or "").strip()
    if not 1 <= len(name) <= 120:
        problems.append("case_name must be 1-120 characters")
    status = str(row.get("status") or "open").strip().lower()
    if status not in ("open", "closed"):
        problems.append("status must be open or closed")
    if row.get("responsible_email") and not is_email(row["responsible_email"]):
        problems.append("invalid responsible_email")
    owner = next((c for c in clients if c.get("client_id") == row.get("client_id")), None)
    if not owner:
        problems.append("unknown client_id: %s" % row.get("client_id"))
    elif not truthy(owner.get("active")):
        problems.append("client %s is inactive" % row.get("client_id"))
    return problems


def clean_title(value):
    """A document title as a lawyer may paste it: without the list bullet or number."""
    return BULLET.sub("", str(value or "")).strip()


def check_items(rows, case_ids=()):
    """Checklist rows to write: cleaned, with formulas neutralised. Returns (rows, problems)."""
    known = set(case_ids)
    out, problems = [], []
    for n, row in enumerate(rows, 1):
        r = {k: row.get(k, "") for k in ("case_id", "section", "title", "instructions", "level", "due_date")}
        r["title"] = clean_title(r["title"])
        r["level"] = str(r["level"] or "required").strip().lower()
        if not r["title"]:
            problems.append("row %d: title is empty" % n)
        if known and r["case_id"] not in known:
            problems.append("row %d: unknown case_id: %s" % (n, r["case_id"]))
        if r["level"] not in LEVELS[:3]:
            problems.append("row %d: level must be required, optional or waived" % n)
        if r["due_date"] and not DAY.match(str(r["due_date"])):
            problems.append("row %d: due_date must be YYYY-MM-DD" % n)
        out.append({k: cell(str(v).strip()) if isinstance(v, str) else v for k, v in r.items()})
    return out, problems


def _arg(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        return sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
    return None


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    cmd, value = sys.argv[1], sys.argv[2]
    clients_path = _arg("--clients")
    clients = json.load(open(clients_path)) if clients_path else []
    if cmd == "new-id":
        existing = [x for x in (_arg("--existing") or "").split(",") if x]
        print(json.dumps({"id": new_id(value, existing)}))
        return 0
    if cmd == "cell":
        print(json.dumps({"value": cell(value)}))
        return 0
    if cmd == "check-items":
        cases = [x for x in (_arg("--cases") or "").split(",") if x]
        rows, problems = check_items(json.loads(value), cases)
        print(json.dumps({"ok": not problems, "rows": rows, "problems": problems}, ensure_ascii=False))
        return 1 if problems else 0
    if cmd in ("check-client", "check-case"):
        row = json.loads(value)
        problems = (check_client if cmd == "check-client" else check_case)(row, clients)
        print(json.dumps({"ok": not problems, "problems": problems}, ensure_ascii=False))
        return 1 if problems else 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
