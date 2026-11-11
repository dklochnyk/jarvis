"""Registry of everything Jarvis can do. To add an ability, write a class with
@tool methods (see toolkit.py) and add it to the list in Tools.__init__."""
import datetime
import difflib
import functools
import inspect
import os
import shutil
import sys
import webbrowser
from urllib.parse import quote_plus

import psutil

from files import Files
from selfupdate import SelfUpdate
from search import Search
from spotify_ctl import SpotifyCtl
from timers import Timers
from toolkit import coerce, schema_for, tool
from winctl import WinCtl

IS_WIN = sys.platform == "win32"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class CoreTools:
    def __init__(self, cfg):
        self.aliases = {k.lower(): str(v) for k, v in (cfg.get("apps") or {}).items()}
        self._start_menu = None

    @tool
    def open_app(self, name: str) -> str:
        """Open or launch an application on the user's computer by name, for example Spotify, Notepad, Chrome or Excel. This only opens the app; to play music use spotify_play."""
        key = name.strip().lower()
        if not key:
            return "No application name given."
        if not IS_WIN:
            exe = shutil.which(key)
            if exe:
                import subprocess

                subprocess.Popen([exe])
                return f"Launched {name}."
            return "App launching is only implemented for Windows."

        target = self.aliases.get(key)
        if target:
            os.startfile(target)  # type: ignore[attr-defined]
            return f"Launched {name}."

        idx = self._index_start_menu()
        if key in idx:
            os.startfile(idx[key])  # type: ignore[attr-defined]
            return f"Launched {name}."
        subs = [k for k in idx if key in k]
        if subs:
            best = sorted(subs, key=len)[0]
            os.startfile(idx[best])  # type: ignore[attr-defined]
            return f"Launched {best.title()}."
        close = difflib.get_close_matches(key, list(idx), n=1, cutoff=0.6)
        if close:
            os.startfile(idx[close[0]])  # type: ignore[attr-defined]
            return f"Launched {close[0].title()}."

        if os.sep not in key and "/" not in key and shutil.which(key):
            os.startfile(key)  # type: ignore[attr-defined]
            return f"Launched {name}."
        return f"I couldn't find an application called {name}."

    @tool
    def open_url(self, url: str) -> str:
        """Open a website (http or https URL) in the default browser."""
        if not url.lower().startswith(("http://", "https://")):
            url = "https://" + url
        webbrowser.open(url)
        return f"Opened {url}."

    @tool
    def web_search(self, query: str) -> str:
        """Open a Google results page in the user's browser. Use this when the user wants to SEE or browse results ("search Google for...", "show me...", "open the results"). To answer a question out loud, use web_answer instead."""
        webbrowser.open("https://www.google.com/search?q=" + quote_plus(query))
        return f"Opened Google results for {query}."

    @tool
    def system_status(self) -> str:
        """Get the current CPU load, memory use and battery level of the computer."""
        cpu = psutil.cpu_percent(interval=0.3)
        mem = psutil.virtual_memory().percent
        bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None
        s = f"CPU {cpu:.0f}%, memory {mem:.0f}%."
        if bat:
            s += f" Battery {bat.percent:.0f}%{' (charging)' if bat.power_plugged else ''}."
        return s

    @tool
    def current_datetime(self) -> str:
        """Get the current local date and time."""
        return datetime.datetime.now().strftime("%A, %B %d %Y, %I:%M %p")

    def _index_start_menu(self):
        if self._start_menu is not None:
            return self._start_menu
        roots = [
            os.path.expandvars(r"%ProgramData%\Microsoft\Windows\Start Menu\Programs"),
            os.path.expandvars(r"%AppData%\Microsoft\Windows\Start Menu\Programs"),
        ]
        idx = {}
        for root in roots:
            for dirpath, _, files in os.walk(root):
                for f in files:
                    if f.lower().endswith(".lnk"):
                        idx[os.path.splitext(f)[0].lower()] = os.path.join(dirpath, f)
        self._start_menu = idx
        return idx


class Tools:
    def __init__(self, cfg, announce=None, emit=None, request_restart=None):
        announce = announce or (lambda text: None)
        emit = emit or (lambda **kw: None)
        components = [
            CoreTools(cfg),
            WinCtl(),
            SpotifyCtl(cfg, ROOT),
            Search(cfg),
            Files(cfg),
            Timers(announce, emit),
            SelfUpdate(cfg, ROOT, request_restart or (lambda: False)),
        ]
        self.spotify = next(c for c in components if isinstance(c, SpotifyCtl))
        self.registry = {}
        for comp in components:
            for attr in dir(comp):
                if attr.startswith("_"):
                    continue
                member = getattr(comp, attr)
                if callable(member) and getattr(member, "_is_tool", False):
                    self.registry[attr] = member
        self.schemas = [schema_for(n, m) for n, m in self.registry.items()]  # for Claude

    def run(self, name, args):
        fn = self.registry.get(name)
        if fn is None:
            return f"Unknown tool {name}"
        try:
            return str(fn(**coerce(fn, args)))
        except Exception as e:  # a failing tool must never crash the assistant
            return f"{name} failed: {e}"

    def python_functions(self, call):
        """Plain functions for Gemini, which reads tool schemas from signatures + docstrings.
        `call(name, args)` runs the tool (and lets the brain report it to the HUD)."""
        fns = []
        for name, method in self.registry.items():
            sig = inspect.signature(method)

            def make(name=name, sig=sig, method=method):
                @functools.wraps(method)
                def wrapper(*args, **kwargs):
                    bound = sig.bind(*args, **kwargs)
                    bound.apply_defaults()
                    return call(name, dict(bound.arguments))

                wrapper.__name__ = name
                wrapper.__signature__ = sig
                return wrapper

            fns.append(make())
        return fns
