from pathlib import Path

root = Path(__file__).resolve().parent.parent / "static"
connect = '    <script src="/arcade-connect.js"></script>\n'
game_mqtt = '    <script src="/arcade-game-mqtt.js"></script>\n'
mqtt_line = '    <script src="/arcade-mqtt.js"></script>\n'

for html in sorted(root.rglob("*.html")):
    t = html.read_text(encoding="utf-8")
    orig = t
    if mqtt_line in t and connect not in t:
        t = t.replace(mqtt_line, mqtt_line + connect)
    if html.name in ("man.html", "boy.html") and connect in t and game_mqtt not in t:
        t = t.replace(connect, connect + game_mqtt)
    if t != orig:
        html.write_text(t, encoding="utf-8")
        print("patched", html)
