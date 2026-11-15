# Using Claude Code's Code Mode on Volteira

Code Mode is an experimental Claude Code feature. Instead of asking for one tool call at a time, Claude writes a short piece of JavaScript that makes several tool calls (search, edit, run tests) in one step. It is off by default and may change or be removed in any release.

## When it helps here

- A change repeated across many files (for example renaming a field through `src/`, its tests and `supabase/` files)
- Searches whose results need filtering before Claude reads them (the docs and audits folders are large)
- Several independent commands at once (`npm test`, lint, type check)

For money, security and migration work, review the diff as usual. Code Mode doesn't change the rules in `AGENTS.md`.

## Turn it on (local terminal only)

Code Mode does not work in cloud sessions, `-p`, the Agent SDK, the VS Code panel or the Desktop app. It needs Claude Code v2.1.323 or later (the native build), a Claude subscription or Console account, and Opus 5.5, Sonnet 5.5, Haiku 5.5 or Fable 5.2.

```bash
claude --version        # must be 2.1.323 or later; run `claude update` if not
cd Electrician-App
CLAUDE_CODE_EXPERIMENTAL_CODE_MODE=1 claude
```

To turn it on for every session, put this in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_EXPERIMENTAL_CODE_MODE": "1" } }
```

Claude Code ignores this variable in a project's settings files, so it can't be enabled from this repo. Confirm the prompt on first use. You should see `Code Mode (experimental) is on` near the top of the session.

## Things to know

- Press `Ctrl+O` to open the transcript viewer and read the code Claude wrote (collapsed **Code** rows).
- To resume a Code Mode session, keep the variable set to `1` when you run `claude --continue` or `--resume`.
- Auto mode's classifier reviews the code as a whole, not each tool call. Keep `deny` rules or `PreToolUse` hooks for anything that must be controlled (a hook can match `REPL` and read `tool_input.code`).
- Code that waits stops after ten minutes. Background runs (up to two hours) need auto or `bypassPermissions` mode.
- To turn it off, remove the variable or set it to `0`, then start a new session.

## Troubleshooting

If you see `Code Mode (experimental) isn't available`, the reason follows on the same line and `/status` repeats it. Common causes: an old version, a gateway or cloud provider in place of the Anthropic API, `apiKeyHelper`, `DISABLE_TELEMETRY`, OpenTelemetry export, or agent teams. The full table is at https://code.claude.com/docs/en/code-mode.
