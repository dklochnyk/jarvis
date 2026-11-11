"""Self-updater: downloads the latest code from a GitHub repo and copies it over this install.

Standard library only, so it runs before anything else is installed.
Never touches your secrets, settings, virtual environment or downloaded models."""
import hashlib
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import zipfile

# top-level names that belong to YOU (or to this machine) and are never overwritten
PROTECTED = {".env", ".venv", "voices", ".spotify_cache", "settings.yaml", "config.yaml",
             ".version", ".backup", ".git", ".github", ".gitignore", "node_modules", "__pycache__"}
REQUIRED = ("backend/main.py", "ui/main.js", "config.defaults.yaml")  # sanity check on what we downloaded
KEEP_BACKUPS = 3


def read_version(root):
    try:
        with open(os.path.join(root, ".version"), encoding="utf-8") as f:
            v = json.load(f)
        v["short"] = v.get("sha", "")[:7]
        return v
    except (OSError, ValueError):
        return {}


def _get(url, token=None, timeout=20):
    headers = {"User-Agent": "jarvis-updater", "Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=timeout)


def _hash(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def _prune_backups(root):
    base = os.path.join(root, ".backup")
    if os.path.isdir(base):
        for old in sorted(os.listdir(base))[:-KEEP_BACKUPS]:
            shutil.rmtree(os.path.join(base, old), ignore_errors=True)


def _run(cmd, cwd, log):
    log("  > " + " ".join(cmd))
    try:
        subprocess.run(cmd, cwd=cwd, check=True)
        return True
    except Exception as e:
        log(f"  that step failed: {e}")
        return False


def _venv_python(root):
    p = os.path.join(root, ".venv", "Scripts", "python.exe") if os.name == "nt" else os.path.join(root, ".venv", "bin", "python")
    return p if os.path.exists(p) else None


def update(root, repo, branch="main", token=None, log=print, install_deps=True):
    """Returns dict(status=up_to_date|updated|error, ...). Never raises."""
    if not repo:
        return {"status": "error", "message": "No update repo is configured."}
    try:
        with _get(f"https://api.github.com/repos/{repo}/commits/{branch}", token) as r:
            info = json.load(r)
    except urllib.error.HTTPError as e:
        hint = " (a private repo needs GITHUB_TOKEN in .env)" if e.code in (401, 403, 404) and not token else ""
        return {"status": "error", "message": f"GitHub said {e.code} for {repo}{hint}."}
    except Exception as e:
        return {"status": "error", "message": f"Couldn't reach GitHub ({e.__class__.__name__}); are you online?"}

    sha = info["sha"]
    current = read_version(root)
    if current.get("sha") == sha:
        return {"status": "up_to_date", "version": sha[:7]}
    message = (info.get("commit", {}).get("message") or "").strip().splitlines()[0:1]
    message = message[0] if message else ""

    log(f"Updating to {sha[:7]}" + (f": {message}" if message else ""))
    tmp = tempfile.mkdtemp(prefix="jarvis-update-")
    try:
        try:
            with _get(f"https://api.github.com/repos/{repo}/zipball/{sha}", token, timeout=90) as r:
                data = r.read()
            zf = zipfile.ZipFile(io.BytesIO(data))
        except Exception as e:
            return {"status": "error", "message": f"Download failed: {e}"}
        for n in zf.namelist():  # refuse anything that would escape the temp folder
            if os.path.isabs(n) or ".." in n.replace("\\", "/").split("/"):
                return {"status": "error", "message": "The download contained unsafe paths; aborting."}
        zf.extractall(tmp)
        tops = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))]
        if len(tops) != 1:
            return {"status": "error", "message": "Unexpected download layout."}
        src = os.path.join(tmp, tops[0])
        missing = [r for r in REQUIRED if not os.path.exists(os.path.join(src, *r.split("/")))]
        if missing:
            return {"status": "error", "message": f"The repo doesn't look like Jarvis (missing {missing[0]}); nothing changed."}

        backup = os.path.join(root, ".backup", time.strftime("%Y%m%d-%H%M%S"))
        changed, failed = [], []
        for dirpath, dirnames, filenames in os.walk(src):
            rel_dir = os.path.relpath(dirpath, src)
            top = "" if rel_dir == "." else rel_dir.replace("\\", "/").split("/")[0]
            if top in PROTECTED:
                dirnames[:] = []
                continue
            dirnames[:] = [d for d in dirnames if not (rel_dir == "." and d in PROTECTED)]
            for fn in filenames:
                if rel_dir == "." and fn in PROTECTED:
                    continue
                s = os.path.join(dirpath, fn)
                rel = os.path.normpath(os.path.join(rel_dir, fn))
                d = os.path.join(root, rel)
                try:
                    if os.path.exists(d):
                        if _hash(s) == _hash(d):
                            continue
                        os.makedirs(os.path.dirname(os.path.join(backup, rel)), exist_ok=True)
                        shutil.copy2(d, os.path.join(backup, rel))
                    os.makedirs(os.path.dirname(d), exist_ok=True)
                    shutil.copy2(s, d)
                    changed.append(rel.replace("\\", "/"))
                except OSError as e:
                    failed.append(f"{rel} ({e.strerror})")
        _prune_backups(root)

        if failed:  # don't record the version, so the next start retries
            return {"status": "error", "message": f"Couldn't replace: {', '.join(failed[:3])}. Close Jarvis and try again."}

        if install_deps:
            py = _venv_python(root)
            if "requirements.txt" in changed and py:
                log("Installing updated Python packages...")
                _run([py, "-m", "pip", "install", "-r", "requirements.txt"], root, log)
            if "ui/package.json" in changed:
                log("Updating the HUD packages...")
                npm = "npm.cmd" if os.name == "nt" else "npm"
                _run([npm, "install"], os.path.join(root, "ui"), log)
                inst = os.path.join(root, "ui", "node_modules", "electron", "install.js")
                if os.path.exists(inst) and not os.path.exists(os.path.join(root, "ui", "node_modules", "electron", "dist")):
                    _run(["node", inst], os.path.join(root, "ui"), log)

        with open(os.path.join(root, ".version"), "w", encoding="utf-8") as f:
            json.dump({"sha": sha, "message": message, "date": info.get("commit", {}).get("committer", {}).get("date", "")}, f)
        return {"status": "updated", "version": sha[:7], "message": message, "files": changed,
                "previous": current.get("sha", "")[:7]}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
