"""URL paths and HTML contract snippets for arcade smoke tests (see static/)."""

from __future__ import annotations
import os
from pathlib import Path


_BASE_DIR = Path(__file__).resolve().parent
_REPO_DIR = _BASE_DIR.parent
STICK_ROUTE = "/stick-animator-pro/"
_STICK_INDEX_CANDIDATES = (
    _REPO_DIR / "static" / "stick-animator-pro" / "index.html",
    _REPO_DIR / "stick-animator-pro" / "index.html",
)


def _env_truthy(name: str) -> bool:
    v = os.getenv(name, "").strip().lower()
    return v in {"1", "true", "yes", "on"}


def stick_animator_checks_enabled() -> bool:
    """
    Enable Stick Animator checks when:
      - ARCADE_INCLUDE_STICK_ANIMATOR env var is truthy, OR
      - assets are present in common in-repo mount locations.
    """
    if _env_truthy("ARCADE_INCLUDE_STICK_ANIMATOR"):
        return True
    return any(p.is_file() for p in _STICK_INDEX_CANDIDATES)


def stick_animator_check_status() -> tuple[bool, str]:
    """
    Human-readable status for logs/debugging.
    Returns: (enabled, reason)
    """
    forced = _env_truthy("ARCADE_INCLUDE_STICK_ANIMATOR")
    existing = next((p for p in _STICK_INDEX_CANDIDATES if p.is_file()), None)
    if forced and existing:
        return True, f"forced by ARCADE_INCLUDE_STICK_ANIMATOR=1; found {existing}"
    if forced and not existing:
        return False, "ARCADE_INCLUDE_STICK_ANIMATOR=1 but stick animator index.html was not found in repo"
    if existing:
        return True, f"auto-enabled; found {existing}"
    return False, "auto-disabled; stick animator assets not present in repo"


_INCLUDE_STICK = stick_animator_checks_enabled()

# Fetched with GET; local href/src resolved with HEAD/GET (check_served_html.py).
SERVED_HTML_CHECK_PAGES: list[str] = (
    [
    "/",
    "/lobber/game.html",
    "/lobber/index.html",
    "/tetris/man.html",
    "/tetris/boy.html",
    "/tetris/index.html",
    "/pong/man.html",
    "/pong/boy.html",
    "/pong/index.html",
    "/tictactoe/man.html",
    "/tictactoe/boy.html",
    "/tictactoe/index.html",
    "/mahjong/man.html",
    "/mahjong/boy.html",
    "/mahjong/index.html",
    ]
    + ([STICK_ROUTE] if _INCLUDE_STICK else [])
)

# Playwright loads each URL; console + page errors fail (check_browser_console.py).
BROWSER_CONSOLE_CHECK_PAGES: list[str] = list(SERVED_HTML_CHECK_PAGES)

# Console `warning` messages containing any of these substrings (case-insensitive) do not fail the run.
ALLOWED_CONSOLE_WARNING_SUBSTRINGS: tuple[str, ...] = ()

# Console `error` messages containing any of these substrings (case-insensitive) do not fail the run.
# Keep this limited to known external/transient infrastructure issues.
ALLOWED_CONSOLE_ERROR_SUBSTRINGS: tuple[str, ...] = (
    "websocket connection to 'wss://test.mosquitto.org:8081/' failed",
    "connection closed before receiving a handshake response",
)

# Required substrings (case-insensitive) per path for HTML contract / regression checks.
REQUIRED_HTML_SNIPPETS: dict[str, tuple[str, ...]] = {
    "/lobber/game.html": (
        'id="gameCanvas"',
        'id="emojiPicker"',
        "/lobber/lobber.js",
        'id="openLevelBuilderPicker"',
    ),
    "/pong/index.html": (
        'id="arcadeRoomPick"',
        "/arcade-room-pick.js",
        "/arcade-room-pick.css",
        "ArcadeRoom",
    ),
    "/tetris/index.html": (
        'id="arcadeRoomPick"',
        "/arcade-room-pick.js",
        "/arcade-room-pick.css",
        "ArcadeRoom",
    ),
    "/tictactoe/index.html": (
        'id="arcadeRoomPick"',
        "/arcade-room-pick.js",
        "/arcade-room-pick.css",
        "ArcadeRoom",
    ),
    "/mahjong/index.html": (
        'id="arcadeRoomPick"',
        "/arcade-room-pick.js",
        "/arcade-room-pick.css",
        "ArcadeRoom",
    ),
    "/pong/man.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/pong/boy.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/tetris/man.html": ("/arcade-room-pick.js", "getRoomId", "rewritePartnerLinks"),
    "/tetris/boy.html": ("/arcade-room-pick.js", "getRoomId", "rewritePartnerLinks"),
    "/tictactoe/man.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/tictactoe/boy.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/mahjong/man.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/mahjong/boy.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
}

if _INCLUDE_STICK:
    REQUIRED_HTML_SNIPPETS[STICK_ROUTE] = (
        "Stick Animator Pro",
        "src/app.js",
        "src/styles.css",
    )

# Playwright: after load, pick a silly room and assert Man/Boy links share ?room= (check_browser_console.py).
ROOM_PICK_BROWSER_FUNCTIONAL_PAGES: tuple[str, ...] = (
    "/pong/index.html",
    "/tetris/index.html",
    "/tictactoe/index.html",
    "/mahjong/index.html",
)

# Static assets for the room feature (also pulled from index HTML; listed for explicit self-check).
ARCADE_ROOM_STATIC_ASSETS: tuple[str, ...] = (
    "/arcade-room-pick.js",
    "/arcade-room-pick.css",
)


def arcade_urls_self_check() -> list[str]:
    """Lightweight in-Python 'mock' checks — run: python scripts/arcade_game_urls.py"""
    fails: list[str] = []
    for p in ROOM_PICK_BROWSER_FUNCTIONAL_PAGES:
        if p not in SERVED_HTML_CHECK_PAGES:
            fails.append(f"ROOM_PICK_BROWSER_FUNCTIONAL_PAGES entry {p!r} missing from SERVED_HTML_CHECK_PAGES")
    for p in REQUIRED_HTML_SNIPPETS:
        if p not in SERVED_HTML_CHECK_PAGES:
            fails.append(f"REQUIRED_HTML_SNIPPETS key {p!r} missing from SERVED_HTML_CHECK_PAGES")
    forced = _env_truthy("ARCADE_INCLUDE_STICK_ANIMATOR")
    if forced and not any(p.is_file() for p in _STICK_INDEX_CANDIDATES):
        fails.append(
            "ARCADE_INCLUDE_STICK_ANIMATOR is enabled, but stick animator files were not found. "
            "Expected index.html at static/stick-animator-pro/ or stick-animator-pro/."
        )
    seen: set[str] = set()
    for p in SERVED_HTML_CHECK_PAGES:
        if p in seen:
            fails.append(f"duplicate path in SERVED_HTML_CHECK_PAGES: {p}")
        seen.add(p)
    return fails


if __name__ == "__main__":
    import sys

    err = arcade_urls_self_check()
    if err:
        for e in err:
            print("FAIL:", e)
        print()
        print("--- verification ---")
        print("VERIFICATION: FAILED - arcade_game_urls self-check.")
        raise SystemExit(1)
    print("OK: arcade_game_urls self-check (room picker pages in served list, no dupes).")
    print()
    print("--- verification ---")
    print("VERIFICATION: PASSED - arcade_game_urls.py invariants.")
    raise SystemExit(0)
