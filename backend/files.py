"""Open folders and documents by name."""
import os
import re
import sys
import time
from pathlib import Path

from toolkit import tool

# never launch programs through the file opener - that is what open_app is for
BLOCKED = {".exe", ".bat", ".cmd", ".ps1", ".msi", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".scr",
           ".com", ".reg", ".lnk", ".dll", ".jar", ".hta", ".cpl", ".msc"}
SKIP_DIRS = {"node_modules", "appdata", "$recycle.bin", "windows", "program files", "program files (x86)"}
STANDARD = ("Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos")


class Files:
    def __init__(self, cfg):
        self.alias = {k.lower(): str(v) for k, v in (cfg.get("folders") or {}).items()}
        self.home = Path.home()
        self.known = {n.lower(): self._standard(n) for n in STANDARD}
        self.known.update({"home": self.home, "user folder": self.home, "my documents": self._standard("Documents")})
        self.roots = [p for n in ("Desktop", "Documents", "Downloads") for p in self._variants(n) if p.exists()]

    def _variants(self, name):
        return [self.home / name, self.home / "OneDrive" / name]

    def _standard(self, name):
        for p in self._variants(name):
            if p.exists():
                return p
        return self.home / name

    @tool
    def open_path(self, name: str) -> str:
        """Open a folder or document on the user's computer. name can be a standard folder (downloads, documents, desktop, pictures, music, videos), a folder alias the user configured, a full path, or part of a file or folder name to search for in Desktop, Documents and Downloads. Does not run programs."""
        key = name.strip().strip('"').lower()
        if not key:
            return "Tell me what to open."

        target = None
        if key in self.alias:
            target = Path(os.path.expandvars(self.alias[key]))
        elif key.removesuffix(" folder") in self.known:
            target = self.known[key.removesuffix(" folder")]
        elif os.path.isabs(name.strip('"')) and Path(name.strip('"')).exists():
            target = Path(name.strip('"'))

        extra = ""
        if target is None:
            matches = self._search(key)
            if not matches:
                return f"I couldn't find anything called {name} in your Desktop, Documents or Downloads."
            target = matches[0]
            if len(matches) > 1:
                extra = " Also found: " + ", ".join(m.name for m in matches[1:3]) + "."

        if not target.exists():
            return f"{target} doesn't exist."
        if target.is_file() and target.suffix.lower() in BLOCKED:
            return "I won't launch programs that way. Use open_app for applications."
        if sys.platform != "win32":
            return f"Found {target}, but opening files is only implemented for Windows."
        os.startfile(str(target))  # type: ignore[attr-defined]
        return f"Opened {target.name}.{extra}"

    def _search(self, query, max_seconds=4.0, max_depth=4):
        words = [w for w in re.split(r"[\s_\-.]+", query) if w]
        if not words:
            return []
        deadline = time.time() + max_seconds
        hits = []
        for root in self.roots:
            base_depth = len(root.parts)
            for dirpath, dirnames, filenames in os.walk(root):
                if time.time() > deadline:
                    break
                dirnames[:] = [d for d in dirnames if not d.startswith(".") and d.lower() not in SKIP_DIRS
                               and len(Path(dirpath, d).parts) - base_depth < max_depth]
                for entry in dirnames + filenames:
                    stem = os.path.splitext(entry)[0].lower()
                    hay = re.sub(r"[_\-.]+", " ", stem)
                    if all(w in hay for w in words):
                        p = Path(dirpath, entry)
                        if p.suffix.lower() in BLOCKED:
                            continue
                        try:
                            mtime = p.stat().st_mtime
                        except OSError:
                            continue
                        exact = hay == " ".join(words)
                        hits.append((not exact, len(hay), -mtime, p))
        hits.sort(key=lambda h: h[:3])
        seen, out = set(), []
        for h in hits:
            if h[3] not in seen:
                seen.add(h[3])
                out.append(h[3])
        return out[:5]
