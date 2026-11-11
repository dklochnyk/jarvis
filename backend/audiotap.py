"""Real audio visualisation: listens to whatever the computer is playing (Windows loopback) and
sends a 40-band spectrum to the HUD. If it can't, the HUD falls back to a simulated one."""
import subprocess
import sys
import threading
import time

import numpy as np

NB = 40
SR = 44100
FFT = 2048


def make_edges(nb=NB, lo=45.0, hi=15000.0):
    return np.geomspace(lo, hi, nb + 1)


def bands_from_samples(x, sr=SR, nb=NB):
    """Mono float samples -> nb band magnitudes (roughly 0..1 before normalisation)."""
    x = np.asarray(x, dtype=np.float32)[-FFT:]
    if len(x) < FFT:
        x = np.pad(x, (FFT - len(x), 0))
    spec = np.abs(np.fft.rfft(x * np.hanning(FFT))) / (FFT / 4)
    freqs = np.fft.rfftfreq(FFT, 1.0 / sr)
    edges = make_edges(nb)
    out = np.zeros(nb, dtype=np.float32)
    for i in range(nb):
        sel = (freqs >= edges[i]) & (freqs < edges[i + 1])
        if sel.any():
            out[i] = spec[sel].max()
    # a little tilt so highs aren't flat, then a log curve like a real analyser
    tilt = np.linspace(0.8, 2.4, nb)
    return np.log10(1 + 40 * out * tilt) / np.log10(41)


class SpectrumTap(threading.Thread):
    def __init__(self, emit):
        super().__init__(daemon=True)
        self.emit = emit

    def _soundcard(self):
        try:
            import soundcard as sc

            return sc
        except ImportError:
            pass
        try:  # install it once, quietly, into this same environment
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "soundcard"], timeout=180,
                           capture_output=True, check=True)
            import soundcard as sc

            return sc
        except Exception as e:
            print(f"[audio] visualiser will be simulated (could not install soundcard: {e})", flush=True)
            return None

    def run(self):
        if sys.platform != "win32":
            return
        sc = self._soundcard()
        if sc is None:
            return
        import warnings

        warnings.filterwarnings("ignore")
        while True:
            try:
                spk = sc.default_speaker()
                mic = sc.get_microphone(id=str(spk.name), include_loopback=True)
                buf = np.zeros(FFT, dtype=np.float32)
                smooth = np.zeros(NB, dtype=np.float32)
                peak = 0.2
                with mic.recorder(samplerate=SR, channels=2) as rec:
                    print("[audio] spectrum analyser running", flush=True)
                    while True:
                        data = rec.record(numframes=1470)  # ~33 ms
                        mono = data.mean(axis=1) if data.ndim > 1 else data
                        buf = np.concatenate([buf[len(mono):], mono.astype(np.float32)])[-FFT:]
                        bands = bands_from_samples(buf)
                        peak = max(peak * 0.995, float(bands.max()), 0.05)  # slow auto-gain
                        bands = np.clip(bands / peak, 0, 1)
                        smooth = np.where(bands > smooth, smooth * 0.4 + bands * 0.6, smooth * 0.82 + bands * 0.18)
                        loud = float(np.abs(mono).max()) > 0.002
                        self.emit(type="spectrum", live=True, bands=[int(v * 100) for v in smooth] if loud else [0] * NB)
            except Exception as e:
                print(f"[audio] analyser stopped: {e}", flush=True)
                time.sleep(10)
