#!/usr/bin/env python3
"""Ping-pong MQTT over WebSockets — validates broker before arcade games.

Two roles publish/subscribe on arcade/ping/{room}/man and .../boy.
Run in two terminals (or use --both for a quick single-machine test):

  python scripts/mqtt_wss_ping.py --both --room dad-son-test
  python scripts/mqtt_wss_ping.py --role man --room dad-son-test
  python scripts/mqtt_wss_ping.py --role boy --room dad-son-test

Exit 0 + VERIFICATION: PASSED when broker works and messages round-trip.
"""
from __future__ import annotations

import argparse
import json
import ssl
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

_BASE = Path(__file__).resolve().parent
if str(_BASE) not in sys.path:
    sys.path.insert(0, str(_BASE))

try:
    import paho.mqtt.client as mqtt
    from paho.mqtt.client import CallbackAPIVersion
except ImportError:
    print("FAIL: pip install paho-mqtt", file=sys.stderr)
    print()
    print("--- verification ---")
    print("VERIFICATION: FAILED - paho-mqtt not installed.")
    raise SystemExit(2)

BROKERS = [
    ("wss://broker.hivemq.com:8884/mqtt", "broker.hivemq.com", 8884, "/mqtt", True),
    ("wss://test.mosquitto.org:8081/mqtt", "test.mosquitto.org", 8081, "/mqtt", True),
    ("wss://test.mosquitto.org:8080/mqtt", "test.mosquitto.org", 8080, "/mqtt", False),
]

PING_COUNT = 6
TIMEOUT_SEC = 20


def slugify(raw: str) -> str:
    s = "".join(c if c.isalnum() or c in "-_" else "-" for c in raw.strip().lower())
    while "--" in s:
        s = s.replace("--", "-")
    return s.strip("-") or "bens_arcade"


def try_connect(host: str, port: int, path: str, use_tls: bool) -> mqtt.Client | None:
    connected = threading.Event()
    err_box: list[str] = []

    def on_connect(client, userdata, flags, reason_code, properties):
        if reason_code == 0 or str(reason_code) == "Success":
            connected.set()
        else:
            err_box.append(str(reason_code))

    def on_connect_fail(client, userdata):
        err_box.append("connect failed")

    c = mqtt.Client(CallbackAPIVersion.VERSION2, transport="websockets")
    if use_tls:
        c.tls_set(cert_reqs=ssl.CERT_REQUIRED)
    c.ws_set_options(path=path)
    c.on_connect = on_connect
    c.on_connect_fail = on_connect_fail
    try:
        c.connect(host, port, keepalive=30)
    except Exception as e:
        err_box.append(str(e))
        return None
    c.loop_start()
    if not connected.wait(12):
        err_box.append("timeout")
        try:
            c.loop_stop()
            c.disconnect()
        except Exception:
            pass
        return None
    return c


def pick_broker() -> tuple[str, mqtt.Client]:
    for label, host, port, path, tls in BROKERS:
        print(f"Trying {label} …")
        client = try_connect(host, port, path, tls)
        if client:
            print(f"OK: connected to {label}")
            return label, client
        print(f"  skip ({label})")
    raise RuntimeError("No broker accepted a WebSocket connection")


def topic(room: str, role: str) -> str:
    return f"arcade/ping/{slugify(room)}/{role}"


def run_role(
    role: str,
    room: str,
    ready: threading.Event | None,
    got: threading.Event | None,
    start_barrier: threading.Barrier | None = None,
) -> int:
    label, client = pick_broker()
    mine = topic(room, role)
    theirs = topic(room, "boy" if role == "man" else "man")
    client.subscribe(theirs, qos=0)
    received: list[dict] = []

    def on_message(c, userdata, msg):
        try:
            received.append(json.loads(msg.payload.decode()))
        except json.JSONDecodeError:
            received.append({"raw": msg.payload.decode(errors="replace")})

    client.on_message = on_message
    if ready:
        ready.set()
    if start_barrier:
        start_barrier.wait(TIMEOUT_SEC)

    for i in range(1, PING_COUNT + 1):
        payload = json.dumps({"from": role, "n": i, "ts": time.time()})
        client.publish(mine, payload, qos=0)
        print(f"  {role} sent ping {i}")
        deadline = time.time() + 6
        while time.time() < deadline:
            for pkt in reversed(received):
                if pkt.get("n") == i and pkt.get("from") != role:
                    print(f"  {role} got pong n={i} from {pkt.get('from')}")
                    break
            else:
                time.sleep(0.05)
                continue
            break
        else:
            print(f"FAIL: {role} did not receive reply for ping {i}", file=sys.stderr)
            client.loop_stop()
            client.disconnect()
            return 1
        time.sleep(0.15)

    if got:
        got.set()
    client.loop_stop()
    client.disconnect()
    print(f"OK: {role} finished on {label}")
    return 0


def run_both(room: str) -> int:
    """One process, two WSS clients — alternate pings so subscriptions are ready."""
    label_man, man = pick_broker()
    print(f"Trying {label_man} (boy) …")
    label_boy, boy = pick_broker()
    if label_man != label_boy:
        print(f"Note: man on {label_man}, boy on {label_boy}")

    t_man = topic(room, "man")
    t_boy = topic(room, "boy")
    man.subscribe(t_boy, qos=0)
    boy.subscribe(t_man, qos=0)
    time.sleep(0.4)

    inbox_man: list[dict] = []
    inbox_boy: list[dict] = []

    def on_man(_c, _u, msg):
        try:
            inbox_man.append(json.loads(msg.payload.decode()))
        except json.JSONDecodeError:
            inbox_man.append({})

    def on_boy(_c, _u, msg):
        try:
            inbox_boy.append(json.loads(msg.payload.decode()))
        except json.JSONDecodeError:
            inbox_boy.append({})

    man.on_message = on_man
    boy.on_message = on_boy

    def wait_inbox(inbox: list[dict], n: int, from_role: str, timeout: float = 6.0) -> bool:
        deadline = time.time() + timeout
        while time.time() < deadline:
            for pkt in reversed(inbox):
                if pkt.get("n") == n and pkt.get("from") == from_role:
                    return True
            time.sleep(0.05)
        return False

    for i in range(1, PING_COUNT + 1):
        payload_man = json.dumps({"from": "man", "n": i, "ts": time.time()})
        man.publish(t_man, payload_man, qos=0)
        print(f"  man sent ping {i}")
        if not wait_inbox(inbox_boy, i, "man"):
            print(f"FAIL: boy did not receive man ping {i}", file=sys.stderr)
            man.loop_stop()
            boy.loop_stop()
            man.disconnect()
            boy.disconnect()
            return 1
        print(f"  boy got man ping {i}")

        payload_boy = json.dumps({"from": "boy", "n": i, "ts": time.time()})
        boy.publish(t_boy, payload_boy, qos=0)
        print(f"  boy sent ping {i}")
        if not wait_inbox(inbox_man, i, "boy"):
            print(f"FAIL: man did not receive boy ping {i}", file=sys.stderr)
            man.loop_stop()
            boy.loop_stop()
            man.disconnect()
            boy.disconnect()
            return 1
        print(f"  man got boy ping {i}")

    man.loop_stop()
    boy.loop_stop()
    man.disconnect()
    boy.disconnect()
    print(f"OK: both finished on {label_man}")
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="MQTT WSS ping-pong test for arcade games")
    p.add_argument("--role", choices=("man", "boy"), help="Run one seat (needs partner terminal)")
    p.add_argument("--room", default="dad-son-test", help="Room slug for topics")
    p.add_argument("--both", action="store_true", help="Run man+boy in one process")
    args = p.parse_args()
    room = slugify(args.room)
    print(f"Room: {room}")
    print()

    code = 2
    try:
        if args.both:
            code = run_both(room)
        elif args.role:
            code = run_role(args.role, room, None, None)
        else:
            print("Use --both or --role man|boy", file=sys.stderr)
            code = 2
    except RuntimeError as e:
        print(f"FAIL: {e}", file=sys.stderr)
        code = 1

    print()
    print("--- verification ---")
    if code == 0:
        print("VERIFICATION: PASSED - MQTT WSS broker works; ping-pong messages exchanged.")
    else:
        print("VERIFICATION: FAILED - MQTT WSS ping-pong did not complete.")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
