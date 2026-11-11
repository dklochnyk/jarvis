"""Ears and mouth: microphone, wake word, speech-to-text, text-to-speech.
TTS providers are interchangeable - set tts.provider in config.yaml."""
import os
import queue
import re
import subprocess
import sys
import tempfile
import time
import wave

import numpy as np
import sounddevice as sd

SAMPLE_RATE = 16000
FRAME = 1280  # 80 ms @ 16 kHz - what openWakeWord expects
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def rms(frame_int16):
    x = frame_int16.astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(x * x))) if len(x) else 0.0


def level(r):
    """Map raw RMS to a 0..1 value for visuals."""
    return min(1.0, r * 9.0)


# --------------------------------------------------------------------- mic
class Mic:
    def __init__(self, device=None):
        self.device = device
        self.q = queue.Queue(maxsize=300)
        self.muted = False
        self.stream = None

    def start(self):
        self.stream = sd.InputStream(
            samplerate=SAMPLE_RATE, channels=1, dtype="int16", blocksize=FRAME,
            callback=self._cb, device=self.device,
        )
        self.stream.start()

    def _cb(self, indata, frames, t, status):
        if self.muted:
            return
        try:
            self.q.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass

    def get(self, timeout=0.1):
        try:
            return self.q.get(timeout=timeout)
        except queue.Empty:
            return None

    def flush(self):
        while True:
            try:
                self.q.get_nowait()
            except queue.Empty:
                return


# ---------------------------------------------------------------- wake word
class WakeWord:
    def __init__(self, name, threshold):
        from openwakeword.model import Model

        self.threshold = threshold
        self.model = Model(wakeword_models=[name], inference_framework="onnx")

    def detect(self, frame):
        scores = self.model.predict(frame)
        return bool(scores) and max(scores.values()) >= self.threshold

    def reset(self):
        try:
            self.model.reset()
        except Exception:
            pass


# ------------------------------------------------------------ speech to text
# things Whisper invents out of silence or noise
_PHANTOM = {"you", "thank you", "thanks for watching", "thanks", "bye", "the end", "uh", "um", "hmm", "mm", "oh"}
_WAKE_PREFIX = re.compile(r"^\s*(?:hey|hi|okay|ok)?[,.! ]*jarvis[,.!? ]*", re.IGNORECASE)


class STT:
    def __init__(self, cfg):
        from faster_whisper import WhisperModel

        self.model = WhisperModel(
            cfg.get("model", "small.en"),
            device=cfg.get("device", "cpu"),
            compute_type=cfg.get("compute_type", "int8"),
        )
        self.prompt = cfg.get("prompt") or None
        self.beam = int(cfg.get("beam_size", 5))

    @staticmethod
    def _normalise(audio):
        """Quiet microphones are the #1 cause of mishearing: bring the peak up to a healthy level."""
        peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
        if 0.001 < peak < 0.6:
            audio = audio * min(0.8 / peak, 12.0)
        return np.clip(audio, -1.0, 1.0)

    def transcribe(self, audio_int16):
        audio = self._normalise(audio_int16.astype(np.float32) / 32768.0)
        segments, _ = self.model.transcribe(
            audio,
            language="en",
            beam_size=self.beam,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 250},
            condition_on_previous_text=False,
            initial_prompt=self.prompt,
            no_speech_threshold=0.6,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        text = _WAKE_PREFIX.sub("", text).strip()  # "Hey Jarvis, open Spotify" -> "open Spotify"
        if re.sub(r"[^a-z ]", "", text.lower()).strip() in _PHANTOM:
            return ""
        return text


def record_utterance(mic, on_level, vad, silence_s, max_s, start_timeout=5.0, initial=None):
    """Record until the speaker pauses. Returns int16 audio, or None if nobody spoke.
    `vad` is the energy that counts as speech; quieter-than-60%-of-that still counts as
    "still talking" so soft word endings don't end the recording early."""
    frames = list(initial or [])
    loud_run = 2 if initial else 0
    spoke = bool(initial)
    last_voice = time.time()
    t0 = time.time()
    while True:
        f = mic.get(0.2)
        now = time.time()
        if f is None:
            if now - t0 > max_s:
                break
            continue
        r = rms(f)
        on_level(level(r))
        frames.append(f)
        if r >= vad:
            loud_run += 1
            if loud_run >= 2:  # two loud frames in a row = real speech, not a click
                spoke = True
            last_voice = now
        else:
            loud_run = 0
            if spoke and r >= vad * 0.6:
                last_voice = now
        if spoke and now - last_voice > silence_s:
            break
        if not spoke and now - t0 > start_timeout:
            return None
        if now - t0 > max_s:
            break
    if not spoke:
        return None
    return np.concatenate(frames)


# ------------------------------------------------------------ text to speech
def _read_wav(path):
    with wave.open(path, "rb") as w:
        sr = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
        if w.getnchannels() > 1:
            data = data.reshape(-1, w.getnchannels())[:, 0]
    return data, sr


class TTS:
    """Subclasses implement synth(text) -> (int16 mono array, sample_rate)."""

    def synth(self, text):
        raise NotImplementedError

    def speak(self, text, stop, on_level):
        audio, sr = self.synth(text)
        if audio is None or len(audio) == 0:
            return
        block = int(sr * 0.04)
        with sd.OutputStream(samplerate=sr, channels=1, dtype="int16") as out:
            for i in range(0, len(audio), block):
                if stop.is_set():
                    break
                chunk = audio[i : i + block]
                on_level(min(1.0, rms(chunk) * 6.0))
                out.write(chunk.reshape(-1, 1))
        on_level(0.0)


class PiperTTS(TTS):
    def __init__(self, cfg):
        path = cfg.get("model_path", "voices/en_GB-alan-medium.onnx")
        self.model = path if os.path.isabs(path) else os.path.join(ROOT, path)
        if not os.path.exists(self.model):
            raise FileNotFoundError(f"Piper voice not found at {self.model} (run scripts/download_assets.py)")
        import piper  # noqa: F401  (fail early if not installed)

    def synth(self, text):
        fd, tmp = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            subprocess.run(
                [sys.executable, "-m", "piper", "--model", self.model, "--output_file", tmp],
                input=text.encode("utf-8"),
                check=True,
                capture_output=True,
            )
            return _read_wav(tmp)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass


class SapiTTS(TTS):
    """Windows built-in voices via pyttsx3. Zero setup, robotic but reliable."""

    def __init__(self, cfg):
        import pyttsx3  # noqa: F401

        self.rate = int(cfg.get("rate", 185))

    def synth(self, text):
        import pyttsx3

        fd, tmp = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            eng = pyttsx3.init()
            eng.setProperty("rate", self.rate)
            eng.save_to_file(text, tmp)
            eng.runAndWait()
            eng.stop()
            return _read_wav(tmp)
        finally:
            try:
                os.remove(tmp)
            except OSError:
                pass


class ElevenLabsTTS(TTS):
    def __init__(self, cfg):
        self.key = os.environ.get("ELEVENLABS_API_KEY")
        if not self.key:
            raise RuntimeError("ELEVENLABS_API_KEY is not set in .env")
        self.voice = cfg.get("voice_id")
        self.model = cfg.get("model_id", "eleven_flash_v2_5")

    def synth(self, text):
        import requests

        r = requests.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{self.voice}",
            params={"output_format": "pcm_22050"},
            headers={"xi-api-key": self.key, "Content-Type": "application/json"},
            json={"text": text, "model_id": self.model},
            timeout=30,
        )
        r.raise_for_status()
        return np.frombuffer(r.content, dtype=np.int16), 22050


def make_tts(cfg, log):
    provider = cfg.get("provider", "piper")
    table = {"piper": PiperTTS, "sapi": SapiTTS, "elevenlabs": ElevenLabsTTS}
    try:
        return table[provider](cfg.get(provider, {}) or {})
    except Exception as e:
        log(f"TTS provider '{provider}' unavailable ({e}); falling back to Windows SAPI voice.")
        return SapiTTS(cfg.get("sapi", {}) or {})
