#!/bin/sh
# Launch a harness adapter (claude.py by default) with uv or any Python 3.9+ (stdlib only).
# POSIX sh shim; official security-guidance/hooks/sg-python.sh also handles
# MSYS path conversion and Store-alias symlinks, add those if Windows reports come in.
export PYTHONPATH="$(dirname "$0")/../core"  # adapters import redact from core/
export PYTHONUTF8=1  # Windows Python would read/write the hook JSON as cp1252
S="$(dirname "$0")/claude.py"  # Claude Code wire contract; OpenCode and Pi send Claude-shaped events too
FAIL=1
if [ "$1" = "--codex" ]; then  # Codex wire contract (see codex.py): block + redacted reason
  S="$(dirname "$0")/codex.py"
elif [ "$1" = "--gemini" ]; then  # Gemini wire contract (see gemini.py): deny + redacted reason
  S="$(dirname "$0")/gemini.py"
  FAIL=2  # Gemini hides the result on exit 2; any other failure would pass it through
fi
in=""
[ -t 0 ] || in=$(cat)  # buffered so a failed uv run (offline first install) can retry on python

# GUI-launched sessions often lack ~/.local/bin on PATH
for uv in uv "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
  if command -v "$uv" >/dev/null 2>&1; then
    printf '%s' "$in" | "$uv" run --quiet --script "$S" && exit 0
    break
  fi
done

# probe rejects Python 2 and the Windows Store python3 stub (it exits non-zero)
for py in python3 python "py -3"; do
  if $py -c 'import sys; sys.exit(sys.version_info < (3, 9))' >/dev/null 2>&1; then
    printf '%s' "$in" | $py "$S"
    exit $?
  fi
done

if [ "$FAIL" = 2 ]; then
  echo "never-secret: no uv or Python 3.9+ found, output withheld" >&2
else
  echo "never-secret: no uv or Python 3.9+ found, output NOT redacted" >&2
fi
exit $FAIL
