"""The HUD's clickable launcher. Items come from the `launcher:` list in settings.yaml.

    launcher:
      - {name: Chrome,    icon: "🌐", app: chrome}
      - {name: Downloads, icon: "📥", path: downloads}
      - {name: Gmail,     icon: "✉",  url: "https://mail.google.com"}
"""
KINDS = (("app", "open_app", "name"), ("path", "open_path", "name"), ("url", "open_url", "url"))


def normalize(items):
    out = []
    for it in items or []:
        if not isinstance(it, dict):
            continue
        for kind, tool_name, arg in KINDS:
            if it.get(kind):
                name = str(it.get("name") or it[kind])
                icon = str(it.get("icon") or name[:1].upper())
                out.append({"name": name, "icon": icon, "tool": tool_name, "arg": arg, "value": str(it[kind])})
                break
    return out[:18]


class Launcher:
    def __init__(self, cfg):
        self.items = normalize(cfg.get("launcher"))

    def public(self):
        return [{"name": i["name"], "icon": i["icon"]} for i in self.items]

    def run(self, index, tools):
        """Run item `index` through the normal tool layer. Only items from settings can be launched."""
        try:
            item = self.items[int(index)]
        except (ValueError, IndexError, TypeError):
            return "No such launcher item."
        return tools.run(item["tool"], {item["arg"]: item["value"]})
