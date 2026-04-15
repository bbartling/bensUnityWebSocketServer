"""URL paths and HTML contract snippets for arcade smoke tests (see static/)."""

from __future__ import annotations

# Fetched with GET; local href/src resolved with HEAD/GET (check_served_html.py).
SERVED_HTML_CHECK_PAGES: list[str] = [
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
]

# Playwright loads each URL; console + page errors fail (check_browser_console.py).
BROWSER_CONSOLE_CHECK_PAGES: list[str] = list(SERVED_HTML_CHECK_PAGES)

# Console `warning` messages containing any of these substrings (case-insensitive) do not fail the run.
ALLOWED_CONSOLE_WARNING_SUBSTRINGS: tuple[str, ...] = ()

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
    "/pong/man.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/pong/boy.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/tetris/man.html": ("/arcade-room-pick.js", "getRoomId", "rewritePartnerLinks"),
    "/tetris/boy.html": ("/arcade-room-pick.js", "getRoomId", "rewritePartnerLinks"),
    "/tictactoe/man.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
    "/tictactoe/boy.html": ("/arcade-room-pick.js", "rewritePartnerLinks"),
}

# Playwright: after load, pick a silly room and assert Man/Boy links share ?room= (check_browser_console.py).
ROOM_PICK_BROWSER_FUNCTIONAL_PAGES: tuple[str, ...] = (
    "/pong/index.html",
    "/tetris/index.html",
    "/tictactoe/index.html",
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
