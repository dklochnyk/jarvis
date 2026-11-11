"""Undo the last update: restore the files it replaced, and pause auto-updates."""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
base = os.path.join(ROOT, ".backup")
folders = sorted(os.listdir(base)) if os.path.isdir(base) else []
if not folders:
    print("There is no backup to restore.")
    sys.exit(0)
latest = os.path.join(base, folders[-1])
count = 0
for dirpath, _, files in os.walk(latest):
    for fn in files:
        src = os.path.join(dirpath, fn)
        dst = os.path.join(ROOT, os.path.relpath(src, latest))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        count += 1
shutil.rmtree(latest, ignore_errors=True)
open(os.path.join(ROOT, ".noupdate"), "w").write("paused by rollback")
print(f"Restored {count} files from before the last update.")
print("Auto-updates are paused. Run update.bat when you want to resume them.")
