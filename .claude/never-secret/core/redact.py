#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""never-secret shared redaction engine, used by every harness adapter
(claude.py, codex.py, gemini.py; OpenCode and Pi go through claude.py).

Known secret files (KNOWN globs: .env*, SSH/PEM keys, .npmrc, .pgpass, .netrc,
AWS credentials, *.tfvars, secret YAML/JSON, ...) are redacted right away: every
value is replaced by its format's redactor, no detection needed.
Everything else: only positive hits, i.e. the token formats in PATTERNS (private key blocks,
provider token shapes, URL credentials). No entropy or key-name guessing: `token = get_token()`
or `password: str` in code is never touched. Stdlib only, so the result is the same everywhere.

"""

import os
import re

from formats import known_redactor, redact_whole
from masking import mask
from patterns import apply_patterns
from values import known_values, mask_values, with_encodings

# Listing prefixes and the words of a shell command
# grep-style `path:` / `path:12:` / `path-12-` line prefixes, and head/tail `==> path <==` headers
GREP_LINE = re.compile(r"^(?P<pre>(?P<path>[^\s:]+?)(?::\d+[:-]|-\d+-|:))(?P<rest>.*)$")

HEAD_HEADER = re.compile(r"^==> (.+) <==$")

# words of a shell command that may name a file
CMD_TOKEN = re.compile(r"[^\s'\"<>|;&()=]+")


# Redacting output
def redact_listing(text):
    """Redact lines of output that come from known files the command never named (grep -r, head *)."""
    out, current = (
        [],
        None,
    )  # current = redactor for the file under the latest ==> header

    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        end = line[len(body) :]
        h = HEAD_HEADER.match(body)

        if h:
            current = known_redactor(h.group(1))
            out.append(line)

            continue
        m = GREP_LINE.match(body)
        fn = m and known_redactor(m.group("path"))

        if fn:
            pre, body = m.group("pre"), m.group("rest")
        else:
            pre, fn = "", current

        if fn and body.strip():
            # per line: whole-file formats mask the line, multi-line YAML blocks aren't tracked here
            body = mask(body.strip()) if fn is redact_whole else fn(body)
        out.append(pre + body + end)

    return "".join(out)


def redact_text(v, fns=(), vals=()):
    """One string: listing lines, format redactors, patterns, then exact values."""

    if not v.strip():
        return v
    v = redact_listing(v)

    for fn in fns:
        v = fn(v)

    return mask_values(
        apply_patterns(v), vals
    )  # values last: format redactors would re-mask a mask


def deep_redact(v, fns=(), vals=()):
    """Every string in an unknown structure. Format redactors run on multi-line strings only:
    enum fields ("text", "code") keep their value, so the output still matches the tool's schema.
    """

    if isinstance(v, str):
        return redact_text(v, fns if "\n" in v else (), vals)

    if isinstance(v, dict):
        # base64 payloads (Read/MCP images, PDFs, audio, resource blobs, OpenCode file parts) pass through untouched
        return {
            k: (
                x
                if k in ("base64", "blob")
                or (k == "data" and "mimeType" in v)
                or (k == "uri" and "mime" in v)
                else deep_redact(x, fns, vals)
            )
            for k, x in v.items()
        }

    if isinstance(v, list):
        return [deep_redact(x, fns, vals) for x in v]

    return v


def command_files(cmd, cwd):
    """(redactors, values) for every file a shell command names: `cat .env` gets the .env
    redactor, and the file's secret values come in every encoding, so `xxd app.py` or
    `rev .env` can't hide them from detection, which only sees the encoded output.
    tokens only, globs (`cat src/*.py`) aren't expanded; expand them if that leaks.
    """
    fns, vals = [], set()

    for tok in dict.fromkeys(CMD_TOKEN.findall(cmd)):
        fn = known_redactor(tok)

        if fn and fn not in fns:
            fns.append(fn)
        p = os.path.join(
            cwd or "", os.path.expanduser(tok)
        )  # join keeps an absolute path as is

        if os.path.isfile(p):
            vals |= known_values(p, detect=True)

    return fns, with_encodings(vals)
