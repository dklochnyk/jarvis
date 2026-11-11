"""Try every microphone for a couple of seconds and show which one actually hears you."""
import sys
import numpy as np
import sounddevice as sd

print("Speak normally for the next few seconds (say 'testing one two three')...\n")
default_in = sd.default.device[0]
best = None
for i, d in enumerate(sd.query_devices()):
    if d["max_input_channels"] < 1:
        continue
    name = d["name"]
    tag = "  <- Windows default" if i == default_in else ""
    try:
        rate = int(d["default_samplerate"])
        data = sd.rec(int(rate * 2.5), samplerate=rate, channels=1, dtype="float32", device=i)
        sd.wait()
        peak = float(np.max(np.abs(data)))
        bar = "#" * min(40, int(peak * 80))
        print(f"{i:>3}  {name[:44]:<44} {peak:5.3f} {bar}{tag}")
        if best is None or peak > best[1]:
            best = (i, peak, name)
    except Exception as e:
        print(f"{i:>3}  {name[:44]:<44} cannot open: {str(e)[:60]}{tag}")
print()
if best and best[1] > 0.02:
    print(f"Best match: {best[0]}  ({best[2]}).  Put   mic_device: {best[0]}   in settings.yaml")
else:
    print("None of the microphones heard anything. Check Windows Settings > Privacy & security > Microphone")
    print("(allow desktop apps), that the mic is not muted, and that it is plugged in.")
