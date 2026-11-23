# never-secret (pinned copy)

A pinned copy of [bileet/never-secret](https://github.com/bileet/never-secret), commit
`0b2dcab62243ed711d81e24a87fd7f0eaa83da63`, copied 2026-11-23. MIT license (see `LICENSE`).

It runs after every tool call in Claude Code, through the `PostToolUse` hook in
`.claude/settings.json`. Secret values in what the AI reads are replaced with
`[REDACTED length=N]`: file reads, command output, searches, web pages and connector results.
Your files are never changed.

It finds:
- values in secret files: `.env*`, private keys, `.npmrc`, `.netrc`, AWS credentials and the like, in
  the project and the home folder;
- known key formats: Stripe, GitHub, OpenAI, Anthropic, Slack and AWS keys, bearer tokens, passwords in URLs;
- those same values again when they're hex, base64, URL-encoded or reversed.

It does not catch a password typed straight into ordinary source code. It needs `uv` or Python 3.9+.
Without either it lets output through unredacted and prints a warning.

It is a copy, not a plugin install, for two reasons. It works the same in Claude Code on the web,
the CLI and desktop, with nothing for anyone to install. And it can't change when the upstream
repository does.

## What is here
Only the Claude Code hook: `hooks/run.sh`, `hooks/claude.py`, and the redaction engine in `core/`.
These are unchanged from upstream. The other agents' adapters, the tests and the self-check skill
are left out.

## Updating
It is not updated automatically. To update: review the upstream diff since the commit above,
copy the same files across, and change the commit and date here.
