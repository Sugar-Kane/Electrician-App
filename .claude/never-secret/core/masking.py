"""What a hidden value becomes, and the redactor builder every format uses."""

import re

# What a hidden value becomes
EMPTY = "[EMPTY]"

ANY_MASK = r"\[(?:REDACTED length=\d+|EMPTY)\]"

_collect = None  # set by known_values(): mask() records every value a redactor hides, with its key


# Masking
def mask(v, key=None):
    if _collect is not None:
        _collect.setdefault(v, set()).add(key)

    return f"[REDACTED length={len(v)}]"


def _val(v, key=None):
    v = v.rstrip()

    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]  # length counts the value, not its quotes

    return mask(v, key) if v else EMPTY


def _key(prefix):
    """The key name in a `KEY=` / `"key":` / `  - key:` prefix (a JSON value's opening quote is ignored)."""
    m = re.search(
        r"([\w./@:-]+?)[\"']?\s*[:=]\s*$",
        re.sub(r"^\s*(?:export\s+|-\s+)?", "", prefix.rstrip("\"'")),
    )

    return m and m.group(1).strip("\"'")


def _sub(pat, key=None, ok=None):
    """A redactor masking group v of every match: key(prefix) names the value, ok(v) must confirm it."""

    def rep(m):
        v, pre = m.group("v"), m.string[m.start() : m.start("v")]

        if ok and not ok(v):
            return m.group(0)

        return pre + _val(v, key(pre) if key else None) + m.string[m.end("v") : m.end()]

    return lambda text: pat.sub(rep, text)
