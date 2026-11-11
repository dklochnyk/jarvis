"""Show the microphones Windows offers, so you can pick one for mic_device in config.yaml."""
import sounddevice as sd

default_in = sd.default.device[0]
for i, d in enumerate(sd.query_devices()):
    if d["max_input_channels"] > 0:
        mark = "   <- current default" if i == default_in else ""
        print(f"{i:>3}  {d['name']}{mark}")
print("\nPut the number of the mic you want in config.yaml as  mic_device: <number>")
