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
        self.started = time.time()

    def sample(self):
        now = time.time()
        dt = max(0.2, now - self.t)
        net = psutil.net_io_counters()
        down = (net.bytes_recv - self.net.bytes_recv) / dt / 1024
        up = (net.bytes_sent - self.net.bytes_sent) / dt / 1024
        self.net, self.t = net, now

        cores = psutil.cpu_percent(percpu=True)
        mem = psutil.virtual_memory()
        bat = psutil.sensors_battery() if hasattr(psutil, "sensors_battery") else None

        self.n += 1
        return {
            "cpu": round(sum(cores) / max(1, len(cores)), 1),
            "cores": [round(c) for c in cores],
            "mem": mem.percent,
            "mem_used": round(mem.used / 1e9, 1),
            "mem_total": round(mem.total / 1e9, 1),
            "net_down": round(max(0, down), 1),
            "net_up": round(max(0, up), 1),
            "battery": round(bat.percent) if bat else None,
            "plugged": bool(bat.power_plugged) if bat else None,
            "uptime": int(now - psutil.boot_time()),
            "jarvis_up": int(now - self.started),
        }
