"""Jarvis, cloud voice edition.

A thin client for an ElevenLabs Agent: your microphone is streamed to the cloud, the agent
(Claude) listens, thinks and speaks back in real time (and you can interrupt it), and anything
that has to happen on this PC - opening apps, Spotify, volume, timers, files - runs here through
the same tools the original Jarvis uses.

No wake word and no local speech model, so it starts fast and barely touches the CPU.

    python voice_agent.py            talk to Jarvis until you press Ctrl+C
    python voice_agent.py --list     list the PC tools the agent can call
"""
import argparse
import os
import queue
import sys
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

DEFAULT_AGENT_ID = "agent_1001m78prmnvfedsbr81jqrvx1mj"
# Tools that only make sense for the old all-local Jarvis. The cloud agent has no copy of them.
SKIP_TOOLS = {"update_jarvis", "restart_jarvis", "jarvis_version"}


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


class SoundDeviceAudio:
    """Mic in / speakers out at 16 kHz mono, using the mic_device from settings.yaml if you set one."""

    RATE = 16000
    BLOCK = 4000  # 250 ms

    def __init__(self, mic_device=None):
        self.mic_device = mic_device if mic_device not in ("", None) else None
        self.out_q = queue.Queue()
        self.stop_flag = threading.Event()
        self.input_callback = None
        self.in_stream = self.out_stream = self.thread = None

    def start(self, input_callback):
        import sounddevice as sd

        self.input_callback = input_callback
        self.stop_flag.clear()
        self.in_stream = sd.RawInputStream(
            samplerate=self.RATE, channels=1, dtype="int16", blocksize=self.BLOCK,
            device=self.mic_device, callback=self._on_mic,
        )
        self.out_stream = sd.RawOutputStream(samplerate=self.RATE, channels=1, dtype="int16")
        self.out_stream.start()
        self.in_stream.start()
        self.thread = threading.Thread(target=self._play_loop, daemon=True)
        self.thread.start()

    def _on_mic(self, indata, frames, time_info, status):
        if self.input_callback and not self.stop_flag.is_set():
            self.input_callback(bytes(indata))

    def _play_loop(self):
        while not self.stop_flag.is_set():
            try:
                chunk = self.out_q.get(timeout=0.1)
            except queue.Empty:
                continue
            try:
                self.out_stream.write(chunk)
            except Exception:
                pass

    def output(self, audio):
        self.out_q.put(audio)

    def interrupt(self):
        try:
            while True:
                self.out_q.get_nowait()
        except queue.Empty:
            pass

    def stop(self):
        self.stop_flag.set()
        for s in (self.in_stream, self.out_stream):
            try:
                if s:
                    s.stop()
                    s.close()
            except Exception:
                pass
        self.interrupt()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list the PC tools and exit")
    args = ap.parse_args()

    cfg, key = load_settings()
    from tools import Tools

    state = {"conv": None}

    def announce(text):
        """A timer or reminder went off: ask the agent to say it out loud."""
        print(f"[reminder] {text}", flush=True)
        conv = state["conv"]
        try:
            if conv is not None:
                conv.send_user_message(f"(System notice, say this to me in one short sentence: {text})")
        except Exception as e:
            print(f"[reminder] could not reach the agent: {e}", flush=True)

    tools = Tools(cfg, announce=announce)
    names = [n for n in tools.registry if n not in SKIP_TOOLS]
    if args.list:
        print("\n".join(sorted(names)))
        return

    if not key or key.lower().startswith("your"):
        print("ELEVENLABS_API_KEY is missing in .env - paste your ElevenLabs API key there.", file=sys.stderr)
        sys.exit(1)

    from elevenlabs.client import ElevenLabs
    from elevenlabs.conversational_ai.conversation import Conversation, ClientTools

    agent_id = ((cfg.get("elevenlabs_agent") or {}).get("agent_id") or DEFAULT_AGENT_ID).strip()
    client = ElevenLabs(api_key=key)

    client_tools = ClientTools()
    for name in names:
        def handler(params, _name=name):
            print(f"[tool] {_name} {dict(params or {})}", flush=True)
            result = tools.run(_name, dict(params or {}))
            print(f"[tool] -> {result}", flush=True)
            return result

        client_tools.register(name, handler)

    audio = SoundDeviceAudio(cfg.get("mic_device"))
    print(f"Jarvis is connecting (agent {agent_id[:14]}...). Speak when you hear him. Ctrl+C to quit.", flush=True)

    try:
        while True:
            conv = Conversation(
                client, agent_id,
                requires_auth=True,
                audio_interface=audio,
                client_tools=client_tools,
                callback_agent_response=lambda t: print(f"Jarvis: {t}", flush=True),
                callback_user_transcript=lambda t: print(f"You:    {t}", flush=True),
            )
            state["conv"] = conv
            conv.start_session()
            conv.wait_for_session_end()
            state["conv"] = None
            print("Session ended. Reconnecting in 2 seconds (Ctrl+C to quit)...", flush=True)
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        conv = state["conv"]
        if conv is not None:
            try:
                conv.end_session()
            except Exception:
                pass
        print("Goodbye.", flush=True)


if __name__ == "__main__":
    main()
