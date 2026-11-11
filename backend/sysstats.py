"""Live system numbers for the HUD's performance hub."""
import os
import time

import psutil


class Sampler:
    def __init__(self):
        psutil.cpu_percent(percpu=True)  # prime
        self.net = psutil.net_io_counters()
        self.t = time.time()
        self.n = 0
        self.procs = []
        self._cache = {}
        self.started = time.time()
        self.ncpu = psutil.cpu_count() or 1
        self.disk_path = os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else "/"

    def _top_processes(self):
        seen, totals = set(), {}
        for p in psutil.process_iter(["pid", "name"]):
            pid = p.info["pid"]
            seen.add(pid)
            proc = self._cache.get(pid)
            if proc is None:
                proc = self._cache[pid] = p
                try:
                    proc.cpu_percent(None)  # prime; real value next time
                except psutil.Error:
                    pass
                continue
            try:
                name = (p.info["name"] or "?").removesuffix(".exe")
                if name.lower() in ("system idle process", "idle"):
                    continue
                totals[name] = totals.get(name, 0.0) + proc.cpu_percent(None) / self.ncpu
            except psutil.Error:
                continue
        for pid in list(self._cache):
            if pid not in seen:
                del self._cache[pid]
        top = sorted(totals.items(), key=lambda kv: -kv[1])[:8]
        return [[n, round(v, 1)] for n, v in top]

    def sample(self):
        now = time.time()
        dt = max(0.2, now - self.t)
        net = psutil.net_io_counters()
        down = (net.bytes_recv - self.net.bytes_recv) / dt / 1024
        up = (net.bytes_sent - self.net.bytes_sent) / dt / 1024
        self.net, self.t = net, now

        cores = psutil.cpu_percent(percpu=True)
        mem = psutil.virtual_memory()
        try:
            disk = psutil.disk_usage(self.disk_path)
            disk_pct, disk_used, disk_total = disk.percent, disk.used / 1e9, disk.total / 1e9
        except Exception:
            disk_pct = disk_used = disk_total = 0
        bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None

        self.n += 1
        if self.n % 3 == 1:
            try:
                self.procs = self._top_processes()
            except Exception:
                pass
        return {
            "cpu": round(sum(cores) / max(1, len(cores)), 1),
            "cores": [round(c) for c in cores],
            "mem": mem.percent,
            "mem_used": round(mem.used / 1e9, 1),
            "mem_total": round(mem.total / 1e9, 1),
            "disk": disk_pct,
            "disk_used": round(disk_used),
            "disk_total": round(disk_total),
            "net_down": round(max(0, down), 1),
            "net_up": round(max(0, up), 1),
            "battery": round(bat.percent) if bat else None,
            "plugged": bool(bat.power_plugged) if bat else None,
            "uptime": int(now - psutil.boot_time()),
            "jarvis_up": int(now - self.started),
            "procs": self.procs,
        }
