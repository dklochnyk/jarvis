"""Tiny framework so a tool is just a decorated method.

    class MyTools:
        @tool
        def do_thing(self, what: str, times: int = 1) -> str:
            '''Docstring = what the AI reads to decide when to use this tool.'''

The JSON schema for Claude and the function signature for Gemini are both
generated from the method's type hints, so there is only one place to edit."""
import inspect

_JSON = {str: "string", int: "integer", float: "number", bool: "boolean"}


def tool(fn):
    fn._is_tool = True
    return fn


def schema_for(name, fn):
    props, required = {}, []
    for pname, p in inspect.signature(fn).parameters.items():
        props[pname] = {"type": _JSON.get(p.annotation, "string")}
        if p.default is inspect.Parameter.empty:
            required.append(pname)
    return {
        "name": name,
        "description": inspect.getdoc(fn) or name,
        "input_schema": {"type": "object", "properties": props, "required": required},
    }


def coerce(fn, args):
    """Models sometimes send 10.0 for an int or 'true' for a bool; fix and drop unknown keys."""
    params = inspect.signature(fn).parameters
    out = {}
    for k, v in (args or {}).items():
        p = params.get(k)
        if p is None:
            continue
        try:
            if p.annotation is int:
                v = int(float(v))
            elif p.annotation is float:
                v = float(v)
            elif p.annotation is bool:
                v = v if isinstance(v, bool) else str(v).lower() in ("true", "1", "yes")
            elif p.annotation is str:
                v = str(v)
        except (TypeError, ValueError):
            pass
        out[k] = v
    return out
