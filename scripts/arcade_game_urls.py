"""URL paths for arcade smoke tests — single source of truth (see static/)."""

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
# Prefer fixing the game (e.g. defer Web Audio until a user gesture) instead of growing this list.
ALLOWED_CONSOLE_WARNING_SUBSTRINGS: tuple[str, ...] = ()
