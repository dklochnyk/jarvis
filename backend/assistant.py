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
from tools import Tools


class Jarvis:
    def __init__(self, cfg, emit):
        self.cfg = cfg
        self.emit = emit
        self.commands = queue.Queue()
        self.stop = threading.Event()  # set to interrupt speech / generation
        self.busy = False
        self.restart_requested = False
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
        elif t in ("hotkey", "text"):
            self.commands.put(cmd)

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
        tools = Tools(self.cfg, announce=self.announce, emit=self.emit, request_restart=self.request_restart)
        if self.cfg.get("provider", "claude") == "gemini":
            from brain_gemini import GeminiBrain

            self.brain = GeminiBrain(self.cfg, tools, self.emit)
            self.emit(type="log", text=f"Brain: Gemini ({self.brain.model})")
        else:
            self.brain = Brain(self.cfg, tools, self.emit)
            self.emit(type="log", text=f"Brain: Claude ({self.cfg.get('model')})")
        self.vad = float(self.cfg.get("vad_threshold", 0.012))
        self.silence = float(self.cfg.get("silence_seconds", 1.1))
        self.max_rec = float(self.cfg.get("max_record_seconds", 20))
        self.followup = float(self.cfg.get("followup_seconds", 7))

    # ---- main loop ----------------------------------------------------------
    def run(self):
        self.load()
        self.mic.start()
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
            return

        try:
            spoken = self.announcements.get_nowait()
        except queue.Empty:
            spoken = None
        if spoken:
            self._announce(spoken)
            return

        frame = self.mic.get(0.1)
        if frame is None:
            return
        r = voice.rms(frame)
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

    def _listen(self, initial=None):
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

        sentences = queue.Queue()
        speaker = threading.Thread(target=self._speaker, args=(sentences,), daemon=True)
        speaker.start()

        def on_sentence(s):
            self.emit(type="transcript", role="assistant", text=s)
            sentences.put(s)

        try:
            self.brain.respond(text, on_sentence, self.stop.is_set)
        except Exception as e:
            traceback.print_exc()
            self.emit(type="error", text=str(e))
            sentences.put("Sorry, I hit a problem reaching my brain.")
        finally:
            sentences.put(None)
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

    def _speaker(self, sentences):
        first = True
        while True:
            s = sentences.get()
            if s is None:
                break
            if self.stop.is_set():
                continue  # drain without speaking
            if first:
                self.emit(type="state", state="speaking")
                first = False
            try:
                self.tts.speak(s, self.stop, lambda v: self.emit(type="level", source="tts", value=v))
            except Exception as e:
                traceback.print_exc()
                self.emit(type="error", text=f"TTS failed: {e}")
