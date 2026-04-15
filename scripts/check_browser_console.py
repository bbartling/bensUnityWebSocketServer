"""Headless browser: load every arcade game URL and fail on console or page issues.

Requires: pip install playwright && playwright install chromium

Loads each path from arcade_game_urls.BROWSER_CONSOLE_CHECK_PAGES (dashboard + all
game entry pages). Fails on: uncaught page errors, console type `error`, and
console type `warning` unless the message matches an allowlisted substring in
arcade_game_urls.ALLOWED_CONSOLE_WARNING_SUBSTRINGS.

At the end prints '--- verification ---' and a single VERIFICATION line:
  PASSED (exit 0), FAILED (exit 1), or SKIPPED if Playwright is missing (exit 2).

Usage:
  python scripts/check_browser_console.py http://127.0.0.1:8877
"""
from __future__ import annotations

import sys
from pathlib import Path

_BASE_DIR = Path(__file__).resolve().parent
if str(_BASE_DIR) not in sys.path:
    sys.path.insert(0, str(_BASE_DIR))

from arcade_game_urls import ALLOWED_CONSOLE_WARNING_SUBSTRINGS, BROWSER_CONSOLE_CHECK_PAGES

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"

PAGES = BROWSER_CONSOLE_CHECK_PAGES


def blocking_warnings(warns: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Drop warnings whose text contains any allowlisted substring (case-insensitive)."""
    if not warns:
        return []
    allow = [a.lower() for a in ALLOWED_CONSOLE_WARNING_SUBSTRINGS if a]
    bad: list[tuple[str, str]] = []
    for t, text in warns:
        low = text.lower()
        if any(fragment in low for fragment in allow):
            continue
        bad.append((t, text))
    return bad


def run_lobber_functional_smoke(page) -> list[str]:
    """Return a list of functional failures (empty list means pass)."""
    fails: list[str] = []
    try:
        canvas = page.locator("#gameCanvas")
        picker = page.locator("#emojiPicker")
        grid_buttons = page.locator("#emojiGrid button")
        lock_btn = page.locator("#lockEmoji")
        open_builder_game_blank = page.locator("#openLevelBuilderGameBlank")

        if canvas.count() != 1:
            fails.append("missing #gameCanvas")
            return fails
        if picker.count() != 1 or not picker.is_visible():
            fails.append("emoji picker not visible on load")
            return fails
        if grid_buttons.count() < 1:
            fails.append("no hero buttons in #emojiGrid")
            return fails
        if lock_btn.count() != 1:
            fails.append("missing #lockEmoji")
            return fails

        # Select hero + lock in, confirm picker hides and gameplay begins.
        grid_buttons.first.click(timeout=4000)
        lock_btn.click(timeout=4000)
        page.wait_for_timeout(300)
        if picker.is_visible():
            fails.append("picker still visible after lock-in")

        # Open builder from in-game button (picker button is hidden after lock-in).
        if open_builder_game_blank.count() != 1:
            fails.append("missing #openLevelBuilderGameBlank")
            return fails
        open_builder_game_blank.click(timeout=4000)
        page.wait_for_timeout(400)

        panel = page.locator("#lobberBuilderPanel")
        play_btn = page.locator("#lobberBuilderPlay")
        blank_btn = page.locator("#lobberBuilderBlank")
        turn_line = page.locator("#turnLine")
        if panel.count() != 1 or not panel.is_visible():
            fails.append("builder panel failed to open")
            return fails
        if blank_btn.count() != 1:
            fails.append("missing #lobberBuilderBlank")
            return fails

        blank_btn.click(timeout=4000)
        page.wait_for_timeout(250)
        if play_btn.count() != 1:
            fails.append("missing #lobberBuilderPlay")
            return fails
        page.once("dialog", lambda d: d.accept())
        play_btn.click(timeout=4000)
        page.wait_for_timeout(300)
        txt = turn_line.inner_text(timeout=4000).lower()
        if "at least 1 villain" not in txt and "at least one villain" not in txt:
            fails.append("missing no-villain play-test gate message")
    except Exception as e:
        fails.append(f"functional smoke exception: {e}")
    return fails


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
        print()
        print("--- verification ---")
        print("VERIFICATION: SKIPPED - Playwright not installed; browser console was not checked.")
        return 2

    exit_code = 0
    n_ok = 0
    n_fail = 0
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
                n_fail += 1
                page.close()
                continue

            if page_errors:
                exit_code = 1
                n_fail += 1
                print(f"PAGEERROR {path}:")
                for e in page_errors:
                    print(f"  {e}")
            errs = [x for x in logs if x[0] == "error"]
            warns = [x for x in logs if x[0] == "warning"]
            bad_warns = blocking_warnings(warns)
            if path == "/lobber/game.html":
                func_fails = run_lobber_functional_smoke(page)
                if func_fails:
                    exit_code = 1
                    n_fail += 1
                    print(f"FUNCTIONAL.fail {path}:")
                    for f in func_fails:
                        print(f"  {f}")
            if errs:
                exit_code = 1
                if not page_errors:
                    n_fail += 1
                print(f"CONSOLE.error {path}:")
                for _t, text in errs:
                    print(f"  {text}")
            if bad_warns:
                exit_code = 1
                if not page_errors and not errs:
                    n_fail += 1
                print(f"CONSOLE.warning {path}:")
                for _t, text in bad_warns:
                    print(f"  {text}")
            elif warns:
                print(f"CONSOLE.warning (allowlisted) {path}: {len(warns)} message(s)")
            if not page_errors and not errs and not bad_warns:
                print(f"OK {path} (no errors / no blocking warnings in 3.5s window)")
                n_ok += 1

            page.close()
        browser.close()

    print()
    print("--- verification ---")
    if exit_code != 0:
        print(
            f"VERIFICATION: FAILED - {n_fail} page load(s) with page errors, console errors, "
            f"blocking console warnings, functional smoke failure, or navigation error (see above). "
            f"Clean pages: {n_ok}."
        )
    else:
        print(
            f"VERIFICATION: PASSED - no page errors, no console errors, and no blocking console warnings "
            f"across {len(PAGES)} pages."
        )

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
