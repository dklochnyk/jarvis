"""Settings = config.defaults.yaml (shipped with the code, replaced by updates)
           + settings.yaml (YOURS, never touched by updates, overrides the defaults).

First run after upgrading from an older version: whatever you had changed in the old
config.yaml is copied into settings.yaml automatically."""
import os

import yaml

TEMPLATE = """# Your personal settings. Jarvis updates never touch this file.
# Anything you put here overrides config.defaults.yaml (open that file to see every option).
#
# user_name: Sam              # what Jarvis calls you
# provider: gemini            # gemini | claude
# mic_device: 1               # run list-mics.bat to find the number
# stt:
#   model: medium.en
# folders:
#   schedule: "C:\\\\Users\\\\you\\\\Documents\\\\Schedule"
"""


WARNINGS = []  # problems found while reading settings; main.py prints them at startup


class _Loader(yaml.SafeLoader):
    """Same as the normal loader, but notices a setting written twice (YAML silently keeps the last one)."""

    def construct_mapping(self, node, deep=False):
        seen = set()
        for key_node, _ in node.value:
            key = self.construct_object(key_node, deep=True)
            if key in seen:
                WARNINGS.append(f"'{key}' appears more than once in a settings file - only the LAST one counts.")
            seen.add(key)
        return super().construct_mapping(node, deep)


def _read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return yaml.load(f, Loader=_Loader) or {}
    except FileNotFoundError:
        return {}


def deep_merge(base, over):
    out = dict(base)
    for k, v in (over or {}).items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def _diff(default, mine):
    """The parts of `mine` that differ from `default`."""
    out = {}
    for k, v in (mine or {}).items():
        if k not in default:
            out[k] = v
        elif isinstance(v, dict) and isinstance(default[k], dict):
            sub = _diff(default[k], v)
            if sub:
                out[k] = sub
        elif v != default[k]:
            out[k] = v
    return out


def load_config(root):
    defaults_path = os.path.join(root, "config.defaults.yaml")
    settings_path = os.path.join(root, "settings.yaml")
    legacy_path = os.path.join(root, "config.yaml")

    defaults = _read(defaults_path) or _read(legacy_path)
    if not os.path.exists(settings_path):
        legacy = _read(legacy_path)
        mine = _diff(defaults, legacy) if legacy and os.path.exists(defaults_path) else {}
        with open(settings_path, "w", encoding="utf-8") as f:
            if mine:
                f.write("# Your personal settings, carried over from your old config.yaml.\n"
                        "# Jarvis updates never touch this file; it overrides config.defaults.yaml.\n")
                yaml.safe_dump(mine, f, sort_keys=False, allow_unicode=True)
            else:
                f.write(TEMPLATE)
    return deep_merge(defaults, _read(settings_path))
