"""Spotify Premium control through the Spotify Web API (spotipy).

One-time setup: create a free app at developer.spotify.com/dashboard, add the redirect URI
below, put its Client ID in .env as SPOTIFY_CLIENT_ID, then run spotify-login.bat."""
import difflib
import os
import sys
import time

from toolkit import tool

SCOPE = (
    "user-modify-playback-state user-read-playback-state user-read-currently-playing "
    "playlist-read-private user-library-read user-library-modify"
)
DEFAULT_REDIRECT = "http://127.0.0.1:8888/callback"
LIKED = ("liked songs", "my liked songs", "saved songs", "my saved songs", "favorites", "my favorites", "favourite songs")


class SpotifyError(Exception):
    pass


def make_auth(client_id, redirect, cache_path, open_browser=False):
    from spotipy.cache_handler import CacheFileHandler
    from spotipy.oauth2 import SpotifyPKCE

    return SpotifyPKCE(
        client_id=client_id,
        redirect_uri=redirect,
        scope=SCOPE,
        cache_handler=CacheFileHandler(cache_path=cache_path),
        open_browser=open_browser,
    )


class SpotifyCtl:
    def __init__(self, cfg, root):
        self.root = root
        self.redirect = (cfg.get("spotify") or {}).get("redirect_uri", DEFAULT_REDIRECT)
        self.cache = os.path.join(root, ".spotify_cache")
        self._sp = None

    # ---- connection ------------------------------------------------------------
    def _client(self):
        if self._sp is not None:
            return self._sp
        client_id = os.environ.get("SPOTIFY_CLIENT_ID", "").strip()
        if not client_id or client_id.startswith("your-"):
            raise SpotifyError("Spotify isn't set up yet. Add SPOTIFY_CLIENT_ID to the .env file, then run spotify-login.bat.")
        import spotipy

        auth = make_auth(client_id, self.redirect, self.cache)
        if not auth.get_cached_token():
            raise SpotifyError("Spotify isn't linked yet. Run spotify-login.bat once and approve access.")
        self._sp = spotipy.Spotify(auth_manager=auth, requests_timeout=10, retries=1)
        return self._sp

    def _call(self, fn, *args, **kwargs):
        from spotipy.exceptions import SpotifyException

        try:
            return fn(*args, **kwargs)
        except SpotifyException as e:
            status, text = e.http_status, str(e).lower()
            if status == 403 and "premium" in text:
                raise SpotifyError("That needs Spotify Premium.")
            if status == 404:
                raise SpotifyError("There's no active Spotify player. Open Spotify and try again.")
            if status == 401:
                raise SpotifyError("The Spotify login expired. Run spotify-login.bat again.")
            if status == 429:
                raise SpotifyError("Spotify is rate limiting me. Try again in a moment.")
            raise SpotifyError(f"Spotify said no (error {status}).")

    def _launch_app(self):
        if sys.platform == "win32":
            os.startfile("spotify:")  # type: ignore[attr-defined]

    def _ensure_device(self, sp):
        devices = self._call(sp.devices).get("devices", [])
        if not devices:
            self._launch_app()
            for _ in range(12):  # wait for the app to start and register
                time.sleep(1)
                devices = self._call(sp.devices).get("devices", [])
                if devices:
                    break
        if not devices:
            raise SpotifyError("I couldn't find a Spotify player. Open the Spotify app and try again.")
        active = [d for d in devices if d.get("is_active")]
        computers = [d for d in devices if d.get("type") == "Computer"]
        return (active or computers or devices)[0]

    def _start(self, sp, device, uris=None, context=None):
        if not device.get("is_active"):
            self._call(sp.transfer_playback, device["id"], force_play=False)
            time.sleep(1)
        self._call(sp.start_playback, device_id=device["id"], uris=uris, context_uri=context)

    # ---- tools -------------------------------------------------------------------
    @tool
    def spotify_play(self, query: str, kind: str = "track") -> str:
        """Search Spotify and start playing it (opens Spotify if needed). query is what to play, e.g. 'Bohemian Rhapsody Queen', 'Taylor Swift', 'workout playlist'. kind is one of: track (a song, the default), artist, album, playlist. Use 'liked songs' with kind playlist to play the user's saved songs."""
        sp = self._client()
        kind = kind.lower().strip()
        if kind not in ("track", "artist", "album", "playlist"):
            kind = "track"
        device = self._ensure_device(sp)

        if kind == "playlist" and query.lower().strip() in LIKED:
            saved = self._call(sp.current_user_saved_tracks, limit=50).get("items", [])
            uris = [i["track"]["uri"] for i in saved if i.get("track")]
            if not uris:
                return "You don't have any liked songs yet."
            self._start(sp, device, uris=uris)
            return "Playing your liked songs."

        target = self._own_playlist(sp, query) if kind == "playlist" else None
        if target is None:
            result = self._call(sp.search, q=query, type=kind, limit=5)
            items = [i for i in result.get(kind + "s", {}).get("items", []) if i]
            if not items:
                return f"I couldn't find a {kind} called {query} on Spotify."
            target = items[0]

        name = target.get("name", query)
        by = ", ".join(a["name"] for a in target.get("artists", [])[:2]) if target.get("artists") else ""
        if kind == "track":
            self._start(sp, device, uris=[target["uri"]])
        else:
            self._start(sp, device, context=target["uri"])
        return f"Playing {name}{' by ' + by if by else ''}."

    def _own_playlist(self, sp, query):
        """Prefer the user's own playlists when they ask for one by name."""
        try:
            mine = [p for p in self._call(sp.current_user_playlists, limit=50).get("items", []) if p]
        except SpotifyError:
            return None
        names = {p["name"].lower(): p for p in mine}
        match = difflib.get_close_matches(query.lower().strip(), list(names), n=1, cutoff=0.6)
        return names[match[0]] if match else None

    @tool
    def spotify_control(self, action: str, value: int = 50) -> str:
        """Control Spotify playback. action is one of: pause, resume, next, previous, volume (value is 0-100), shuffle_on, shuffle_off, repeat_on, repeat_off, like (save the current song to Liked Songs)."""
        sp = self._client()
        a = action.lower().strip().replace(" ", "_")
        if a in ("play", "resume"):
            device = self._ensure_device(sp)
            self._call(sp.start_playback, device_id=device["id"])
            return "Resumed."
        if a == "pause":
            self._call(sp.pause_playback)
            return "Paused."
        if a in ("next", "skip"):
            self._call(sp.next_track)
            return "Skipped to the next track."
        if a in ("previous", "back"):
            self._call(sp.previous_track)
            return "Back to the previous track."
        if a == "volume":
            self._call(sp.volume, max(0, min(100, value)))
            return f"Spotify volume set to {max(0, min(100, value))} percent."
        if a in ("shuffle_on", "shuffle_off"):
            self._call(sp.shuffle, a.endswith("on"))
            return f"Shuffle {'on' if a.endswith('on') else 'off'}."
        if a in ("repeat_on", "repeat_off"):
            self._call(sp.repeat, "context" if a.endswith("on") else "off")
            return f"Repeat {'on' if a.endswith('on') else 'off'}."
        if a == "like":
            current = self._call(sp.current_playback)
            if not current or not current.get("item"):
                return "Nothing is playing to like."
            self._call(sp.current_user_saved_tracks_add, [current["item"]["id"]])
            return f"Saved {current['item']['name']} to your Liked Songs."
        return "Unknown Spotify action."

    @tool
    def spotify_now_playing(self) -> str:
        """Say what song is currently playing on Spotify."""
        sp = self._client()
        current = self._call(sp.current_playback)
        item = (current or {}).get("item")
        if not item:
            return "Nothing is playing on Spotify right now."
        artists = ", ".join(a["name"] for a in item.get("artists", [])[:2])
        state = "Playing" if current.get("is_playing") else "Paused on"
        return f"{state} {item['name']} by {artists}."
