"""Windows desktop control: volume, media keys, closing / minimising / focusing windows."""
import sys
import time
from collections import namedtuple

import psutil

from toolkit import tool

IS_WIN = sys.platform == "win32"
WIN_ONLY = "That only works on Windows."

VK = {"volume_up": 0xAF, "volume_down": 0xAE, "mute": 0xAD, "next": 0xB0, "previous": 0xB1,
      "play_pause": 0xB3, "stop": 0xB2}

# what people say -> part of the process or window title
ALIASES = {
    "chrome": "chrome", "google chrome": "chrome", "edge": "msedge", "microsoft edge": "msedge",
    "word": "winword", "excel": "excel", "powerpoint": "powerpnt", "outlook": "outlook",
    "file explorer": "explorer", "explorer": "explorer", "files": "explorer",
    "terminal": "windowsterminal", "command prompt": "cmd", "vscode": "code",
    "visual studio code": "code", "notepad": "notepad", "calculator": "calculator",
}
HIDDEN_EXES = {"electron", "python", "pythonw"}          # Jarvis's own windows
HIDDEN_TITLES = {"program manager", "windows input experience", "microsoft text input application"}

Win = namedtuple("Win", "hwnd title exe")


def _tap(vk):
    import ctypes

    ctypes.windll.user32.keybd_event(vk, 0, 0, 0)
    ctypes.windll.user32.keybd_event(vk, 0, 2, 0)


class WinCtl:
    # ---- volume & media ------------------------------------------------------
    def _endpoint(self):
        """Exact volume control via pycaw; returns None if unavailable (then we use keys)."""
        try:
            import comtypes

            try:
                comtypes.CoInitialize()
            except Exception:
                pass
            from pycaw.pycaw import AudioUtilities

            speakers = AudioUtilities.GetSpeakers()
            if hasattr(speakers, "EndpointVolume"):
                return speakers.EndpointVolume
            from ctypes import POINTER, cast

            from comtypes import CLSCTX_ALL
            from pycaw.pycaw import IAudioEndpointVolume

            iface = speakers.Activate(IAudioEndpointVolume._iid_, CLSCTX_ALL, None)
            return cast(iface, POINTER(IAudioEndpointVolume))
        except Exception:
            return None

    @tool
    def volume(self, action: str, amount: int = 10) -> str:
        """Change the computer's speaker volume. action is one of: up, down, mute (toggles), set. amount is the number of percentage points to change by, or the exact level 0-100 when action is set."""
        if not IS_WIN:
            return WIN_ONLY
        a = action.lower().strip()
        ep = self._endpoint()
        if a == "mute":
            if ep is not None:
                muted = ep.GetMute()
                ep.SetMute(0 if muted else 1, None)
                return "Unmuted." if muted else "Muted."
            _tap(VK["mute"])
            return "Toggled mute."
        if a not in ("up", "down", "set"):
            return "Action must be up, down, mute or set."
        amount = max(0, min(100, amount))
        if ep is not None:
            cur = ep.GetMasterVolumeLevelScalar() * 100
            new = amount if a == "set" else cur + amount if a == "up" else cur - amount
            new = max(0, min(100, new))
            ep.SetMasterVolumeLevelScalar(new / 100, None)
            if new > 0 and ep.GetMute():
                ep.SetMute(0, None)
            return f"Volume is now {round(new)} percent."
        # fallback: each key press moves the volume by 2 percent
        if a == "set":
            for _ in range(50):
                _tap(VK["volume_down"])
                time.sleep(0.004)
            for _ in range(round(amount / 2)):
                _tap(VK["volume_up"])
                time.sleep(0.004)
            return f"Volume set to about {amount} percent."
        for _ in range(max(1, round(amount / 2))):
            _tap(VK["volume_up" if a == "up" else "volume_down"])
            time.sleep(0.004)
        return f"Volume turned {a}."

    @tool
    def media(self, action: str) -> str:
        """Control whatever media is playing on the computer, in any app, using the keyboard media keys. action is one of: play_pause, next, previous, stop. For Spotify specifically, spotify_control is more reliable."""
        if not IS_WIN:
            return WIN_ONLY
        a = action.lower().strip().replace(" ", "_")
        if a in ("play", "pause", "resume"):
            a = "play_pause"
        if a not in ("play_pause", "next", "previous", "stop"):
            return "Action must be play_pause, next, previous or stop."
        _tap(VK[a])
        return f"Sent {a.replace('_', ' / ')}."

    # ---- windows -------------------------------------------------------------
    def _windows(self):
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        dwm = ctypes.windll.dwmapi
        found = []

        @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
        def callback(hwnd, _):
            if not user32.IsWindowVisible(hwnd):
                return True
            length = user32.GetWindowTextLengthW(hwnd)
            if length == 0:
                return True
            if user32.GetWindowLongW(hwnd, -20) & 0x80:  # tool window
                return True
            cloaked = ctypes.c_int(0)
            dwm.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
            if cloaked.value:  # hidden UWP ghost windows
                return True
            buf = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buf, length + 1)
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            try:
                exe = psutil.Process(pid.value).name().lower().removesuffix(".exe")
            except Exception:
                exe = ""
            if exe in HIDDEN_EXES or buf.value.lower() in HIDDEN_TITLES:
                return True
            found.append(Win(hwnd, buf.value, exe))
            return True

        user32.EnumWindows(callback, 0)
        return found

    def _match(self, name):
        n = name.strip().lower().removesuffix(".exe")
        targets = {n, ALIASES.get(n, n)}
        return [w for w in self._windows() if any(t and (t in w.title.lower() or t in w.exe) for t in targets)]

    @tool
    def list_windows(self) -> str:
        """List the windows currently open on the user's desktop (title and program). Use this to see what is running before closing or switching to something."""
        if not IS_WIN:
            return WIN_ONLY
        wins = self._windows()
        if not wins:
            return "No open windows found."
        return "; ".join(f"{w.title[:60]} ({w.exe})" for w in wins[:15])

    @tool
    def close_app(self, name: str) -> str:
        """Politely close an open application's windows by name (like clicking the X, so it can ask to save first). Examples: Chrome, Notepad, Spotify."""
        if not IS_WIN:
            return WIN_ONLY
        import ctypes

        wins = self._match(name)
        if not wins:
            return f"I don't see an open window for {name}."
        for w in wins:
            ctypes.windll.user32.PostMessageW(w.hwnd, 0x0010, 0, 0)  # WM_CLOSE
        return f"Asked {name} to close ({len(wins)} window{'s' if len(wins) != 1 else ''})."

    @tool
    def minimize_app(self, name: str) -> str:
        """Minimize an open application's windows by name."""
        if not IS_WIN:
            return WIN_ONLY
        import ctypes

        wins = self._match(name)
        if not wins:
            return f"I don't see an open window for {name}."
        for w in wins:
            ctypes.windll.user32.ShowWindow(w.hwnd, 6)  # SW_MINIMIZE
        return f"Minimized {name}."

    @tool
    def focus_app(self, name: str) -> str:
        """Bring an already-open application to the front (switch to it) by name."""
        if not IS_WIN:
            return WIN_ONLY
        import ctypes

        wins = self._match(name)
        if not wins:
            return f"I don't see an open window for {name}. Try open_app instead."
        user32 = ctypes.windll.user32
        hwnd = wins[0].hwnd
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE
        user32.keybd_event(0x12, 0, 0, 0)  # tap Alt so Windows lets us take focus
        user32.SetForegroundWindow(hwnd)
        user32.keybd_event(0x12, 0, 2, 0)
        return f"Switched to {wins[0].title[:40]}."

    @tool
    def minimize_all(self) -> str:
        """Minimize every window and show the desktop."""
        if not IS_WIN:
            return WIN_ONLY
        import ctypes

        u = ctypes.windll.user32
        u.keybd_event(0x5B, 0, 0, 0)  # Win
        u.keybd_event(0x44, 0, 0, 0)  # D
        u.keybd_event(0x44, 0, 2, 0)
        u.keybd_event(0x5B, 0, 2, 0)
        return "Showing the desktop."
