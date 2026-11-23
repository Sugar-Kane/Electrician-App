"""Known secret file formats: which files they are and how every value in them is hidden."""

import fnmatch
import os
import re

from masking import _key, _sub, _val, mask

# Known secret file formats, each regex's v group is one value
# KEY=value and ini `key = value` (.env, .npmrc `//host/:_authToken=`, aws credentials, tfvars)
# quoted alternatives span newlines, so multi-line values (PEM in quotes) go whole
KV = re.compile(
    r"""^([ \t]*(?:export[ \t]+)?[A-Za-z_./@][\w./:@-]*[ \t]*=[ \t]*)(?P<v>"(?:\\.|[^"\\])*"|'[^']*'|\S.*|)$""",
    re.MULTILINE,
)

JSON_STR = re.compile(r'("(?:\\.|[^"\\])*"\s*:\s*)"(?P<v>(?:\\.|[^"\\])*)"')

PGPASS = re.compile(
    r"^([^#\n](?:(?:[^:\n\\]|\\.)*:){4})(?P<v>.*)$", re.MULTILINE
)  # host:port:db:user:PASSWORD

NETRC = re.compile(r"(\b(?:password|passwd|account)[ \t]+)(?P<v>\S+)")

YAML_KEY = re.compile(r"^([ \t]*(?:-[ \t]+)?[\w.-]+:)(?:[ \t]+(.*))?$")

SKIP = (".env.example", ".env.sample")  # templates: fall through to normal detection

# Known secret file redactors, every value in the file is hidden
redact_kv = _sub(KV, _key)
# redact_json masks string values only; numbers/bools stay visible
redact_json = _sub(JSON_STR, _key)
redact_pgpass = _sub(PGPASS)
redact_netrc = _sub(NETRC)
redact_whole = lambda text: mask(text.strip()) + "\n" if text.strip() else text


def redact_yaml(text):
    out, block, owner = (
        [],
        None,
        None,
    )  # block = indent of the key owning a `|` / `>` block scalar

    for line in text.splitlines(keepends=True):
        body = line.rstrip("\r\n")
        end, ind, content = (
            line[len(body) :],
            len(body) - len(body.lstrip()),
            body.strip(),
        )

        if block is not None and (not content or ind > block):
            out.append(body[:ind] + mask(content, owner) + end if content else line)

            continue
        block = None
        m = YAML_KEY.match(body)

        if not m or content.startswith("#"):
            out.append(line)

            continue
        v = (m.group(2) or "").strip()

        if not v:
            out.append(line)  # `key:` with nested mapping below: nothing to mask
        elif v[0] in "|>":
            block, owner = ind, _key(m.group(1))
            out.append(line)
        else:
            out.append(m.group(1) + " " + _val(v, _key(m.group(1))) + end)

    return "".join(out)


# KNOWN sits here, not with the constants, because it names the redactors above
KNOWN = [  # (globs matched on the file's basename, redactor)
    (
        (
            ".env*",
            "*.env",
            ".flaskenv",
            ".dev.vars",
            ".dev.vars.*",
            ".npmrc",
            ".pypirc",
            ".s3cfg",
            "credentials",
            "*.tfvars",
        ),
        redact_kv,
    ),
    (
        (
            "*.pem",
            "*.key",
            "*.p8",
            "*.ppk",
            "id_rsa",
            "id_dsa",
            "id_ecdsa",
            "id_ed25519",
            ".git-credentials",
        ),
        redact_whole,
    ),
    (
        ("*secret*.yml", "*secret*.yaml", "*credential*.yml", "*credential*.yaml"),
        redact_yaml,
    ),
    (("*secret*.json", "*credential*.json", "service-account*.json"), redact_json),
    ((".pgpass",), redact_pgpass),
    ((".netrc", "_netrc"), redact_netrc),
]


def known_redactor(path):
    name = os.path.basename(path)

    if name in SKIP:
        return None

    for globs, fn in KNOWN:
        if any(fnmatch.fnmatch(name, g) for g in globs):
            return fn

    return None
