"""Watches which windows are open on the primary screen so the HUD can get out of the way.

Sends rectangles as fractions of the screen (0..1), so screen scaling / DPI never matters."""
import sys
import threading
import time

import psutil

IS_WIN = sys.platform == "win32"
HIDDEN_EXES = {"electron", "python", "pythonw"}  # Jarvis's own windows
IGNORED_TITLES = {"program manager", "windows input experience", "microsoft text input application", "nvidia geforce overlay"}
MIN_W, MIN_H = 160, 100  # pixels; smaller windows (popups, tooltips) don't count


def to_fractions(rects, sw, sh, min_w=MIN_W, min_h=MIN_H):
    """Clip pixel rects (l, t, r, b) to the screen, drop tiny ones, return rounded fractions."""
    out = []
    for l, t, r, b in rects:
        l, t, r, b = max(0, l), max(0, t), min(sw, r), min(sh, b)
        if r - l < min_w or b - t < min_h:
            continue
        out.append([round(l / sw, 3), round(t / sh, 3), round(r / sw, 3), round(b / sh, 3)])
    return sorted(out)


def _pixel_rects(ignore_exes):
    import ctypes
    from ctypes import wintypes

    user32, dwm = ctypes.windll.user32, ctypes.windll.dwmapi
    rects = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def cb(hwnd, _):
        if not user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
            return True
        n = user32.GetWindowTextLengthW(hwnd)
        if n == 0:
            return True
        ex = user32.GetWindowLongW(hwnd, -20)
        if ex & 0x80 or ex & 0x08000000:  # tool window / never-activates
            return True
        cloaked = ctypes.c_int(0)
        dwm.DwmGetWindowAttribute(hwnd, 14, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
        if cloaked.value:
            return True
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        if buf.value.lower() in IGNORED_TITLES:
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        try:
            exe = psutil.Process(pid.value).name().lower().removesuffix(".exe")
        except Exception:
            exe = ""
        if exe in HIDDEN_EXES or exe in ignore_exes:
            return True
        r = wintypes.RECT()
        if dwm.DwmGetWindowAttribute(hwnd, 9, ctypes.byref(r), ctypes.sizeof(r)) != 0:  # visible frame
            user32.GetWindowRect(hwnd, ctypes.byref(r))
        rects.append((r.left, r.top, r.right, r.bottom))
        return True

    user32.EnumWindows(cb, 0)
    return rects, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)


def _make_dpi_aware():
    import ctypes

    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass


class DesktopWatcher(threading.Thread):
    def __init__(self, emit, cfg=None, interval=0.6):
        super().__init__(daemon=True)
        self.emit, self.interval = emit, interval
        self.ignore = {str(x).lower().removesuffix(".exe") for x in ((cfg or {}).get("ignore_apps") or [])}
        self.last = None

    def snapshot(self):
        rects, sw, sh = _pixel_rects(self.ignore)
        return to_fractions(rects, sw, sh)

    def run(self):
        if not IS_WIN:
            return
        _make_dpi_aware()
        while True:
            try:
                wins = self.snapshot()
                if wins != self.last:
                    self.last = wins
                    self.emit(type="desktop", windows=wins)
            except Exception as e:  # never let a hiccup kill the watcher
                print(f"[desktop] {e}", flush=True)
            time.sleep(self.interval)
