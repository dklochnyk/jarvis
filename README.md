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
- When any window is open, the orb shrinks into the bottom-right corner and the clock, name badge, stats and log hide wherever a window covers them. With a clear desktop it stays large.
- To make certain programs not count as "a window is open", add them under `hud: ignore_apps: [spotify]` in `settings.yaml`.

## Command-center HUD

- **Move the visualizer:** hold the RIGHT mouse button on it and drag it anywhere (over other windows too). It remembers where you left it. Middle-click it, or use the tray menu, to put it back.
- **Move and resize anything:** every panel, the brain and the core can be moved with RIGHT-drag, and resized by holding the RIGHT button and scrolling the wheel. Middle-click a panel to put it back; tray menu > Reset layout resets everything. Positions are remembered. If panels get in the way of clicking your desktop, tray menu > Lock / unlock panels makes them click-through again.
- **Terminal panel:** a live mirror of the console window (errors in red, warnings in yellow, with an error count) so you can see problems without the black window.
- **Keyboard shortcuts:** Ctrl+Alt+J talk, Ctrl+Alt+H show/hide the HUD, Ctrl+Alt+R reset the layout, Ctrl+Alt+S span all screens on/off. The tray icon may be hidden behind the ^ arrow next to the clock.
- **Multiple screens:** tray menu > *Main screen* picks which monitor hosts the main stage (brain, player, core). Tray menu > *Span all screens* stretches the overlay across every monitor so you can right-drag any panel, the brain or the core onto another screen. Only windows on the main screen switch the HUD to its small layout; panels hide when a window covers them on whichever screen they are on. Changing screens resets the layout.
- **Talk to it:** press and HOLD the LEFT mouse button on the visualizer, speak, and let go. Pressing it while Jarvis is talking cuts him off first. A quick tap only interrupts.
- **Quick-launch tiles:** the dock on the left. Click a tile to open that app, folder or website. Make your own list in `settings.yaml`:

```yaml
launcher:
  - {name: Chrome,   icon: "🌐", app: chrome}
  - {name: Bids,     icon: "📐", path: "C:\\Users\\you\\Documents\\Bids"}
  - {name: Outlook,  icon: "✉",  url: "https://outlook.office.com"}
```
  Each tile needs a `name` plus one of `app:`, `path:` or `url:`. `icon` is optional (any emoji). Your list replaces the default one.
- **Performance hub:** CPU, memory and disk gauges, 60-second load and network charts, per-core bars and the top programs.
- **Neural core:** the brain in the middle fires faster while Jarvis is thinking and pulses with his voice.

- **Center stage:** on a clear desktop the main screen is free-form (no boxes) around a big anatomical digital brain. Its regions light up as Jarvis listens, thinks, plans, acts and speaks. The movable Jarvis core sits in the bottom-right corner; drag it with the right mouse button as before.
- **Spotify player:** with no windows open, a now-playing player (art, title, prev/play/next, progress) sits under the brain with a live spectrum of whatever your PC is playing (needs `spotify-login.bat` done once; falls back to a simulated spectrum if audio capture is unavailable).
- **With a window open:** everything shrinks to a small core in the corner and panels get out of the way.
- **Diagnostics, process radar, status bar:** live model/provider/voice/app status, a radar of your busiest programs, and a bar showing Listening / Thinking / Planning / Executing / Responding. They tuck away when a window is open.
