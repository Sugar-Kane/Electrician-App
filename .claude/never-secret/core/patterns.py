"""Token formats that never-secret masks.

Each regex's (?P<v>...) group is the secret. Formats come from detect-secrets
(Yelp, v1.5.0) and provider docs, limited to shapes ordinary text never has.
"""

import base64
import re

from masking import _sub

PRIVATE_KEY_BLOCK = re.compile(
    r"(?P<v>-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----)",
    re.DOTALL,
)
AWS_ACCESS_KEY_ID = re.compile(
    r"\b(?P<v>(?:A3T[A-Z0-9]|ABIA|ACCA|AKIA|ASIA)[0-9A-Z]{16})\b"
)
AWS_SECRET_KEY = re.compile(
    r"aws[\w.-]{0,20}?(?:secret|sk)[\w.-]{0,20}?[\"']?\s*[:=]\s*[\"']?(?P<v>[A-Za-z0-9/+]{40})(?![A-Za-z0-9/+=])",
    re.IGNORECASE,
)
GITHUB_TOKEN = re.compile(r"\b(?P<v>gh[pousr]_[A-Za-z0-9_]{36,})\b")
GITHUB_PAT = re.compile(r"\b(?P<v>github_pat_[A-Za-z0-9_]{22,})\b")
GITLAB_TOKEN = re.compile(
    r"\b(?P<v>(?:glpat|gldt|glft|glsoat|glrt|glcbt|glimt|glptt|glagent|gloas)-[A-Za-z0-9_-]{20,50})(?!\w)"
)
GITLAB_RUNNER_TOKEN = re.compile(r"\b(?P<v>GR1348941[A-Za-z0-9_-]{20,50})(?!\w)")
SLACK_TOKEN = re.compile(r"\b(?P<v>xox[aboprs]-[A-Za-z0-9-]{10,})\b")
SLACK_WEBHOOK = re.compile(
    r"(?P<v>https://hooks\.slack\.com/services/T[A-Za-z0-9_]+/B[A-Za-z0-9_]+/[A-Za-z0-9_]+)",
    re.IGNORECASE,
)
OPENAI_ANTHROPIC_KEY = re.compile(r"(?P<v>\bsk-[A-Za-z0-9_-]{20,})")
STRIPE_KEY = re.compile(r"\b(?P<v>[rs]k_(?:live|test)_[A-Za-z0-9]{16,})\b")
GOOGLE_API_KEY = re.compile(r"\b(?P<v>AIza[0-9A-Za-z_-]{35})\b")
SENDGRID_KEY = re.compile(r"\b(?P<v>SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})(?!\w)")
PYPI_TOKEN = re.compile(
    r"\b(?P<v>pypi-AgE(?:IcHlwaS5vcmc|NdGVzdC5weXBpLm9yZw)[A-Za-z0-9_-]{70,})"
)
NPM_TOKEN = re.compile(r"\b(?P<v>npm_[A-Za-z0-9]{36})\b")
# Legacy npm token in .npmrc
NPM_LEGACY_TOKEN = re.compile(
    r":_authToken=\s*(?P<v>[A-Fa-f0-9]{8}-(?:[A-Fa-f0-9]{4}-){3}[A-Fa-f0-9]{12})\b"
)
DISCORD_BOT_TOKEN = re.compile(
    r"\b(?P<v>[MNO][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38})(?!\w)"
)
# Also matches the token inside /bot<token> URLs
TELEGRAM_BOT_TOKEN = re.compile(r"(?<!\d)(?P<v>\d{8,10}:[A-Za-z0-9_-]{35})(?!\w)")
TWILIO_KEY = re.compile(r"\b(?P<v>(?:AC|SK)[a-z0-9]{32})\b")
MAILCHIMP_KEY = re.compile(r"\b(?P<v>[0-9a-z]{32}-us[0-9]{1,2})\b")
SQUARE_OAUTH = re.compile(r"\b(?P<v>sq0csp-[0-9A-Za-z_-]{43})")
AZURE_STORAGE_KEY = re.compile(r"AccountKey=(?P<v>[A-Za-z0-9+/=]{88})")
# requires a digit so plain words don't match
ARTIFACTORY_TOKEN = re.compile(
    r"(?:(?<=[\s=:\"'])|^)(?=[A-Za-z0-9]*\d)(?P<v>(?:AKC[A-Za-z0-9]{10,}|AP[0-9A-F][A-Za-z0-9]{8,}))(?=[\s\"']|$)",
    re.MULTILINE,
)
JWT = re.compile(
    r"\b(?P<v>eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})"
)
BEARER_TOKEN = re.compile(r"\bBearer\s+(?P<v>[A-Za-z0-9._~+/-]{20,}=*)")
# Password in scheme://user:pass@host. Quotes are excluded so a
# quoted URL's port isn't mistaken for a password
URL_CREDENTIALS = re.compile(
    r"\b[a-z][a-z0-9+.-]*://[^/\s:@\"']+:(?P<v>[^@\s/\"']+)@", re.IGNORECASE
)

PATTERNS = [
    PRIVATE_KEY_BLOCK,
    AWS_ACCESS_KEY_ID,
    AWS_SECRET_KEY,
    GITHUB_TOKEN,
    GITHUB_PAT,
    GITLAB_TOKEN,
    GITLAB_RUNNER_TOKEN,
    SLACK_TOKEN,
    SLACK_WEBHOOK,
    OPENAI_ANTHROPIC_KEY,
    STRIPE_KEY,
    GOOGLE_API_KEY,
    SENDGRID_KEY,
    PYPI_TOKEN,
    NPM_TOKEN,
    NPM_LEGACY_TOKEN,
    DISCORD_BOT_TOKEN,
    TELEGRAM_BOT_TOKEN,
    TWILIO_KEY,
    MAILCHIMP_KEY,
    SQUARE_OAUTH,
    AZURE_STORAGE_KEY,
    ARTIFACTORY_TOKEN,
    JWT,
    BEARER_TOKEN,
    URL_CREDENTIALS,
]


def _basic_creds(v):
    """A Basic auth value is only a hit if it decodes to printable user:password."""

    try:
        s = base64.b64decode(v, validate=True).decode()
    except (ValueError, UnicodeDecodeError):  # binascii.Error subclasses ValueError
        return False

    return ":" in s and s.isprintable()


BASIC_AUTH = re.compile(r"\bBasic\s+(?P<v>[A-Za-z0-9+/]{8,}={0,2})(?![A-Za-z0-9+/=])")

# Matches masked only when the check confirms the value
CHECKED = [(BASIC_AUTH, _basic_creds)]


def apply_patterns(text):
    for pat, ok in [(p, None) for p in PATTERNS] + CHECKED:
        text = _sub(pat, ok=ok)(text)

    return text
