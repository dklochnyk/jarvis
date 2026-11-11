"""The conversation loop: wait for wake word / hotkey -> listen -> think -> speak."""
import collections
import os
import queue
import sys
import threading
import time
import traceback

import voice
from brain import Brain
from launcher import Launcher
from spotify_feed import SpotifyFeed
from tools import Tools


class Jarvis:
    def __init__(self, cfg, emit):
        self.cfg = cfg
        self.emit = emit
        self.commands = queue.Queue()
        self.stop = threading.Event()  # set to interrupt speech / generation
        self.busy = False
        self.restart_requested = False
        self.ptt_held = threading.Event()       # left mouse button held on the visualizer
        self.mic_warned = 0.0                   # last time we warned about a dead microphone
        self.silent_for = 0.0
        self.ptt_down_at = 0.0
        self.launcher = Launcher(cfg)
        self.tools = None
        self.spotify_feed = None
        self.followup_until = 0.0
        self.announcements = queue.Queue()      # timers / reminders waiting to be spoken
        self.preroll = collections.deque(maxlen=6)  # last ~0.5 s of audio, so the first word isn't clipped
        self.noise = 0.005                      # running estimate of room noise
        self.noise_hist = collections.deque([0.005], maxlen=25)  # last ~2 s of those estimates

    # ---- called from the websocket thread ---------------------------------
    def on_command(self, cmd):
        t = cmd.get("type")
        if t == "interrupt" or (t == "hotkey" and self.busy):
            self.stop.set()
        elif t == "ptt_down":
            self.ptt_held.set()
            self.ptt_down_at = time.time()
            if self.busy:
                self.stop.set()  # pressing the visualizer cuts Jarvis off, then he listens to you
            self.commands.put({"type": "ptt"})
        elif t == "ptt_up":
            self.ptt_held.clear()
        elif t == "spotify":
            if self.spotify_feed:
                threading.Thread(target=self.spotify_feed.act, args=(cmd.get("action"),), daemon=True).start()
        elif t == "launch":
            threading.Thread(target=self._launch, args=(cmd.get("index"),), daemon=True).start()
        elif t in ("hotkey", "text"):
            self.commands.put(cmd)

    def _launch(self, index):
        if self.tools is None:
            return
        result = self.launcher.run(index, self.tools)
        self.emit(type="log", text=result)

    def announce(self, text):
        """Thread-safe: speak `text` as soon as Jarvis is idle (used by timers and reminders)."""
        self.announcements.put(text)

    def request_restart(self):
        """Restart after the current reply finishes. Only possible when started by run.bat (which relaunches us)."""
        if os.environ.get("JARVIS_RESTARTABLE") != "1":
            return False
        self.restart_requested = True
        return True

    def _restart(self):
        self.emit(type="log", text="Restarting...")
        self.emit(type="state", state="loading")
        time.sleep(0.4)
        os._exit(42)  # run.bat sees 42 = "update applied, start again"

    # ---- setup --------------------------------------------------------------
    def load(self):
        self.emit(type="state", state="loading")
        self.emit(type="log", text="Loading speech models...")
        dev = self.cfg.get("mic_device")
        if isinstance(dev, str) and dev.strip().isdigit():
            dev = int(dev)
        self.mic = voice.Mic(dev or None)
        self.stt = voice.STT(self.cfg.get("stt", {}))
        self.wake = voice.WakeWord(self.cfg.get("wake_word", "hey_jarvis"), float(self.cfg.get("wake_threshold", 0.5)))
        self.tts = voice.make_tts(self.cfg.get("tts", {}), lambda m: self.emit(type="log", text=m))
        tools = self.tools = Tools(self.cfg, announce=self.announce, emit=self.emit, request_restart=self.request_restart)
        if self.cfg.get("provider", "claude") == "gemini":
            from brain_gemini import GeminiBrain

            self.brain = GeminiBrain(self.cfg, tools, self.emit)
            self.emit(type="log", text=f"Brain: Gemini ({self.brain.model})")
        else:
            self.brain = Brain(self.cfg, tools, self.emit)
            self.emit(type="log", text=f"Brain: Claude ({self.cfg.get('model')})")
        self.spotify_feed = SpotifyFeed(self.tools.spotify, self.emit)
        self.spotify_feed.start()
        self.vad = float(self.cfg.get("vad_threshold", 0.012))
        self.silence = float(self.cfg.get("silence_seconds", 1.1))
        self.max_rec = float(self.cfg.get("max_record_seconds", 20))
        self.followup = float(self.cfg.get("followup_seconds", 7))
        model = getattr(self.brain, "model", None) or self.cfg.get("model", "")
        from updater import read_version

        env = os.environ.get
        services = [
            {"name": "Gemini", "ok": bool(env("GEMINI_API_KEY") or env("GOOGLE_API_KEY"))},
            {"name": "Claude", "ok": bool(env("ANTHROPIC_API_KEY"))},
            {"name": "ElevenLabs", "ok": bool(env("ELEVENLABS_API_KEY"))},
            {"name": "Spotify", "ok": os.path.exists(os.path.join(voice.ROOT, ".spotify_cache"))},
            {"name": "Updater", "ok": bool((self.cfg.get("update") or {}).get("repo"))},
        ]
        self.emit(type="info", provider=self.cfg.get("provider", "claude"), model=str(model),
                  voice=(self.cfg.get("tts") or {}).get("provider", "piper"),
                  version=read_version(voice.ROOT).get("short") or "local", services=services)

    # ---- main loop ----------------------------------------------------------
    def run(self):
        self.load()
        try:
            self.mic.start()
            self.emit(type="log", text=f"Microphone: {self.mic.name()}")
            print(f"Microphone: {self.mic.name()}")
        except Exception as e:
            msg = f"Could not open the microphone ({e}). Run list-mics.bat and set mic_device in settings.yaml. You can still type to Jarvis (Ctrl+Alt+T)."
            print(msg); self.emit(type="error", text=msg)
        self._idle()
        self.emit(type="log", text=f"{self.cfg.get('assistant_name', 'Jarvis')} online. Say 'Hey Jarvis' or press the hotkey.")
        while True:
            try:
                self._tick()
            except Exception as e:
                traceback.print_exc()
                self.emit(type="error", text=str(e))
                self.busy = False
                self.mic.muted = False
                time.sleep(1)
                self._idle()

    def _tick(self):
        try:
            cmd = self.commands.get_nowait()
        except queue.Empty:
            cmd = None
        if cmd:
            if cmd["type"] == "text" and cmd.get("text", "").strip():
                self._converse(cmd["text"].strip())
            elif cmd["type"] == "hotkey":
                self._listen()
            elif cmd["type"] == "ptt":
                self._listen(ptt=True)
            return

        try:
            spoken = self.announcements.get_nowait()
        except queue.Empty:
            spoken = None
        if spoken:
            self._announce(spoken)
            return

        frame = self.mic.get(0.1)
        now = time.time()
        if frame is None:
            if not self.mic.muted and now - self.mic.last_cb > 4 and now - self.mic_warned > 30:
                self.mic_warned = now
                msg = "No audio is coming from the microphone. Check it is plugged in and not muted, that Windows allows desktop apps to use it (Settings > Privacy > Microphone), or pick another with list-mics.bat. You can type to Jarvis with Ctrl+Alt+T."
                print(msg); self.emit(type="error", text=msg)
            return
        r = voice.rms(frame)
        # pure digital silence for a long time = muted or blocked microphone
        self.silent_for = self.silent_for + 0.08 if r == 0.0 else 0.0
        if self.silent_for > 10 and now - self.mic_warned > 60:
            self.mic_warned = now
            msg = "The microphone is sending pure silence: it looks muted or blocked by Windows privacy settings. You can type to Jarvis with Ctrl+Alt+T."
            print(msg); self.emit(type="error", text=msg)
        self.emit(type="level", source="mic", value=voice.level(r))
        self.preroll.append(frame)
        thr = self._threshold()
        # learn the room's background level: drops quickly, rises slowly (so a long-running TV or fan
        # raises the bar, but a short burst of talking doesn't)
        self.noise += (0.2 if r < self.noise else 0.01) * (r - self.noise)
        self.noise_hist.append(self.noise)

        if time.time() < self.followup_until:
            if r >= thr * 1.3:  # you started talking again, no wake word needed
                self._listen(initial=list(self.preroll))
        elif self.wake.detect(frame):
            self.wake.reset()
            self._listen()

    def _threshold(self):
        """Speech threshold: 2.5x the room noise, never below the configured minimum.
        Uses the quietest estimate of the last ~2 s, so saying "Hey Jarvis" doesn't raise the bar
        for the command that follows it."""
        return min(0.06, max(self.vad, min(self.noise_hist) * 2.5))

    # ---- states -------------------------------------------------------------
    def _idle(self):
        armed = time.time() < self.followup_until
        self.emit(type="state", state="idle", followup=armed)

    def _listen(self, initial=None, ptt=False):
        if ptt:
            # a quick tap on the visualizer only interrupts; holding it means "talk to me"
            if not self.ptt_held.is_set() and time.time() - self.ptt_down_at < 0.35:
                self.followup_until = 0
                return self._idle()
            self.stop.clear()
            self.mic.flush()
            self.emit(type="state", state="listening")
            audio = voice.record_held(
                self.mic, lambda v: self.emit(type="level", source="mic", value=v), self.ptt_held.is_set, self.max_rec
            )
        else:
            self.emit(type="state", state="listening")
            audio = voice.record_utterance(
                self.mic,
                lambda v: self.emit(type="level", source="mic", value=v),
                self._threshold(),
                self.silence,
                self.max_rec,
                initial=initial,
            )
        if audio is None:
            self.followup_until = 0
            return self._idle()
        self.emit(type="state", state="thinking")
        text = self.stt.transcribe(audio)
        if len(text) < 2:
            self.emit(type="log", text="Didn't catch that")
            self.followup_until = 0
            return self._idle()
        self.emit(type="log", text=f"Heard: {text}")
        self._converse(text)

    def _converse(self, text):
        self.busy = True
        self.stop.clear()
        self.mic.muted = True
        self.emit(type="transcript", role="user", text=text)
        self.emit(type="state", state="thinking")

        level = lambda v: self.emit(type="level", source="tts", value=v)

        def tts_error(e):
            traceback.print_exc()
            self.emit(type="error", text=f"TTS failed: {e}")

        speaker = voice.Speaker(self.tts, self.stop, level,
                          on_start=lambda: self.emit(type="state", state="speaking"), on_error=tts_error)

        def on_sentence(s):
            self.emit(type="transcript", role="assistant", text=s)
            speaker.put(s)

        try:
            self.brain.respond(text, on_sentence, self.stop.is_set)
        except Exception as e:
            traceback.print_exc()
            self.emit(type="error", text=str(e))
            speaker.put("Sorry, I hit a problem reaching my brain.")
        finally:
            speaker.finish()
            speaker.join()
            self.mic.muted = False
            self.mic.flush()
            self.wake.reset()
            self.busy = False
            self.followup_until = 0 if self.stop.is_set() else time.time() + self.followup
            if self.restart_requested:
                self._restart()
            self._idle()

    def _announce(self, text):
        """Speak a timer / reminder message (called only when idle)."""
        self.busy = True
        self.stop.clear()
        self.mic.muted = True
        try:
            self.emit(type="state", state="speaking")
            self.emit(type="transcript", role="alert", text=text)
            if sys.platform == "win32":
                import winsound

                winsound.Beep(880, 140)
                winsound.Beep(1175, 180)
            self.tts.speak(text, self.stop, lambda v: self.emit(type="level", source="tts", value=v))
        except Exception as e:
            traceback.print_exc()
            self.emit(type="error", text=f"Announcement failed: {e}")
        finally:
            self.mic.muted = False
            self.mic.flush()
            self.wake.reset()
            self.busy = False
            self._idle()
