"""Voice commands: "update yourself" and "restart"."""
import os

from toolkit import tool
from updater import read_version, update


class SelfUpdate:
    def __init__(self, cfg, root, request_restart):
        self.cfg = (cfg.get("update") or {})
        self.root = root
        self.request_restart = request_restart

    @tool
    def update_jarvis(self) -> str:
        """Check for a newer version of Jarvis's own software and install it. If it reports an update was installed, tell the user what changed in one sentence and ask whether to restart now; call restart_jarvis only if they agree."""
        r = update(self.root, self.cfg.get("repo", ""), self.cfg.get("branch", "main"),
                   os.environ.get("GITHUB_TOKEN", "").strip() or None, log=lambda m: None)
        if r["status"] == "up_to_date":
            return f"Already on the latest version, {r['version']}."
        if r["status"] == "updated":
            return (f"Installed version {r['version']}" + (f": {r['message']}" if r.get("message") else "")
                    + f". {len(r['files'])} files changed. A restart is needed to use it.")
        return f"The update didn't work: {r['message']}"

    @tool
    def restart_jarvis(self) -> str:
        """Restart Jarvis so that an update takes effect. It is back in about ten seconds. Say a short goodbye first; the restart happens right after you finish speaking."""
        if not self.request_restart():
            return "I can only restart when I was started with run.bat."
        return "Restarting after this reply."

    @tool
    def jarvis_version(self) -> str:
        """Report which version of Jarvis's own software is installed."""
        v = read_version(self.root)
        return f"Version {v['short']}: {v.get('message', '')}" if v else "This is a local copy that hasn't been updated yet."
