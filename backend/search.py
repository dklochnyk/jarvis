"""Live web answers: asks Gemini with Google Search grounding and returns a short spoken-style answer.
Needs GEMINI_API_KEY in .env (works even when Claude is the main brain)."""
import datetime
import os

from toolkit import tool

TRANSIENT = (429, 500, 502, 503, 504)


class Search:
    def __init__(self, cfg):
        self.cfg = cfg
        self.client = None
        self.models = None

    def _setup(self):
        from google import genai

        from brain_gemini import rank_models

        self.client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
        try:
            names = [
                m.name.replace("models/", "")
                for m in self.client.models.list()
                if "generateContent" in (getattr(m, "supported_actions", None) or [])
            ]
            self.models = rank_models(names, self.cfg.get("gemini_model", "auto"))[:3]
        except Exception:
            self.models = []
        self.models = self.models or ["gemini-2.5-flash", "gemini-2.5-flash-lite"]

    @tool
    def web_answer(self, query: str) -> str:
        """Look up current real-world information with Google Search and get back a short factual answer to say out loud. Use for weather, news, sports scores, prices, opening hours, recent events, or any fact that may have changed or that you are unsure about. Put the place or date in the query when it matters, for example 'weather in Toronto today'."""
        if not os.environ.get("GEMINI_API_KEY"):
            return "Live search needs a GEMINI_API_KEY in the .env file. I can open a browser search instead."
        from google.genai import types

        if self.client is None:
            self._setup()
        now = datetime.datetime.now().strftime("%A %B %d %Y, %I:%M %p")
        config = types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearch())],
            system_instruction=(
                f"Today is {now}. Answer using Google Search results in at most three short spoken sentences. "
                "No markdown, lists, links or citations."
            ),
        )
        last = None
        for model in self.models:
            try:
                resp = self.client.models.generate_content(model=model, contents=query, config=config)
                return (resp.text or "").strip() or "I couldn't find a clear answer to that."
            except Exception as e:
                last = e
                if getattr(e, "code", None) not in TRANSIENT:
                    break
        return f"The search failed: {last}"
