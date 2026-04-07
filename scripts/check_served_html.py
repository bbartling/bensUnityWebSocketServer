"""Basic smoke check: served HTML returns 200 and local static refs resolve.

For browser console / JS runtime issues, run (with Playwright installed):

  pip install playwright && playwright install chromium
  python scripts/check_browser_console.py http://127.0.0.1:8000
"""
from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8877"

PAGES = [
    "/lobber/man.html",
    "/lobber/boy.html",
    "/lobber/index.html",
    "/tetris/man.html",
    "/tetris/boy.html",
    "/tetris/index.html",
    "/pong/man.html",
    "/pong/boy.html",
    "/pong/index.html",
    "/",
]

ATTR_RE = re.compile(r"""(?:href|src)=["']([^"']+)["']""", re.I)


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=10) as r:
        return r.read().decode("utf-8", errors="replace")


def check_url(url: str) -> tuple[bool, str]:
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=10) as r:
            if r.status != 200:
                return False, f"HEAD status {r.status}"
    except urllib.error.HTTPError as e:
        if e.code == 405:
            with urllib.request.urlopen(url, timeout=10) as r2:
                if r2.status != 200:
                    return False, f"GET status {r2.status}"
        else:
            return False, str(e)
    except Exception as e:
        try:
            with urllib.request.urlopen(url, timeout=10) as r3:
                if r3.status != 200:
                    return False, f"GET status {r3.status}"
        except Exception as e2:
            return False, str(e2)
    return True, "ok"


def main() -> int:
    issues: list[tuple[str, str]] = []
    for path in PAGES:
        body = fetch(BASE + path)
        low = body.lower()
        if "<html" not in low:
            issues.append((path, "missing <html"))
        if "</html>" not in low:
            issues.append((path, "missing </html>"))
        base_dir = path.rsplit("/", 1)[0] if "/" in path.strip("/") else ""
        for m in ATTR_RE.findall(body):
            if m.startswith(("http://", "https://", "mailto:", "data:", "#")):
                continue
            if m.startswith("javascript:"):
                continue
            if m.startswith("/"):
                url = BASE + m
            else:
                prefix = BASE + (base_dir + "/" if base_dir else "/")
                url = prefix + m
            ok, msg = check_url(url)
            if not ok:
                issues.append((path, f"ref {m!r}: {msg}"))

    if issues:
        for p, msg in issues:
            print(f"FAIL {p}: {msg}")
        return 1
    print(f"OK: {len(PAGES)} pages, structure + local assets resolve at {BASE}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
