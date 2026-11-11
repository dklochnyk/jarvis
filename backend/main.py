"""Jarvis backend: runs the assistant and serves state to the HUD over a local websocket.

    python main.py          normal
    python main.py --demo   fake states/levels so you can preview the HUD with no mic or API key
"""
import argparse
import asyncio
import json
import math
import os
import random
import sys
import threading
import time

import psutil
from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOST, PORT = "127.0.0.1", 8765


class Hub:
    """Thread-safe fan-out of events to every connected HUD."""

    def __init__(self):
        self.clients = set()
        self.loop = None
        self.state = {"type": "state", "state": "loading"}
        self.sticky = {}  # latest event of these types is replayed to HUDs that connect later

    def emit(self, **ev):
        if ev.get("type") == "state":
            self.state = ev
        if ev.get("type") in ("desktop", "launcher", "info", "config", "spotify"):
            self.sticky[ev["type"]] = ev
        if ev.get("type") in ("log", "error"):
            print(f"[{ev['type']}] {ev['text']}", flush=True)
        if self.loop is None:
            return
        msg = json.dumps(ev, default=str)
        self.loop.call_soon_threadsafe(self._broadcast, msg)

    def _broadcast(self, msg):
        for ws in list(self.clients):
            asyncio.ensure_future(self._send(ws, msg))

    async def _send(self, ws, msg):
        try:
            await ws.send(msg)
        except Exception:
            self.clients.discard(ws)


def demo_loop(hub):
    """Cycle through every visual state so the HUD can be previewed."""
    hub.emit(type="state", state="loading")
    time.sleep(2)
    script = [
        ("idle", 3, None),
        ("listening", 4, "mic"),
        ("thinking", 2.5, None),
        ("speaking", 5, "tts"),
    ]
    phrases = ["What's the weather doing?", "Open Spotify and play something upbeat."]
    while True:
        for state, dur, src in script:
            hub.emit(type="state", state=state)
            if state == "listening":
                hub.emit(type="transcript", role="user", text=random.choice(phrases))
            if state == "speaking":
                hub.emit(type="transcript", role="assistant", text="Certainly. Right away.")
                hub.emit(type="tool", name="open_app", input={"name": "Spotify"})
            t0 = time.time()
            while time.time() - t0 < dur:
                if src:
                    t = time.time() - t0
                    v = max(0, 0.45 + 0.4 * math.sin(t * 9) * math.sin(t * 2.3) + random.uniform(-0.15, 0.15))
                    hub.emit(type="level", source=src, value=min(1, v))
                time.sleep(0.05)


async def stats_loop(hub):
    from sysstats import Sampler

    sampler = Sampler()
    while True:
        await asyncio.sleep(1)
        if hub.clients:
            try:
                hub.emit(type="stats", **sampler.sample())
            except Exception as e:
                print(f"[stats] {e}", flush=True)


async def amain(hub, assistant):
    from websockets.asyncio.server import serve

    hub.loop = asyncio.get_running_loop()

    async def handler(ws):
        hub.clients.add(ws)
        try:
            await ws.send(json.dumps(hub.state))
            for ev in list(hub.sticky.values()):
                await ws.send(json.dumps(ev))
            async for raw in ws:
                try:
                    cmd = json.loads(raw)
                except ValueError:
                    continue
                if assistant:
                    assistant.on_command(cmd)
        finally:
            hub.clients.discard(ws)

    async with serve(handler, HOST, PORT):
        print(f"HUD socket listening on ws://{HOST}:{PORT}", flush=True)
        await stats_loop(hub)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    args = ap.parse_args()

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from config_loader import load_config
    from updater import read_version

    import config_loader

    cfg = load_config(ROOT)
    print(f"Jarvis version: {read_version(ROOT).get('short', 'local copy')}", flush=True)
    print(f"Running from:  {ROOT}", flush=True)
    print(f"Settings file: {os.path.join(ROOT, 'settings.yaml')}  ->  provider = {cfg.get('provider')}", flush=True)
    if os.path.exists(os.path.join(ROOT, "config.yaml")):
        print("NOTE: config.yaml is the OLD settings file and is ignored now. Edit settings.yaml instead.", flush=True)
    for w in config_loader.WARNINGS:
        print(f"WARNING: {w}", flush=True)
    provider = cfg.get("provider", "claude")
    # Use ONLY the keys from .env: ignore stray API-key variables set elsewhere in Windows
    for var in ("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        os.environ.pop(var, None)
    load_dotenv(os.path.join(ROOT, ".env"), override=True)
    keyname = "GEMINI_API_KEY" if provider == "gemini" else "ANTHROPIC_API_KEY"
    key = os.environ.get(keyname, "").strip().strip('"').strip("'")
    os.environ[keyname] = key
    if key:
        print(f"Using {keyname} from .env: {key[:6]}...{key[-4:]} ({len(key)} characters)", flush=True)

    hub = Hub()
    assistant = None
    from desktop import DesktopWatcher

    DesktopWatcher(hub.emit, cfg.get("hud", {})).start()
    from launcher import Launcher

    hub.emit(type="launcher", items=Launcher(cfg).public())
    from audiotap import SpectrumTap

    SpectrumTap(hub.emit).start()
    if args.demo:
        threading.Thread(target=demo_loop, args=(hub,), daemon=True).start()
    else:
        if not key or key.startswith("your-"):
            print(f"{keyname} is missing or still the placeholder - open .env and paste your key.", file=sys.stderr)
            sys.exit(1)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from assistant import Jarvis

        assistant = Jarvis(cfg, hub.emit)
        threading.Thread(target=assistant.run, daemon=True).start()

    try:
        asyncio.run(amain(hub, assistant))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
