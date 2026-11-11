"""One-time Spotify sign-in: opens your browser, you approve, a token is saved locally."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "backend"))

from config_loader import load_config
from dotenv import load_dotenv

load_dotenv(os.path.join(ROOT, ".env"), override=True)
cid = os.environ.get("SPOTIFY_CLIENT_ID", "").strip().strip('"')
cfg = load_config(ROOT)
redirect = (cfg.get("spotify") or {}).get("redirect_uri", "http://127.0.0.1:8888/callback")

if not cid or cid.startswith("your-"):
    print("SPOTIFY_CLIENT_ID is missing in .env.")
    print("1. Go to https://developer.spotify.com/dashboard and create an app (any name).")
    print(f"2. Add this exact Redirect URI to the app: {redirect}")
    print("3. Copy the app's Client ID into .env as SPOTIFY_CLIENT_ID=... and run this again.")
    sys.exit(1)

import spotipy
from spotify_ctl import make_auth

auth = make_auth(cid, redirect, os.path.join(ROOT, ".spotify_cache"), open_browser=True)
print("A browser window will open. Log in to Spotify and click Agree...")
sp = spotipy.Spotify(auth_manager=auth)
me = sp.current_user()
print(f"\nLinked to Spotify account: {me.get('display_name') or me.get('id')}  (plan: {me.get('product', 'unknown')})")
devices = sp.devices().get("devices", [])
print("Players found:", ", ".join(d["name"] for d in devices) or "none right now (open the Spotify app)")
print("\nDone. You can close this window and start Jarvis.")
