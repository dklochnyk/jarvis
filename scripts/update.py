"""Check GitHub for a newer Jarvis and install it. Run by run.bat on every start, or by update.bat."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

quiet = "--quiet" in sys.argv
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(ROOT, ".env"), override=True)
    from config_loader import load_config
    from updater import read_version, update

    cfg = load_config(ROOT)
    u = cfg.get("update") or {}
    pinned = os.path.exists(os.path.join(ROOT, ".noupdate"))
    if quiet and (pinned or not u.get("auto", True)):
        print("Auto-update is off." if not pinned else "Updates are paused (after a rollback). Run update.bat to resume.")
        sys.exit(0)
    if not quiet and pinned:
        os.remove(os.path.join(ROOT, ".noupdate"))
    print("Checking for updates...")
    r = update(ROOT, u.get("repo", ""), u.get("branch", "main"), os.environ.get("GITHUB_TOKEN", "").strip() or None)
    if r["status"] == "up_to_date":
        print(f"Jarvis is up to date (version {r['version']}).")
    elif r["status"] == "updated":
        print(f"Updated to version {r['version']}: {r.get('message', '')}  ({len(r['files'])} files changed)")
    else:
        print("Update skipped: " + r["message"])
except Exception as e:  # an update problem must never stop Jarvis from starting
    print(f"Update check failed: {e}")
