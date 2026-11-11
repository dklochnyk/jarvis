"""Timers and reminders. They live in memory, so they are lost if Jarvis is quit."""
import datetime
import threading
import time

from toolkit import tool


class Timers:
    def __init__(self, announce, emit):
        self.announce = announce  # speaks a message when the assistant is idle
        self.emit = emit
        self.items = {}  # id -> dict(label, end, timer)
        self.next_id = 1
        self.lock = threading.Lock()

    def _publish(self):
        with self.lock:
            items = [{"label": v["label"], "end_ms": int(v["end"] * 1000)} for v in self.items.values()]
        self.emit(type="timers", items=sorted(items, key=lambda i: i["end_ms"]))

    def _start(self, seconds, label, message):
        with self.lock:
            tid = self.next_id
            self.next_id += 1

        def fire():
            with self.lock:
                self.items.pop(tid, None)
            self._publish()
            self.announce(message)

        t = threading.Timer(seconds, fire)
        t.daemon = True
        with self.lock:
            self.items[tid] = {"label": label, "end": time.time() + seconds, "timer": t}
        t.start()
        self._publish()

    @staticmethod
    def _say(seconds):
        seconds = int(round(seconds))
        h, rem = divmod(seconds, 3600)
        m, s = divmod(rem, 60)
        parts = []
        if h:
            parts.append(f"{h} hour{'s' if h != 1 else ''}")
        if m:
            parts.append(f"{m} minute{'s' if m != 1 else ''}")
        if s and not h:
            parts.append(f"{s} second{'s' if s != 1 else ''}")
        return " ".join(parts) or "0 seconds"

    @tool
    def set_timer(self, seconds: int, label: str = "timer") -> str:
        """Start a countdown timer that announces itself out loud when it finishes. seconds is the total duration in seconds (convert minutes and hours yourself). label says what it is for, for example 'pasta'."""
        if seconds < 1 or seconds > 7 * 86400:
            return "A timer must be between one second and seven days."
        self._start(seconds, label, f"Your {label} timer is done." if label != "timer" else "Your timer is done.")
        return f"Timer set for {self._say(seconds)}" + (f" for {label}." if label != "timer" else ".")

    @tool
    def set_reminder(self, time_24h: str, message: str) -> str:
        """Remind the user out loud at a clock time. time_24h is the time in 24-hour HH:MM format, for example 17:30 for 5:30 PM. It is today if that time is still ahead, otherwise tomorrow. message is what to remind them about."""
        try:
            hh, mm = (int(x) for x in time_24h.strip().split(":")[:2])
            target = datetime.datetime.now().replace(hour=hh, minute=mm, second=0, microsecond=0)
        except (ValueError, TypeError):
            return "I need the time as HH:MM in 24-hour format."
        if target <= datetime.datetime.now():
            target += datetime.timedelta(days=1)
        seconds = (target - datetime.datetime.now()).total_seconds()
        self._start(seconds, message[:30], f"Reminder: {message}")
        when = target.strftime("%I:%M %p").lstrip("0")
        return f"I'll remind you at {when} {'tomorrow' if target.date() != datetime.date.today() else 'today'}: {message}."

    @tool
    def list_timers(self) -> str:
        """List the active timers and reminders and how long is left on each."""
        with self.lock:
            items = [(v["label"], v["end"] - time.time()) for v in self.items.values()]
        if not items:
            return "No timers or reminders are running."
        return "; ".join(f"{label}: {self._say(left)} left" for label, left in sorted(items, key=lambda i: i[1]))

    @tool
    def cancel_timer(self, label: str = "") -> str:
        """Cancel a timer or reminder whose label contains the given text. With an empty label, cancel all of them."""
        with self.lock:
            ids = [i for i, v in self.items.items() if not label or label.lower() in v["label"].lower()]
            for i in ids:
                self.items[i]["timer"].cancel()
                del self.items[i]
        self._publish()
        return f"Cancelled {len(ids)} timer{'s' if len(ids) != 1 else ''}." if ids else "No matching timer found."
