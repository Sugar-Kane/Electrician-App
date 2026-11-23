"""Known secret values: found in secret files, expanded to their encoded forms,
and masked wherever they appear in output."""

import base64
import html
import json
import os
import re
import time
import urllib.parse

import masking
from formats import known_redactor, redact_json
from masking import ANY_MASK, mask
from patterns import apply_patterns

# Secret key names, judged on whole parts of the name
SECRET_WORDS = {
    "secret",
    "secrets",
    "token",
    "tokens",
    "password",
    "passwd",
    "pass",
    "pwd",
    "pw",
    "credential",
    "credentials",
    "apikey",
    "dsn",
}

KEY_QUALIFIERS = {
    "api",
    "private",
    "access",
    "secret",
    "signing",
    "encryption",
    "master",
    "client",
}


# Where secret files are searched, and values too common to hide
PRUNE = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
    "target",
    "vendor",
    ".cache",
    ".tox",
}

HOME_FILES = (
    ".pgpass",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".s3cfg",
    ".git-credentials",
    ".aws/credentials",
    ".ssh/id_rsa",
    ".ssh/id_dsa",
    ".ssh/id_ecdsa",
    ".ssh/id_ed25519",
)

TRIVIAL = {"true", "false", "null", "none", "localhost"}

# a hex dump matches in any case and split by whitespace (_value_pattern)
HEX = re.compile(r"(?:[0-9a-f]{2}){4,}")


def secret_key(name):
    """Key name says secret, judged on whole parts: DB_PASS, apiKey, _authToken, STRIPE_KEY yes;
    author, tokenizer, REDDIT_USERNAME, KEY_PREFIX no."""
    parts = [
        p.lower()
        for p in re.split(r"[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])", name or "")
        if p
    ]

    return bool(set(parts) & SECRET_WORDS) or (
        "key" in parts and (parts[-1] == "key" or bool(set(parts) & KEY_QUALIFIERS))
    )


# Hide known files' actual values wherever they appear, in any format
def _masked_by(fn, text):
    """Every value fn(text) hides: reuse the redactor as a parser, mask() fills _collect."""
    masking._collect = {}

    try:
        fn(text)

        return masking._collect
    finally:
        masking._collect = None


def known_values(path, detect=False, hunt=False):
    """Values the file's own redactor would hide, split so multi-line values match line by line.
    detect=True: any other file gives what the patterns find in it.
    hunt=True: values to hide in every output, so only the secret ones. Like GitHub masking
    secrets.* but never vars.*: NODE_ENV=test or a username in .env must not mask every "test".
    """
    fn = known_redactor(path) or (detect and apply_patterns)

    try:
        if not fn or os.path.getsize(path) > 1_000_000:
            return set()

        with open(path, encoding="utf-8") as f:
            text = f.read()
    except (OSError, UnicodeDecodeError, ValueError):
        return set()
    raw = _masked_by(fn, text)

    if hunt:  # key None = keyless format (key files, .pgpass, .netrc, pattern hits): all secret
        raw = {
            v: keys
            for v, keys in raw.items()
            if None in keys or any(map(secret_key, keys)) or apply_patterns(v) != v
        }
    vals = set()

    for v in raw:
        if fn is redact_json:
            try:
                v = json.loads(
                    '"' + v + '"'
                )  # "a\\nb" in the file prints as a real newline
            except ValueError:
                pass
        vals.add(v.strip())
        vals.update(part.strip() for part in v.splitlines())

    # short / trivial / small numbers would mask half of every output
    return {
        v
        for v in vals
        if len(v) >= 4 and v.lower() not in TRIVIAL and not (v.isdigit() and len(v) < 6)
    }


def secret_values(cwd):
    """Values from every known file under cwd plus the usual ones in $HOME."""
    files = [os.path.join(os.path.expanduser("~"), f) for f in HOME_FILES]
    # 1s walk budget, files past it are missed; cache by mtime if repos get huge
    deadline = time.monotonic() + 1.0

    for root, dirs, names in os.walk(cwd or "."):
        dirs[:] = [d for d in dirs if d not in PRUNE]
        files += [os.path.join(root, n) for n in names if known_redactor(n)]

        if time.monotonic() > deadline:
            break
    vals = set()

    for f in files:
        vals |= known_values(f, hunt=True)

    return with_encodings(vals)


class Inner(str):
    """An encoded form (hex, base64) that sits inside a longer run, so it matches without word boundaries."""


def with_encodings(vals):
    """Add the encoded forms GitHub's runner masks too (actions/runner ValueEncoders.cs)."""
    out = set(vals)

    for v in vals:
        out |= {
            json.dumps(v)[1:-1],
            json.dumps(v, ensure_ascii=False)[1:-1],  # JSON-escaped
            urllib.parse.quote(v, safe=""),
            urllib.parse.quote_plus(v),  # URL-encoded
            html.escape(v),
            html.escape(v, quote=False),  # XML/HTML-escaped
            v.replace('"', '\\"'),  # shell-quoted
            v[::-1],
        }  # `rev`
        b = v.encode()
        out.add(
            Inner(b.hex())
        )  # xxd -p / od / hexdump; mask_values lets whitespace split the bytes

        # base64 at all 3 byte alignments, so base64("user:" + secret) is caught too. Unlike the
        # runner, keep only whole 4-char groups so it also matches when more data follows.
        for shift in (0, 1, 2):
            tail = b[shift:]
            enc = base64.b64encode(tail[: len(tail) // 3 * 3]).decode()

            if len(enc) >= 8:
                out.add(Inner(enc))

    return {v for v in out if len(v) >= 4}


def _value_pattern(v):
    """Literal match; a hex string also matches in any case and split by whitespace between
    bytes (xxd -p wraps at 60 chars, od/hexdump space the bytes). A plain value starting/ending
    in a letter or digit matches only as a whole word: "test" never masks inside "tests".
    """

    if HEX.fullmatch(v):
        return r"(?i:" + r"\s*".join(v[i : i + 2] for i in range(0, len(v), 2)) + ")"

    if isinstance(v, Inner):
        return re.escape(v)

    return (
        (r"\b" if v[0].isalnum() else "")
        + re.escape(v)
        + (r"\b" if v[-1].isalnum() else "")
    )


def mask_values(text, vals):
    if not vals:
        return text
    # one pass, longest first; existing masks are matched first and kept, so they're never re-masked
    pat = re.compile(
        "(?P<keep>"
        + ANY_MASK
        + ")|"
        + "|".join(_value_pattern(v) for v in sorted(vals, key=len, reverse=True))
    )

    return pat.sub(
        lambda m: m.group(0) if m.group("keep") else mask(m.group(0)),
        text,
    )
