---
name: command-registry
description: Show the master list of custom Claude Code commands and skills for this project (and the user's global ones when present) - what each does, its arguments, an example, where it lives, which integrations it needs, whether it can change anything, and whether it is installed and verified. Use when the user types /command-registry (optionally all, compliance, website, security or installed), asks "what commands do I have", "what was that command called", or after any custom skill or command is created, renamed, changed or deprecated (then update the registry too).
argument-hint: "[all|compliance|website|security|installed]"
---

# Command registry

The registry is `.claude/COMMANDS.md` in this repository (canonical). A copy may also be kept at
`~/.claude/COMMANDS.md` for global commands on the user's own machine.

## Show

Parse `$ARGUMENTS`:

| Argument | Show |
|---|---|
| *(none)* or `all` | every entry, grouped by status (Installed, Proposed, Deprecated, Unavailable) |
| `compliance` | entries tagged compliance |
| `website` | entries tagged website |
| `security` | entries tagged security |
| `installed` | run `node compliance/scripts/verify-command-registry.mjs` first, then show only entries it confirms |

Read `.claude/COMMANDS.md` and print the matching rows with name, one-line description and example.
Then print a copy-ready block of the example invocations.

## Keep it current

Whenever a custom skill or command is created, renamed, changed or deprecated in this repository:

1. Edit its row in `.claude/COMMANDS.md` (fields: name, description, required and optional
   arguments, example, file location, scope, required MCP integrations, output location,
   read-only or can modify, date created, date last verified, version, status, known
   limitations).
2. Run `node compliance/scripts/verify-command-registry.mjs`. It checks that every row marked
   Installed has a `SKILL.md` whose frontmatter `name` matches, and that every project skill
   folder has a row. Fix anything it reports.
3. Never mark a command Installed until its files exist and it has been seen in a session's
   skill list or invoked once.

Built-in Claude Code commands (such as `/code-review` or `/security-review`) are listed for
reference but are not ours to change.

Skill version: 1.0.0 (2026-11-24).
