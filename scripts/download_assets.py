"""One-time download of the models Jarvis needs: wake word, speech-to-text, Piper voice."""
import os
import sys
import urllib.request


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))
from config_loader import load_config

cfg = load_config(ROOT)

print("1/3 Wake word models...")
import openwakeword

openwakeword.utils.download_models()

print("2/3 Speech-to-text model (faster-whisper)...")
from faster_whisper import WhisperModel

s = cfg.get("stt", {})
WhisperModel(s.get("model", "base.en"), device=s.get("device", "cpu"), compute_type=s.get("compute_type", "int8"))

print("3/3 Piper voice...")
base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium"
os.makedirs(os.path.join(ROOT, "voices"), exist_ok=True)
for ext in (".onnx", ".onnx.json"):
    dest = os.path.join(ROOT, "voices", "en_GB-alan-medium" + ext)
    if os.path.exists(dest):
        continue
    try:
        urllib.request.urlretrieve(base + ext, dest)
    except Exception as e:
        print(f"  could not download {ext}: {e}\n  Jarvis will fall back to the Windows voice. "
              "You can download piper voices manually from https://huggingface.co/rhasspy/piper-voices")
        sys.exit(0)
print("Done.")
