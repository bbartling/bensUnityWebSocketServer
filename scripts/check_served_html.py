"""Basic smoke check: served HTML returns 200 and local static refs resolve.

URLs are listed in arcade_game_urls.SERVED_HTML_CHECK_PAGES (dashboard + every
game HTML entry point). Optional snippets in arcade_game_urls.REQUIRED_HTML_SNIPPETS
(Lobber + MQTT room picker). arcade_game_urls.ARCADE_ROOM_STATIC_ASSETS are HEAD-checked too.

At the end prints '--- verification ---' and VERIFICATION: PASSED or FAILED
(no errors means exit code 0 and a PASSED line with no FAIL lines above).

For browser console / JS runtime issues, run (with Playwright installed):

  pip install playwright && playwright install chromium
  python scripts/check_browser_console.py http://127.0.0.1:8000
"""
from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

_BASE_DIR = Path(__file__).resolve().parent
if str(_BASE_DIR) not in sys.path:
    sys.path.insert(0, str(_BASE_DIR))

from arcade_game_urls import ARCADE_ROOM_STATIC_ASSETS, REQUIRED_HTML_SNIPPETS, SERVED_HTML_CHECK_PAGES

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8877"

PAGES = SERVED_HTML_CHECK_PAGES

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
    try:
        for path in PAGES:
            body = fetch(BASE + path)
            low = body.lower()
            if "<html" not in low:
                issues.append((path, "missing <html"))
            if "</html>" not in low:
                issues.append((path, "missing </html>"))
            req = REQUIRED_HTML_SNIPPETS.get(path)
            if req:
                for snip in req:
                    if snip.lower() not in low:
                        issues.append((path, f"missing required snippet {snip!r}"))
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
        for asset in ARCADE_ROOM_STATIC_ASSETS:
            aurl = BASE.rstrip("/") + asset
            ok_a, msg_a = check_url(aurl)
            if not ok_a:
                issues.append((asset, f"arcade room asset: {msg_a}"))
    except Exception as e:
        print(f"FAIL fetch: {e}")
        print()
        print("--- verification ---")
        print(f"VERIFICATION: FAILED - could not load pages from {BASE!r} (server down or wrong URL).")
        return 1

    if issues:
        for p, msg in issues:
            print(f"FAIL {p}: {msg}")
        print()
        print("--- verification ---")
        print(f"VERIFICATION: FAILED - {len(issues)} issue(s) (see FAIL lines above).")
        return 1
    print(
        f"OK: {len(PAGES)} pages + {len(ARCADE_ROOM_STATIC_ASSETS)} room static assets, "
        f"structure + local assets resolve at {BASE}",
    )
    print()
    print("--- verification ---")
    print(
        f"VERIFICATION: PASSED - no errors: {len(PAGES)} pages, required snippets OK, "
        f"{len(ARCADE_ROOM_STATIC_ASSETS)} room static assets OK, "
        f"in-page local asset URLs returned HTTP 200 at {BASE}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
