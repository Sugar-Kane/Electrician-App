#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# ///
"""never-secret hook for Claude Code (also used by the OpenCode and Pi plugins, which send
Claude-shaped events).

Same redaction engine as the other adapters (core/redact.py); Claude Code's wire contract:
PostToolUse on every tool, the redacted result goes back through updatedToolOutput.
"""

import json
import sys

import formats
import redact
import values

ECHO_TOOLS = {  # output = Claude's own input, the user's answers, schemas or a fixed confirmation
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "TodoWrite",
    "TaskCreate",
    "TaskUpdate",
    "TaskGet",
    "TaskList",
    "ExitPlanMode",
    "EnterPlanMode",
    "AskUserQuestion",
    "ToolSearch",
    "KillShell",
    "TaskStop",
    "ScheduleWakeup",
    "CronCreate",
    "CronDelete",
    "PushNotification",
    "EnterWorktree",
    "ExitWorktree",
}


def redact_response(event):
    """Redacted tool_response for any tool's PostToolUse event, or None for ECHO_TOOLS.

    Read/Bash current formats (captured from Claude Code) get exact handling; every other
    tool (Grep, Glob, WebFetch, MCP, Agent, ...), any other shape, or the file content not
    where expected, falls back to deep_redact over every string field: listing lines,
    patterns and the known secret values.
    Not done on the serialized JSON string: there newlines are the two chars \\n, which
    breaks the line-based format redactors and lets a mask swallow a quote, and an output
    that no longer fits the tool's schema makes Claude Code send the original instead.
    """
    tool, inp, resp = (
        event.get("tool_name"),
        event.get("tool_input") or {},
        event.get("tool_response"),
    )

    if tool in ECHO_TOOLS:
        return None  # nothing Claude didn't already send; skip the walk
    vals = values.secret_values(event.get("cwd"))

    if tool == "Read":
        path = inp.get("file_path", "")
        fn = formats.known_redactor(path)
        fns = (fn,) if fn else ()
        vals |= values.with_encodings(
            values.known_values(path)
        )  # the file's own values, in any field
        f = resp.get("file") if isinstance(resp, dict) else None
        kind = resp.get("type") if isinstance(f, dict) else None

        if kind == "text" and isinstance(f.get("content"), str):
            # {"type": "text", "file": {"filePath", "content", "numLines", "startLine", "totalLines"}}
            return dict(
                resp, file=dict(f, content=redact.redact_text(f["content"], fns, vals))
            )

        if kind == "notebook" and isinstance(f.get("cells"), list):
            # {"type": "notebook", "file": {"filePath", "cells": [{"cellType", "source", "cell_id", ...}]}}
            return dict(
                resp, file=dict(f, cells=redact.deep_redact(f["cells"], fns, vals))
            )

        if kind in ("image", "pdf") and isinstance(f.get("base64"), str):
            return resp  # {"type": "image"|"pdf", "file": {"base64", ...}}: binary, nothing to redact as text
    elif tool == "Bash":
        # command mentions a known file: treat its output like that file
        # whole-file formats (`cat id_rsa && ls`) mask the entire output, by design
        fns, more = redact.command_files(inp.get("command", ""), event.get("cwd"))
        vals |= more  # `xxd app.py`, `rev .env`

        if (
            isinstance(resp, dict)
            and not resp.get("isImage")
            and isinstance(resp.get("stdout"), str)
            and isinstance(resp.get("stderr"), str)
        ):
            # {"stdout", "stderr", "interrupted", "isImage", "noOutputExpected"}; stdout has no
            # trailing newline, so the format redactors must run here even on one line
            return dict(
                resp,
                stdout=redact.redact_text(resp["stdout"], fns, vals),
                stderr=redact.redact_text(resp["stderr"], fns, vals),
            )
    else:
        fns = ()

    return redact.deep_redact(
        resp, fns, vals
    )  # other tools / unknown shape: walk every string field


def hook():
    event = json.load(sys.stdin)

    if event.get("hook_event_name") != "PostToolUse":
        return
    # redact the result, not the input: no temp copy, and Claude Code records the Read on
    # the real path, so a later Edit works. Rewriting a Bash command would also trip the
    # permission checker.
    clean = redact_response(event)

    if clean is not None and clean != event.get("tool_response"):
        json.dump(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUse",
                    "updatedToolOutput": clean,
                }
            },
            sys.stdout,
        )


if __name__ == "__main__":
    hook()
