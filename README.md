# Jarvis

A desktop voice assistant for Windows: say "Hey Jarvis" (or press **Ctrl+Alt+J**), talk, and it answers out loud
while a transparent sci-fi HUD floats over your desktop. It can open apps and sites, and it runs on Gemini or Claude, your choice.

```
 mic ─► wake word ─► Whisper (STT) ─► Claude (+tools) ─► Piper / ElevenLabs (TTS) ─► speakers
                                          │                         │
                                          └──── events + audio levels ──► websocket ──► Electron HUD
```

* `backend/` Python: wake word, speech-to-text, Claude brain, tools, text-to-speech, websocket server
* `ui/` Electron: transparent click-through overlay (orb, waveform, clock, CPU/MEM, timers, captions)
* `config.defaults.yaml` every option and its default (replaced by updates)
* `settings.yaml` YOUR changes (created on first run, never touched by updates)

## Setup (Windows)

1. Install **Python 3.10–3.12** and **Node.js** (both on PATH).
2. Double-click `setup.bat` (creates a venv, installs everything, downloads the models).
3. Open `.env` and paste your `GEMINI_API_KEY` (free from aistudio.google.com/apikey), or an Anthropic key if you set `provider: claude`.
4. Double-click `run.bat`.

Preview the visuals without a mic or API key: `run.bat demo`.

## Cloud voice mode (lighter and more conversational)

Double-click `agent.bat`. Instead of the local wake word, Whisper and Piper, your mic streams to an
ElevenLabs Agent (Claude as the brain, your "Jarvis" voice) that listens, replies and can be interrupted in real
time. The things only your PC can do (open apps, Spotify, volume, windows, timers, files) still run here through the
same tools. Needs `ELEVENLABS_API_KEY` in `.env`. The agent id is in `config.defaults.yaml` (`elevenlabs_agent`);
`mic_device` in `settings.yaml` picks the microphone. Personality and the brain model are edited in the ElevenLabs dashboard.
Timers are lost when you quit. `agent.bat --list` shows the tools the agent can call.

## Using it

| Do this | Result |
|---|---|
| Say **"Hey Jarvis"** | He listens until you pause |
| **Ctrl+Alt+J** | Same as the wake word; press it while he's talking to interrupt |
| Keep talking after a reply | For 7 seconds he listens without the wake word (`followup_seconds`) |
| **Ctrl+Alt+H** | Show/hide the HUD |
| Tray icon → Quit | Exits both the HUD and the backend |

## What you can say

| Area | Examples |
|---|---|
| Questions (live Google) | "What's the weather in Toronto?", "Who won the Leafs game?", "What time does Costco close?" |
| Google in the browser | "Search Google for 12U baseball drills", "Show me the results" |
| Spotify (Premium) | "Play Bohemian Rhapsody", "Play some Metallica", "Play my Workout Mix", "Play my liked songs", "Skip", "Pause", "What's playing?", "Like this song" |
| Volume & media | "Turn it up", "Volume to 30", "Mute", "Next track" |
| Windows | "Open Excel", "Close Chrome", "Minimize Spotify", "Switch to Notepad", "Show the desktop", "What's open?" |
| Timers & reminders | "Set a timer for 10 minutes for pasta", "Remind me at 5:30 to call the coach" (timers are lost if Jarvis is quit) |
| Files & folders | "Open my Downloads", "Open the roster spreadsheet" (searches Desktop, Documents, Downloads) |
| Computer | "How's my CPU?", "What time is it?" |

Closing an app is polite (like clicking the X), so apps with unsaved work will ask first.

## Spotify setup (one time, about 3 minutes, needs Premium)

1. Go to https://developer.spotify.com/dashboard, log in, click **Create app**. Any name. Tick **Web API**.
2. Under **Redirect URIs** add exactly `http://127.0.0.1:8888/callback` and save.
3. Open the app's **Settings** and copy the **Client ID**.
4. Paste it into `.env` as `SPOTIFY_CLIENT_ID=...` (no quotes).
5. Double-click `spotify-login.bat`, log in to Spotify in the browser and click **Agree**.

Jarvis opens the Spotify app by itself if it isn't running.

## If Jarvis mishears you

Jarvis listens with Whisper `small.en`, boosts quiet microphones, adapts to background noise, and keeps the
first half-second of speech so your first word isn't clipped. It prints `Heard: ...` in the console so you can see
exactly what it understood. If it still struggles:

* **Wrong microphone:** run `list-mics.bat`, then put the number in `settings.yaml` as `mic_device`.
* **Cuts you off mid-sentence:** raise `silence_seconds` (1.1 to 1.6).
* **Still inaccurate:** set `stt.model: medium.en` (slower on CPU, best accuracy).
* **Names it gets wrong:** add them to `stt.prompt`.
* **Slow answers:** set `stt.model: base.en`.

## Choosing the AI (Gemini or Claude)

In `settings.yaml` set `provider: gemini` or `provider: claude`, and put the matching key in `.env`
(`GEMINI_API_KEY` from aistudio.google.com/apikey, or `ANTHROPIC_API_KEY` from console.anthropic.com).
Change `gemini_model` / `model` to pick a specific model. Restart Jarvis after any change.

## Updating

Jarvis updates itself from GitHub (`update:` in `config.defaults.yaml`). Every time `run.bat` starts it downloads
any newer version first; your `.env`, `settings.yaml`, voice models, Spotify login and Python packages are never
touched. Say **"Jarvis, update yourself"** to check right away (he'll offer to restart), run `update.bat` to check
manually, or `rollback.bat` to undo the last update (it also pauses auto-updates until you run `update.bat`).
A private repo needs a read-only token in `.env` as `GITHUB_TOKEN=...`.

## Customising

**Voice.** In `settings.yaml` set `tts.provider` to `piper` (local), `sapi` (built-in Windows voice, zero setup)
or `elevenlabs` (best quality; put `ELEVENLABS_API_KEY` in `.env` and change `voice_id`). If a provider
can't load, Jarvis falls back to `sapi` and says so in the HUD log.

**Jarvis voice (ElevenLabs).** The default `voice_id` is your "Jarvis" voice. To use it: put `ELEVENLABS_API_KEY=...` in `.env`
(elevenlabs.io > profile > API keys), add this to `settings.yaml`, then restart:

    tts:
      provider: elevenlabs

Tweak `tts.elevenlabs.speed` (0.7 - 1.2) in `settings.yaml` if it talks too fast or slow.

**Personality.** Edit the system prompt in `backend/brain.py`.

**Your own folders.** Add them under `folders:` in `settings.yaml` and say "open <name>".

**App launching.** Apps are found by alias in `settings.yaml` first, then by fuzzy-matching your Start Menu
shortcuts, so most installed apps work without setup. Add aliases for anything he misses.

**New abilities.** Write a method with the `@tool` decorator (see `backend/toolkit.py`) in a class and add
that class to the list in `Tools.__init__` in `backend/tools.py`. The AI reads the method's docstring and type
hints, so there is nothing else to register. Ideas: calendar, smart-home calls, run your own scripts.

**Look.** Colours per state are at the top of `ui/renderer.js`; layout in `ui/index.html`. The hotkeys are
at the top of `ui/main.js`.

## Troubleshooting

* **Wakes up too easily / never wakes:** change `wake_threshold` (0.3–0.8).
* **Cuts you off, or never stops recording:** tune `vad_threshold` and `silence_seconds`.
* **Slow transcription:** use `stt.model: tiny.en`. With an NVIDIA GPU use `device: cuda`, `compute_type: float16`.
* **`piper-tts` won't install:** set `tts.provider: sapi`.
* **HUD covers a fullscreen game:** press Ctrl+Alt+H to hide it.
* **Wrong microphone:** set your preferred mic as the Windows default input device.

## Privacy

Wake word and speech-to-text run on your machine. Only the text of what you say goes to Google (or Anthropic)
(and to ElevenLabs, if you choose that voice).

## Voice speed and HUD layout

- Speech speed: in `settings.yaml` set `tts: piper: speed: 1.25` (1.0 = normal, 1.1-1.3 = snappier). `expressiveness` and `rhythm` make the voice more or less varied.
- To make certain programs not count as "a window is open", add them under `hud: ignore_apps: [spotify]` in `settings.yaml`.

## The HUD

Just the Jarvis core, bottom-right of the main screen: the digital brain inside layered rings in cyan, gold, violet and rose (tick scales, targeting brackets, hexagon cells, a scrolling hex data ring, a node network, circuit traces, a radar sweep with blips, a voice-level power ring, a satellite, ripples, and live CPU / memory / network / clock chips on the rim). It reacts to listening, thinking and speaking, and shrinks to a small icon when a window is open on its screen (windows on other monitors change nothing).

The CPU/memory/network panels and the Spotify player were removed. Voice control of Spotify still works. When Jarvis isn't listening to speech, the ring of bars shows the sound your PC is playing (needs the loopback capture, `hud: real_spectrum: true`; set it false to save CPU, then it only reacts while Spotify is playing).

- **Move / resize:** RIGHT-drag the core; hold RIGHT and scroll to resize; middle-click to reset. Positions are remembered; Ctrl+Alt+R resets everything. Tray menu > *Lock / unlock panels* makes them click-through.
- **Talk to it:** press and HOLD the LEFT mouse button on the core, speak, let go. Pressing while Jarvis talks cuts him off.
- **Type to Jarvis:** press Ctrl+Alt+T (a small terminal appears), type, Enter. It also appears by itself, with the console output, when an error happens.
- **Microphone not working:** run `mic-test.bat` while speaking. It tells you which `mic_device` number to put in `settings.yaml`.
- **Using less CPU/GPU:** tray menu > *Visual quality* (Low / Medium / High, default Medium) or Ctrl+Alt+Q. Everything draws on small canvases at low frame rates, and panels only redraw while visible. If CPU is still high, check Task Manager: if it is *python*, try `stt: model: base.en`.
- **Multiple screens:** tray menu > *Main screen* picks the monitor for the core, hub and player. *Span all screens* lets you right-drag any of them onto another monitor. Changing screens resets the layout.
- **Shortcuts:** Ctrl+Alt+J talk, H hide/show, T type, Q quality, R reset layout, S span screens. The tray icon may be behind the ^ arrow near the clock.

The launcher tiles, clock, diagnostics, process radar, timers panel, status bar, big brain scene and animated background were removed to save CPU/GPU. They are all in git history if you ever want them back.
