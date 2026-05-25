#!/usr/bin/env python3
"""Validate MQTT WSS + lobby + 2-player game topics for all arcade games.

  python scripts/validate_mqtt_2player.py
  python scripts/validate_mqtt_2player.py --room my-test-room
  python scripts/validate_mqtt_2player.py --quick

Hard stop: --max-iter (default 100) and --time-limit-sec (default 300).
"""
from __future__ import annotations

import argparse
import json
import ssl
import sys
import time
from dataclasses import dataclass
from pathlib import Path

_BASE = Path(__file__).resolve().parent
if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

try:
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
except ImportError:
    print("FAIL: pip install paho-mqtt", file=sys.stderr)
    print("VERIFICATION: FAILED - paho-mqtt not installed.")
    raise SystemExit(2)

BROKERS = [
    ("wss://broker.hivemq.com:8884/mqtt", "broker.hivemq.com", 8884, "/mqtt", True),
    ("wss://test.mosquitto.org:8081/mqtt", "test.mosquitto.org", 8081, "/mqtt", True),
    ("wss://test.mosquitto.org:8080/mqtt", "test.mosquitto.org", 8080, "/mqtt", False),
]

TWO_PLAYER_GAMES = [
    {"key": "pong", "prefix": "pong", "host": "Man", "guest": "Boy"},
    {"key": "tetris", "prefix": "tetris", "host": "Man", "guest": "Boy"},
    {"key": "tictactoe", "prefix": "tictactoe", "host": "Man", "guest": "Boy"},
    {"key": "mahjong", "prefix": "mahjong", "host": "Man", "guest": "Boy"},
    {"key": "scribble", "prefix": "scribble", "host": "Man", "guest": "Boy"},
]

DEFAULT_MAX_ITER = 100
DEFAULT_TIME_LIMIT_SEC = 300


def slugify(raw: str) -> str:
    s = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw.strip().lower())
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-") or "bens_arcade"


@dataclass
class Limits:
    max_iter: int
    deadline: float
    iterations: int = 0

    def tick(self) -> bool:
        self.iterations += 1
        if self.iterations > self.max_iter:
            return False
        if time.time() > self.deadline:
            return False
        return True

    def exceeded(self) -> str | None:
        if self.iterations > self.max_iter:
            return f"max iterations ({self.max_iter})"
        if time.time() > self.deadline:
            return "time limit"
        return None


def connect_broker(limits: Limits) -> tuple[str, mqtt.Client]:
    last_err = "no broker"
    for label, host, port, path, tls in BROKERS:
        if not limits.tick():
            raise RuntimeError(limits.exceeded() or "limits exceeded")
        print(f"  broker try: {label}")
        connected = False
        err_box: list[str] = []

        def on_connect(client, userdata, flags, reason_code, properties):
            nonlocal connected
            if reason_code == 0 or str(reason_code) == "Success":
                connected = True
            else:
                err_box.append(str(reason_code))

        def on_fail(client, userdata):
            err_box.append("connect failed")

        c = mqtt.Client(CallbackAPIVersion.VERSION2, transport="websockets")
        if tls:
            c.tls_set(cert_reqs=ssl.CERT_REQUIRED)
        c.ws_set_options(path=path)
        c.on_connect = on_connect
        c.on_connect_fail = on_fail
        try:
            c.connect(host, port, keepalive=30)
        except Exception as e:
            err_box.append(str(e))
            continue
        c.loop_start()
        deadline = time.time() + 14
        while time.time() < deadline and not connected:
            time.sleep(0.05)
            if not limits.tick():
                c.loop_stop()
                c.disconnect()
                raise RuntimeError(limits.exceeded() or "limits exceeded")
        if connected:
            print(f"  OK broker: {label}")
            return label, c
        last_err = err_box[0] if err_box else "timeout"
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass
    raise RuntimeError(f"All brokers failed: {last_err}")


def lobby_topic(game_key: str, slug: str) -> str:
    return f"arcade/lobby/{game_key}/room/{slugify(slug)}"


def game_topic(prefix: str, room: str, player: str, suffix: str) -> str:
    return f"{prefix}/{slugify(room)}/{player}/{suffix}"


def test_lobby(c: mqtt.Client, game_key: str, room: str, limits: Limits) -> tuple[bool, str]:
    sub = f"arcade/lobby/{game_key}/room/+"
    got: list[tuple[str, dict]] = []

    def on_message(client, userdata, msg):
        try:
            got.append((msg.topic, json.loads(msg.payload.decode())))
        except json.JSONDecodeError:
            got.append((msg.topic, {}))

    c.on_message = on_message
    c.subscribe(sub, qos=0)
    time.sleep(0.35)
    payload = json.dumps(
        {
            "slug": slugify(room),
            "label": room,
            "man": "waiting",
            "boy": "open",
            "waitingSeat": "Man",
            "updated": int(time.time() * 1000),
            "gameKey": game_key,
        }
    )
    c.publish(lobby_topic(game_key, room), payload, retain=True, qos=0)
    deadline = time.time() + 8
    while time.time() < deadline:
        if not limits.tick():
            return False, limits.exceeded() or "limits"
        for topic, data in got:
            if slugify(data.get("slug", "")) == slugify(room) and data.get("man") == "waiting":
                c.publish(lobby_topic(game_key, room), "", retain=True, qos=0)
                return True, "lobby retain round-trip OK"
        time.sleep(0.05)
    return False, "lobby message not received within 8s"


def test_game_pair(
    label: str,
    c_man: mqtt.Client,
    c_boy: mqtt.Client,
    game: dict,
    room: str,
    limits: Limits,
) -> tuple[bool, str]:
    prefix = game["prefix"]
    host = game["host"]
    guest = game["guest"]
    t_man_status = game_topic(prefix, room, host, "status")
    t_boy_status = game_topic(prefix, room, guest, "status")
    t_man_state = game_topic(prefix, room, host, "state")
    t_boy_state = game_topic(prefix, room, guest, "state")

    inbox_boy: list[str] = []
    inbox_man: list[str] = []

    def on_boy(client, userdata, msg):
        inbox_boy.append(msg.payload.decode(errors="replace"))

    def on_man(client, userdata, msg):
        inbox_man.append(msg.payload.decode(errors="replace"))

    c_boy.on_message = on_boy
    c_man.on_message = on_man
    c_boy.subscribe(t_man_status, qos=0)
    c_boy.subscribe(t_man_state, qos=0)
    c_man.subscribe(t_boy_status, qos=0)
    c_man.subscribe(t_boy_state, qos=0)
    time.sleep(0.4)

    c_man.publish(t_man_status, "READY", qos=0)
    deadline = time.time() + 8
    while time.time() < deadline:
        if not limits.tick():
            return False, limits.exceeded() or "limits"
        if "READY" in inbox_boy:
            break
        time.sleep(0.05)
    else:
        return False, f"{prefix}: Boy did not receive Man status"

    c_boy.publish(t_boy_status, "READY", qos=0)
    deadline = time.time() + 8
    while time.time() < deadline:
        if not limits.tick():
            return False, limits.exceeded() or "limits"
        if "READY" in inbox_man:
            return True, f"{prefix}: Man<->Boy status OK on {label}"
        time.sleep(0.05)
    return False, f"{prefix}: Man did not receive Boy status"


def run_validation(room: str, quick: bool, limits: Limits) -> int:
    room = slugify(room)
    games = TWO_PLAYER_GAMES[:2] if quick else TWO_PLAYER_GAMES
    results: list[tuple[str, bool, str]] = []

    print(f"Room slug: {room}")
    print(f"Limits: max_iter={limits.max_iter}, time_limit={limits.deadline - time.time():.0f}s remaining")
    print()

    try:
        print("=== 1) Broker connect ===")
        label, c_host = connect_broker(limits)
        print("=== 2) Second client (Boy seat) ===")
        label2, c_guest = connect_broker(limits)
        if label != label2:
            print(f"  note: host on {label}, guest on {label2}")

        print()
        print("=== 3) Lobby (retained room list) per game ===")
        for g in games:
            if not limits.tick():
                results.append((g["key"] + "/lobby", False, limits.exceeded() or "limits"))
                break
            ok, msg = test_lobby(c_host, g["key"], room + "-" + g["key"], limits)
            results.append((g["key"] + "/lobby", ok, msg))
            mark = "OK" if ok else "FAIL"
            print(f"  {mark} {g['key']}: {msg}")

        print()
        print("=== 4) Game MQTT topics (Man status <-> Boy) ===")
        for g in games:
            if not limits.tick():
                results.append((g["key"] + "/game", False, limits.exceeded() or "limits"))
                break
            ok, msg = test_game_pair(label, c_host, c_guest, g, room, limits)
            results.append((g["key"] + "/game", ok, msg))
            mark = "OK" if ok else "FAIL"
            print(f"  {mark} {msg}")

        c_host.loop_stop()
        c_guest.loop_stop()
        c_host.disconnect()
        c_guest.disconnect()
    except RuntimeError as e:
        print(f"STOP: {e}", file=sys.stderr)
        results.append(("run", False, str(e)))

    print()
    print("--- summary ---")
    failed = [r for r in results if not r[1]]
    for name, ok, msg in results:
        print(f"  {'PASS' if ok else 'FAIL'} {name}: {msg}")
    print()
    print(f"Iterations used: {limits.iterations}/{limits.max_iter}")
    print("--- verification ---")
    if failed:
        print("VERIFICATION: FAILED - " + str(len(failed)) + " check(s) failed.")
        return 1
    print("VERIFICATION: PASSED - broker, lobby, and 2-player game MQTT for all games.")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Validate MQTT 2-player arcade connectivity")
    p.add_argument("--room", default="validate-room", help="Room slug base")
    p.add_argument("--quick", action="store_true", help="Only pong + tetris")
    p.add_argument("--max-iter", type=int, default=DEFAULT_MAX_ITER)
    p.add_argument("--time-limit-sec", type=int, default=DEFAULT_TIME_LIMIT_SEC)
    args = p.parse_args()
    limits = Limits(max_iter=args.max_iter, deadline=time.time() + args.time_limit_sec)
    return run_validation(args.room, args.quick, limits)


if __name__ == "__main__":
    raise SystemExit(main())
