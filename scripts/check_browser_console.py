"""Headless browser: load arcade pages and report console errors + uncaught page errors.

Requires: pip install playwright && playwright install chromium

Usage:
  python scripts/check_browser_console.py http://127.0.0.1:8877
"""
from __future__ import annotations

import sys

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"

PAGES = [
    "/",
    "/lobber/man.html",
    "/lobber/boy.html",
    "/tetris/man.html",
    "/tetris/boy.html",
    "/pong/man.html",
    "/pong/boy.html",
]


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(
            "SKIP: playwright not installed. Run:\n"
            "  pip install playwright\n"
            "  playwright install chromium",
            file=sys.stderr,
        )
        return 2

    exit_code = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for path in PAGES:
            url = BASE.rstrip("/") + path
            logs: list[tuple[str, str]] = []
            page_errors: list[str] = []

            def on_console(msg) -> None:
                t = msg.type
                text = msg.text
                if t in ("error", "warning"):
                    logs.append((t, text))

            page = browser.new_page()
            page.on("console", on_console)
            page.on("pageerror", lambda exc: page_errors.append(str(exc)))
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=25000)
                page.wait_for_timeout(3500)
            except Exception as e:
                print(f"FAIL {path}: navigation {e}")
                exit_code = 1
                page.close()
                continue

            if page_errors:
                exit_code = 1
                print(f"PAGEERROR {path}:")
                for e in page_errors:
                    print(f"  {e}")
            errs = [x for x in logs if x[0] == "error"]
            warns = [x for x in logs if x[0] == "warning"]
            if errs:
                exit_code = 1
                print(f"CONSOLE.error {path}:")
                for _t, text in errs:
                    print(f"  {text}")
            if warns:
                print(f"CONSOLE.warning {path}:")
                for _t, text in warns:
                    print(f"  {text}")
            if not page_errors and not errs and not warns:
                print(f"OK {path} (no errors/warnings in 3.5s window)")
            elif not page_errors and not errs:
                print(f"OK {path} (warnings only)")

            page.close()
        browser.close()

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
