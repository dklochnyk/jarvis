"""Gemini version of the brain (same interface as brain.Brain).

Free-tier Gemini models are sometimes overloaded (HTTP 503/429), so this retries
briefly and then falls back to the next-best model automatically."""
import os
import re
import time

from persona import SPLIT, build_system_prompt, clean

TRANSIENT = (429, 500, 502, 503, 504)
SKIP = ("image", "tts", "live", "audio", "thinking", "exp", "embed", "robotics", "computer", "native", "vision")


def _version(n):
    m = re.search(r"gemini-(\d+(?:\.\d+)?)", n)
    return float(m.group(1)) if m else 0.0


def rank_models(names, want="auto"):
    """Best-first list of usable chat models: wanted one, then stable Flash, preview Flash, Flash-Lite."""
    ok = [n for n in names if "gemini" in n and not any(x in n for x in SKIP)]
    flash = [n for n in ok if "flash" in n and "lite" not in n]
    lite = [n for n in ok if "flash" in n and "lite" in n]

    def order(xs):
        return sorted(xs, key=lambda n: (-_version(n), len(n)))

    ranked = order([n for n in flash if "preview" not in n]) + order([n for n in flash if "preview" in n]) + order(lite)
    if want != "auto" and want in names:
        ranked = [want] + [n for n in ranked if n != want]
    return ranked


class GeminiBrain:
    def __init__(self, cfg, tools, emit):
        from google import genai

        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        self.system = build_system_prompt(cfg)
        self.tools = tools
        self.emit = emit
        self.max_turns = max(4, int(cfg.get("max_history_messages", 30)) // 2)
        self.fns = self.tools.python_functions(self._call)
        self.candidates = self._find_models(cfg.get("gemini_model", "auto"))
        self.model = self.candidates[0]
        self.reset()

    # ---- model selection -------------------------------------------------
    def _find_models(self, want):
        try:
            names = [
                m.name.replace("models/", "")
                for m in self.client.models.list()
                if "generateContent" in (getattr(m, "supported_actions", None) or [])
            ]
        except Exception as e:
            self.emit(type="log", text=f"Could not list Gemini models ({e}); using defaults")
            return [want] if want != "auto" else ["gemini-2.5-flash", "gemini-2.5-flash-lite"]
        ranked = rank_models(names, want)
        if want != "auto" and want not in names:
            self.emit(type="log", text=f"Model '{want}' not available to your key; using {ranked[0] if ranked else '?'}")
        if not ranked:
            self.emit(type="log", text=f"No Gemini chat model found. Available: {', '.join(names[:12])}")
            return [want] if want != "auto" else ["gemini-2.5-flash"]
        return ranked

    # ---- tools -------------------------------------------------------------
    def _call(self, name, args):
        self.emit(type="tool", name=name, input=args)
        out = self.tools.run(name, args)
        self.emit(type="tool_result", name=name, result=out)
        return out

    # ---- chat ----------------------------------------------------------------
    def _make_chat(self, history=None):
        from google.genai import types

        return self.client.chats.create(
            model=self.model,
            config=types.GenerateContentConfig(system_instruction=self.system, tools=self.fns),
            history=history,
        )

    def reset(self):
        self.turns = 0
        self.chat = self._make_chat()

    def _switch_model(self):
        """Move to the next candidate model, keeping the conversation so far."""
        i = self.candidates.index(self.model) if self.model in self.candidates else -1
        if i + 1 >= len(self.candidates):
            return False
        history = self.chat.get_history()
        self.model = self.candidates[i + 1]
        self.chat = self._make_chat(history)
        self.emit(type="log", text=f"Gemini is busy - switching to {self.model}")
        return True

    @staticmethod
    def _transient(e):
        return getattr(e, "code", None) in TRANSIENT

    def respond(self, text, on_sentence, should_stop):
        if self.turns >= self.max_turns:
            self.reset()  # start fresh so the conversation never grows without bound
        self.turns += 1
        spoke = [False]

        def say(s):
            spoke[0] = True
            on_sentence(s)

        while True:
            for attempt in range(2):
                try:
                    return self._stream(text, say, should_stop)
                except Exception as e:
                    # only retry if nothing has been said yet and the failure is temporary
                    if spoke[0] or not self._transient(e):
                        raise
                    self.emit(type="log", text=f"Gemini busy ({getattr(e, 'code', '?')}), retrying...")
                    time.sleep(1.5 * (attempt + 1))
            if not self._switch_model():
                raise RuntimeError("All Gemini models are busy right now - try again in a minute.")

    def _stream(self, text, say, should_stop):
        buf = ""
        for chunk in self.chat.send_message_stream(text):
            if should_stop():
                return
            delta = chunk.text or ""
            if not delta:
                continue
            buf += delta
            parts = SPLIT.split(buf)
            for p in parts[:-1]:
                if clean(p):
                    say(clean(p))
            buf = parts[-1]
        if clean(buf):
            say(clean(buf))
