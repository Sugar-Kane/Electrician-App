# command-registry

Project skill. Shows and maintains `.claude/COMMANDS.md`, the master list of custom Claude Code
commands and skills.

```
/command-registry              everything
/command-registry compliance   compliance commands
/command-registry website      website commands
/command-registry security     security commands
/command-registry installed    only commands verified as installed
```

Verification script: `node compliance/scripts/verify-command-registry.mjs`.
