"""Live system numbers for the HUD's performance hub."""
import csv
import os
import re
import subprocess
import threading
import time

import psutil


class GpuMeter(threading.Thread):
    """GPU load (%) from Windows' own performance counters, any vendor. One long-lived `typeperf`, restarted now and
    then so new processes get picked up. value stays None if the counters aren't available."""

    def __init__(self):
        super().__init__(daemon=True)
        self.value = None

    def run(self):
        if os.name != "nt":
            return
        while True:
            try:
                self._session(120)
            except Exception:
                self.value = None
                time.sleep(30)

    def _session(self, seconds):
        p = subprocess.Popen(
            ["typeperf", r"\GPU Engine(*)\Utilization Percentage", "-si", "2"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, creationflags=0x08000000,
        )
        threading.Timer(seconds, p.kill).start()
        names, got = None, False
        for line in p.stdout:
            line = line.strip()
            if not line.startswith('"'):
                continue
            row = next(csv.reader([line]))
            if row[0].startswith("(PDH"):
                names = row
                continue
            if not names or len(row) != len(names):
                continue
            sums = {}
            for name, val in zip(names[1:], row[1:]):
                m = re.search(r"luid_(\w+_\w+)_phys_\d+_eng_\d+_engtype_(\w+)", name)
                if not m:
                    continue
                try:
                    sums[m.groups()] = sums.get(m.groups(), 0.0) + float(val)
                except ValueError:
                    pass
            if sums:
                self.value = round(min(100.0, max(sums.values())), 1)
                got = True
        p.wait()
        if not got:
            time.sleep(60)


class Sampler:
    def __init__(self):
        psutil.cpu_percent(percpu=True)  # prime
        self.net = psutil.net_io_counters()
        self.t = time.time()
        self.n = 0
        self.gpu = GpuMeter()
        self.gpu.start()
        self.started = time.time()
        self.disk_path = os.environ.get("SystemDrive", "C:") + "\\" if os.name == "nt" else "/"

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
            "gpu": self.gpu.value,
        }
