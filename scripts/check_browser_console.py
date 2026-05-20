"""Headless browser: load every arcade game URL and fail on console or page issues.

Requires: pip install playwright && playwright install chromium

Loads each path from arcade_game_urls.BROWSER_CONSOLE_CHECK_PAGES (dashboard + all
game entry pages). Runs arcade room picker smoke on ROOM_PICK_BROWSER_FUNCTIONAL_PAGES.
Fails on: uncaught page errors, console type `error`, and
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
from urllib.parse import parse_qs, urlparse

_BASE_DIR = Path(__file__).resolve().parent
if str(_BASE_DIR) not in sys.path:
    sys.path.insert(0, str(_BASE_DIR))

from arcade_game_urls import (
    ALLOWED_CONSOLE_ERROR_SUBSTRINGS,
    ALLOWED_CONSOLE_WARNING_SUBSTRINGS,
    BROWSER_CONSOLE_CHECK_PAGES,
    ROOM_PICK_BROWSER_FUNCTIONAL_PAGES,
    SCRIBBLE_HOST_FUNCTIONAL_PAGE,
)

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


def blocking_errors(errs: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Drop errors whose text contains any allowlisted substring (case-insensitive)."""
    if not errs:
      return []
    allow = [a.lower() for a in ALLOWED_CONSOLE_ERROR_SUBSTRINGS if a]
    bad: list[tuple[str, str]] = []
    for t, text in errs:
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


def run_arcade_room_picker_smoke(page, path: str) -> list[str]:
    """MQTT silly-room picker: suggestions exist, click sets matching ?room= on Man/Boy links."""
    fails: list[str] = []
    try:
        root = page.locator("#arcadeRoomPick")
        if root.count() != 1:
            fails.append("missing #arcadeRoomPick")
            return fails
        sug = page.locator(".arcade-room-sug-btn")
        if sug.count() < 1:
            fails.append("no .arcade-room-sug-btn suggestions")
            return fails
        sug.first.click(timeout=5000)
        page.wait_for_timeout(250)
        man_a = page.locator("a.a").first
        boy_b = page.locator("a.b").first
        man_h = man_a.get_attribute("href") or ""
        boy_h = boy_b.get_attribute("href") or ""
        if "?room=" not in man_h:
            fails.append(f"MAN link missing ?room= (got {man_h!r})")
        if "?room=" not in boy_h:
            fails.append(f"BOY link missing ?room= (got {boy_h!r})")
        mq = (parse_qs(urlparse(man_h).query).get("room") or [""])[0]
        bq = (parse_qs(urlparse(boy_h).query).get("room") or [""])[0]
        if mq and bq and mq != bq:
            fails.append(f"MAN and BOY room slug mismatch: {mq!r} vs {bq!r}")
        slug_js = page.evaluate(
            "() => (window.ArcadeRoom && window.ArcadeRoom.slugify('  Big MOUSE!!  ')) || ''",
        )
        if slug_js != "big-mouse":
            fails.append(f"ArcadeRoom.slugify contract: expected 'big-mouse', got {slug_js!r}")
    except Exception as e:
        fails.append(f"arcade room picker smoke ({path}): {e}")
    return fails


def run_scribble_host_smoke(page) -> list[str]:
    """Scribble host: custom word textarea updates parsed count (Skribbl word;hint)."""
    fails: list[str] = []
    try:
        textarea = page.locator("#setCustomWords")
        count_el = page.locator("#customWordsCount")
        use_custom = page.locator("#setUseCustomWords")
        if textarea.count() != 1:
            fails.append("missing #setCustomWords")
            return fails
        if count_el.count() != 1:
            fails.append("missing #customWordsCount")
            return fails
        if use_custom.count() != 1:
            fails.append("missing #setUseCustomWords")
            return fails
        textarea.fill("mario;nintendo plumber pikachu;yellow electric mouse")
        page.wait_for_timeout(350)
        txt = count_el.inner_text(timeout=4000).lower()
        if "2 word" not in txt:
            fails.append(f"custom word parse count expected '2 words', got {txt!r}")
        use_custom.check(timeout=4000)
        page.wait_for_timeout(150)
        canvas = page.locator("#gameCanvas")
        if canvas.count() != 1:
            fails.append("missing #gameCanvas on host")
    except Exception as e:
        fails.append(f"scribble host smoke: {e}")
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
            bad_errs = blocking_errors(errs)
            warns = [x for x in logs if x[0] == "warning"]
            bad_warns = blocking_warnings(warns)
            lobber_fails: list[str] = []
            room_fails: list[str] = []
            scribble_fails: list[str] = []
            if path == "/lobber/game.html":
                lobber_fails = run_lobber_functional_smoke(page)
                if lobber_fails:
                    exit_code = 1
                    n_fail += 1
                    print(f"FUNCTIONAL.fail {path}:")
                    for f in lobber_fails:
                        print(f"  {f}")
            if path in ROOM_PICK_BROWSER_FUNCTIONAL_PAGES:
                room_fails = run_arcade_room_picker_smoke(page, path)
                if room_fails:
                    exit_code = 1
                    n_fail += 1
                    print(f"FUNCTIONAL.fail {path} (arcade room picker):")
                    for f in room_fails:
                        print(f"  {f}")
            if path == SCRIBBLE_HOST_FUNCTIONAL_PAGE:
                scribble_fails = run_scribble_host_smoke(page)
                if scribble_fails:
                    exit_code = 1
                    n_fail += 1
                    print(f"FUNCTIONAL.fail {path} (scribble host):")
                    for f in scribble_fails:
                        print(f"  {f}")
            if bad_errs:
                exit_code = 1
                if not page_errors:
                    n_fail += 1
                print(f"CONSOLE.error {path}:")
                for _t, text in bad_errs:
                    print(f"  {text}")
            elif errs:
                print(f"CONSOLE.error (allowlisted) {path}: {len(errs)} message(s)")
            if bad_warns:
                exit_code = 1
                if not page_errors and not bad_errs:
                    n_fail += 1
                print(f"CONSOLE.warning {path}:")
                for _t, text in bad_warns:
                    print(f"  {text}")
            elif warns:
                print(f"CONSOLE.warning (allowlisted) {path}: {len(warns)} message(s)")
            if (
                not page_errors
                and not bad_errs
                and not bad_warns
                and not lobber_fails
                and not room_fails
                and not scribble_fails
            ):
                extra = ""
                if path in ROOM_PICK_BROWSER_FUNCTIONAL_PAGES:
                    extra += ", arcade room picker OK"
                if path == SCRIBBLE_HOST_FUNCTIONAL_PAGE:
                    extra += ", scribble host OK"
                print(f"OK {path} (no errors / no blocking warnings in 3.5s window{extra})")
                n_ok += 1

            page.close()
        browser.close()

    print()
    print("--- verification ---")
    if exit_code != 0:
        print(
            f"VERIFICATION: FAILED - {n_fail} page load(s) with page errors, console errors, "
            f"blocking console warnings, functional / arcade-room smoke failure, or navigation error (see above). "
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
