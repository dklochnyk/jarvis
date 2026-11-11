"""The thinking part: Claude with tool use, streamed sentence by sentence so the
voice can start talking before the full answer is written."""
import os

import anthropic

from persona import SPLIT as _SPLIT, build_system_prompt, clean
from tools import Tools



class Brain:
    def __init__(self, cfg, tools: Tools, emit):
        self.client = anthropic.Anthropic(
            api_key=os.environ["ANTHROPIC_API_KEY"], base_url="https://api.anthropic.com"
        )
        self.model = cfg.get("model", "claude-sonnet-5-5")
        self.max_hist = int(cfg.get("max_history_messages", 30))
        self.tools = tools
        self.emit = emit
        self.system = build_system_prompt(cfg)
        self.history = []

    def reset(self):
        self.history.clear()

    def _trim(self):
        while len(self.history) > self.max_hist:
            self.history.pop(0)
            # never start history on an orphaned tool result / assistant turn
            while self.history and not (
                self.history[0]["role"] == "user" and isinstance(self.history[0]["content"], str)
            ):
                self.history.pop(0)

    def respond(self, text, on_sentence, should_stop):
        """Stream a reply. Calls on_sentence(str) for each finished sentence."""
        start = len(self.history)
        self.history.append({"role": "user", "content": text})
        self._trim()
        try:
            for _ in range(6):  # tool-use rounds
                buf = ""
                with self.client.messages.stream(
                    model=self.model,
                    max_tokens=800,
                    system=self.system,
                    tools=self.tools.schemas,
                    messages=self.history,
                ) as stream:
                    for delta in stream.text_stream:
                        if should_stop():
                            return
                        buf += delta
                        parts = _SPLIT.split(buf)
                        for p in parts[:-1]:
                            if clean(p):
                                on_sentence(clean(p))
                        buf = parts[-1]
                    final = stream.get_final_message()
                if clean(buf):
                    on_sentence(clean(buf))
                self.history.append({"role": "assistant", "content": final.content})
                if final.stop_reason != "tool_use":
                    return
                results = []
                for block in final.content:
                    if block.type == "tool_use":
                        self.emit(type="tool", name=block.name, input=block.input)
                        out = self.tools.run(block.name, block.input)
                        self.emit(type="tool_result", name=block.name, result=out)
                        results.append({"type": "tool_result", "tool_use_id": block.id, "content": out})
                self.history.append({"role": "user", "content": results})
        except Exception:
            # roll back this turn so the history stays valid
            del self.history[start:]
            raise
