"""Keeps the HUD's Spotify player up to date, and runs its play / next / previous buttons."""
import threading
import time

from spotify_ctl import SpotifyError


class SpotifyFeed(threading.Thread):
    def __init__(self, ctl, emit):
        super().__init__(daemon=True)
        self.ctl, self.emit = ctl, emit
        self.last = {}
        self.wake = threading.Event()

    def act(self, action):
        """Run a transport button from the HUD, then refresh immediately."""
        try:
            if action == "play_pause":
                self.ctl.spotify_control("pause" if self.last.get("playing") else "resume")
            elif action in ("next", "previous"):
                self.ctl.spotify_control(action)
        except SpotifyError as e:
            self.emit(type="log", text=str(e))
        except Exception as e:
            self.emit(type="log", text=f"Spotify: {e}")
        time.sleep(0.4)
        self.wake.set()

    def run(self):
        while True:
            delay = 2.0
            try:
                self.last = self.ctl.snapshot()
                self.emit(type="spotify", **self.last)
                delay = 2.0 if self.last.get("playing") else 4.0
            except SpotifyError:
                if self.last.get("ok") is not False:
                    self.last = {"ok": False}
                    self.emit(type="spotify", ok=False)
                delay = 30.0
            except Exception as e:
                print(f"[spotify] {e}", flush=True)
                delay = 8.0
            self.wake.wait(delay)
            self.wake.clear()
