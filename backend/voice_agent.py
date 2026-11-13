"""Jarvis, cloud voice edition.

Your microphone is streamed to an ElevenLabs Agent (Claude is the brain) only while you are talking to
him. The agent listens, thinks and speaks back in real time (you can interrupt), and anything that has
to happen on this PC - opening apps, Spotify, volume, timers, files - runs here through the same tools
the original Jarvis uses.

While idle nothing is sent to the cloud: a tiny local wake-word model ("Hey Jarvis") waits, and the
conversation closes by itself after a quiet spell, so it neither nags you nor burns ElevenLabs minutes.
The HUD (orb + visualizer) works exactly like before; start it with agent.bat.

    python voice_agent.py            console only (no HUD), talk to Jarvis until you press Ctrl+C
    python voice_agent.py --list     list the PC tools the agent can call
"""
import argparse
import os
import queue
import sys
import threading
import time
import traceback

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_AGENT_ID = "agent_1001m78prmnvfedsbr81jqrvx1mj"
# Tools that only make sense for the old all-local Jarvis. The cloud agent has no copy of them.
SKIP_TOOLS = {"update_jarvis", "restart_jarvis", "jarvis_version"}
OUT_RATE = 16000


def load_settings():
    from dotenv import load_dotenv

    from config_loader import load_config

    cfg = load_config(ROOT)
    # Use ONLY the keys from .env, not stray variables set elsewhere in Windows
    for var in ("ELEVENLABS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
        os.environ.pop(var, None)
    load_dotenv(os.path.join(ROOT, ".env"), override=True)
    key = os.environ.get("ELEVENLABS_API_KEY", "").strip().strip('"').strip("'")
    os.environ["ELEVENLABS_API_KEY"] = key
    return cfg, key


class _Audio:
    """The audio interface the ElevenLabs SDK wants; the real work happens in CloudJarvis so that one
    microphone stream can serve both the wake word and the live conversation."""

    def __init__(self, owner):
        self.owner = owner

    def start(self, input_callback):
        self.owner.input_cb = input_callback

    def stop(self):
        self.owner.input_cb = None

    def output(self, audio):
        self.owner.play(audio)

    def interrupt(self):
        self.owner.flush_output()


class CloudJarvis:
    """Same interface as assistant.Jarvis (run, on_command), so main.py can drive the HUD with either."""

    def __init__(self, cfg, emit, key):
        self.cfg, self.emit, self.key = cfg, emit, key
        c = cfg.get("elevenlabs_agent") or {}
        self.agent_id = (c.get("agent_id") or DEFAULT_AGENT_ID).strip()
        self.use_wake = bool(c.get("wake_word", True))
        self.idle_seconds = float(c.get("idle_seconds", 15))
        self.guard = bool(c.get("mute_mic_while_speaking", False))
        self.commands = queue.Queue()
        self.out_q = queue.Queue()
        self.input_cb = None
        self.conv = None
        self.active = threading.Event()
        self.audio = _Audio(self)
        self.state = None
        self.last_activity = 0.0
        self.last_out = 0.0
        self.awaiting_since = 0.0   # you finished a sentence and he has not started answering yet
        self.drop_audio_until = 0.0
        self.mic = self.wake = self.tools = self.client = self.out_stream = None
        self.mic_hops = 0
        self.mic_warned = 0.0

    # ---- plumbing ------------------------------------------------------------
    def log(self, text):
        print(text, flush=True)
        self.emit(type="log", text=text)

    def set_state(self, state):
        if state != self.state:
            self.state = state
            self.emit(type="state", state=state)

    def on_command(self, cmd):
        """Called from the HUD's websocket thread."""
        t = cmd.get("type")
        if t in ("hotkey", "ptt_down"):
            self.commands.put({"type": "talk"})
        elif t == "interrupt":
            self.commands.put({"type": "interrupt"})
        elif t == "text" and cmd.get("text", "").strip():
            self.commands.put({"type": "text", "text": cmd["text"].strip()})

    def announce(self, text):
        """A timer or reminder went off: have him say it, starting a conversation if there is none."""
        self.commands.put({"type": "text", "text": f"(System notice, say this to me in one short sentence: {text})"})

    # ---- audio out -----------------------------------------------------------
    def play(self, audio):
        if time.time() < self.drop_audio_until:
            return
        self.last_out = time.time()
        self.awaiting_since = 0.0
        self.out_q.put(audio)

    def flush_output(self):
        try:
            while True:
                self.out_q.get_nowait()
        except queue.Empty:
            pass

    def _play_loop(self):
        import numpy as np

        import voice

        while True:
            chunk = self.out_q.get()
            try:
                self.out_stream.write(chunk)
                self.emit(type="level", source="tts", value=voice.level(voice.rms(np.frombuffer(chunk, dtype=np.int16))))
            except Exception:
                pass

    # ---- startup ---------------------------------------------------------------
    def load(self):
        import sounddevice as sd

        import voice
        from elevenlabs.client import ElevenLabs
        from tools import Tools

        self.set_state("loading")
        dev = self.cfg.get("mic_device")
        if isinstance(dev, str) and dev.strip().isdigit():
            dev = int(dev)
        self.mic = voice.Mic(dev or None)
        if self.use_wake:
            try:
                self.wake = voice.WakeWord(self.cfg.get("wake_word", "hey_jarvis"), float(self.cfg.get("wake_threshold", 0.5)))
            except Exception as e:
                self.log(f"Wake word unavailable ({e}). Use the hotkey Ctrl+Alt+J or hold the orb to talk.")
        self.client = ElevenLabs(api_key=self.key)
        self.tools = Tools(self.cfg, announce=self.announce, emit=self.emit)
        self.out_stream = sd.RawOutputStream(samplerate=OUT_RATE, channels=1, dtype="int16")
        self.out_stream.start()
        threading.Thread(target=self._play_loop, daemon=True).start()
        self.emit(type="info", provider="elevenlabs", model="Claude Sonnet via ElevenLabs agent", voice="elevenlabs",
                  version=_version(),
                  services=[{"name": "ElevenLabs", "ok": bool(self.key)},
                            {"name": "Gemini", "ok": bool(os.environ.get("GEMINI_API_KEY"))},
                            {"name": "Spotify", "ok": os.path.exists(os.path.join(ROOT, ".spotify_cache"))}])

    def run(self):
        try:
            self.load()
        except Exception as e:
            traceback.print_exc()
            self.emit(type="error", text=f"Could not start: {e}")
            return
        try:
            self.mic.start()
            self.log(f"Microphone: {self.mic.describe()}")
        except Exception as e:
            self.emit(type="error", text=f"Could not open the microphone ({e}). Run list-mics.bat and set mic_device in settings.yaml. You can type to Jarvis with Ctrl+Alt+T.")
        self.set_state("idle")
        how = "Say 'Hey Jarvis' or press Ctrl+Alt+J" if self.wake else "Press Ctrl+Alt+J or hold the orb"
        self.log(f"Jarvis is ready (cloud voice). {how}. He closes the conversation after {self.idle_seconds:.0f} quiet seconds.")
        while True:
            try:
                self._tick()
            except Exception as e:
                traceback.print_exc()
                self.emit(type="error", text=str(e))
                time.sleep(1)

    # ---- main loop -------------------------------------------------------------
    def _tick(self):
        try:
            cmd = self.commands.get_nowait()
        except queue.Empty:
            cmd = None
        if cmd:
            self._command(cmd)

        import voice

        frame = self.mic.get(0.1)
        now = time.time()
        if frame is None:
            self._dead_mic(now)
            self._refresh_state()
            return
        r = voice.rms(frame)
        self.emit(type="level", source="mic", value=voice.level(r))
        if self.active.is_set():
            if r > 0.02:
                self.last_activity = now
            cb = self.input_cb
            if cb is not None:
                speaking = now - self.last_out < 0.6
                cb(bytes(len(frame) * 2) if (self.guard and speaking) else frame.tobytes())
            self._watch_idle(now)
        elif self.wake is not None and self.wake.detect(frame):
            self.wake.reset()
            self.start_session()
        self._refresh_state()

    def _dead_mic(self, now):
        if self.mic.muted or now - self.mic.last_cb <= 4:
            return
        if self.mic_hops < 10:
            self.mic_hops += 1
            bad = self.mic.describe()
            new = self.mic.rotate()
            self.mic.last_cb = time.time()
            self.log(f"No audio from {bad}" + (f" - trying {new}" if new else " - and no other microphone could be opened."))
        elif now - self.mic_warned > 30:
            self.mic_warned = now
            self.emit(type="error", text="No audio is coming from the microphone. Check it is plugged in and not muted, or pick another with list-mics.bat. You can type to Jarvis with Ctrl+Alt+T.")

    def _refresh_state(self):
        if not self.active.is_set():
            return self.set_state("idle")
        now = time.time()
        if now - self.last_out < 0.5:
            self.set_state("speaking")
        elif self.awaiting_since and now - self.awaiting_since < 30:
            self.set_state("thinking")
        else:
            self.set_state("listening")

    def _watch_idle(self, now):
        speaking = now - self.last_out < 1.0
        thinking = self.awaiting_since and now - self.awaiting_since < 30
        if speaking or thinking:
            self.last_activity = now
        elif now - self.last_activity > self.idle_seconds:
            self.log("Quiet for a while - closing the conversation. Say 'Hey Jarvis' when you need me.")
            self.end_session()

    def _command(self, cmd):
        t = cmd["type"]
        if t == "talk":
            if not self.active.is_set():
                self.start_session()
            elif time.time() - self.last_out < 0.6:
                self.interrupt()
        elif t == "interrupt":
            self.interrupt()
        elif t == "text":
            if self.active.is_set():
                self._say_to_agent(cmd["text"])
            else:
                self.start_session(first=cmd["text"])

    def interrupt(self):
        self.flush_output()
        self.drop_audio_until = time.time() + 1.2   # drop what is still streaming in, then he is listening again
        self.last_out = 0.0

    # ---- the cloud conversation ------------------------------------------------
    def _client_tools(self):
        """A fresh set for every conversation (the SDK shuts them down when a conversation ends)."""
        from elevenlabs.conversational_ai.conversation import ClientTools

        ct = ClientTools()
        for name in self.tools.registry:
            if name in SKIP_TOOLS:
                continue

            def handler(params, _name=name):
                params = dict(params or {})
                self.last_activity = time.time()
                self.emit(type="tool", name=_name, input=params)
                print(f"[tool] {_name} {params}", flush=True)
                result = self.tools.run(_name, params)
                print(f"[tool] -> {result}", flush=True)
                self.emit(type="tool_result", name=_name, text=str(result)[:300])
                self.last_activity = time.time()
                return result

            ct.register(name, handler)
        return ct

    def start_session(self, first=None):
        if self.active.is_set():
            return
        from elevenlabs.conversational_ai.conversation import Conversation

        self.active.set()
        self.last_activity = time.time()
        self.awaiting_since = 0.0
        self.drop_audio_until = 0.0
        self.mic.flush()
        self.flush_output()

        def on_user(text):
            self.last_activity = self.awaiting_since = time.time()
            print(f"You:    {text}", flush=True)
            self.emit(type="transcript", role="user", text=text)

        def on_agent(text):
            self.last_activity = time.time()
            print(f"Jarvis: {text}", flush=True)
            self.emit(type="transcript", role="assistant", text=text)

        conv = Conversation(
            self.client, self.agent_id, requires_auth=True, audio_interface=self.audio,
            client_tools=self._client_tools(), callback_agent_response=on_agent, callback_user_transcript=on_user,
        )
        self.conv = conv
        self.set_state("thinking")
        threading.Thread(target=self._session_thread, args=(conv, first), daemon=True).start()

    def _session_thread(self, conv, first):
        try:
            conv.start_session()
            if first:
                for _ in range(40):          # wait until the connection is up, then speak to him
                    if self._say_to_agent(first):
                        break
                    time.sleep(0.25)
            conv.wait_for_session_end()
        except Exception as e:
            self.emit(type="error", text=f"Cloud voice problem: {str(e)[:300]}")
        finally:
            if self.conv is conv:
                self.conv = None
            self.active.clear()
            self.input_cb = None
            self.flush_output()
            self.mic.flush()
            if self.wake is not None:
                self.wake.reset()

    def _say_to_agent(self, text):
        conv = self.conv
        if conv is None:
            return False
        try:
            conv.send_user_message(text)
            self.last_activity = time.time()
            return True
        except Exception:
            return False

    def end_session(self):
        conv = self.conv
        if conv is not None:
            threading.Thread(target=conv.end_session, daemon=True).start()


def _version():
    try:
        from updater import read_version

        return read_version(ROOT).get("short") or "local"
    except Exception:
        return "local"


def console_emit(**ev):
    """Used when there is no HUD (python voice_agent.py): show only the useful lines."""
    if ev.get("type") == "error":
        print(f"[error] {ev.get('text')}", file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list the PC tools and exit")
    args = ap.parse_args()

    cfg, key = load_settings()
    if args.list:
        from tools import Tools

        print("\n".join(sorted(n for n in Tools(cfg).registry if n not in SKIP_TOOLS)))
        return
    if not key or key.lower().startswith("your"):
        print("ELEVENLABS_API_KEY is missing in .env - paste your ElevenLabs API key there.", file=sys.stderr)
        sys.exit(1)
    jarvis = CloudJarvis(cfg, console_emit, key)
    try:
        jarvis.run()
    except KeyboardInterrupt:
        print("Goodbye.", flush=True)


if __name__ == "__main__":
    main()
