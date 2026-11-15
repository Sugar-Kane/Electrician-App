---
name: ship-a-change
description: The end-to-end workflow for implementing, verifying and delivering any feature, fix or refactor in this app - read the project rules, make the smallest correct change, build, lint, run tests, use it in a browser at phone/tablet/desktop sizes, self-review, then commit and open a draft PR. Use at the start of any coding task the user gives, and again before saying a task is done, even for small fixes.
---

# Ship a change

A consistent loop saves the rework seen in this repo's history (follow-up "fix the open findings" PRs after the first merge). Each step exists to catch a specific class of mistake early.

## 1. Orient (2 minutes, saves hours)

- Read `AGENTS.md` / `CLAUDE.md`. In this repo Next.js has breaking changes versus what you remember: read the relevant guide in `node_modules/next/dist/docs/` before writing framework code (run `npm install` first if `node_modules` is missing).
- Find the existing pattern: grep for a sibling feature (page, action, component, `src/lib` rule) and copy its structure rather than inventing one.
- Decide which specialist skills apply: UI -> `responsive-ui`, `design-tokens-first`; data -> `multi-tenant-supabase`; money/messages/consent -> `money-and-trust-code`.

## 2. Plan small

State the change in two or three sentences. If it touches a schema, money or messaging, list the cases that could go wrong (two requests at once, repeat delivery, missing data, other tenant) before coding. Prefer extracting the logic into a pure function in `src/lib` so it's testable.

## 3. Implement

- Smallest change that solves the problem; no drive-by refactors or speculative options.
- Comments explain **why** (the surprising constraint), not what.
- Handle loading, empty, error and long-content states. Never show raw provider errors to users.

## 4. Verify (don't skip; this is what "done" means)

```bash
npm run lint
npm test            # the whole suite, not just your file
npm run build       # catches type and route errors lint does not
```

Then use the change in a real browser. Start `npm run dev`, exercise the happy path and one failure path, and run the responsive check:

```bash
node .claude/skills/responsive-ui/scripts/check_layouts.mjs --base http://localhost:3000 --paths <changed routes> --out /tmp/shots
```

Look at the screenshots. UI changes aren't verified by tests or a passing build. If you can't run something (no database, no credentials), say so plainly rather than implying it passed.

## 5. Self-review the diff

Read your own diff as a reviewer would: leftover debug code, hard-coded colours, missing organization scoping, unhandled race, copy that overpromises, accidental file changes (including lockfile churn and the auto-generated AGENTS.md block, which should be committed rather than reverted).

## 6. Deliver

- Commit with a message that says what changed for the user and why.
- Push to the designated branch and open a **draft** PR, mirroring the repo's PR template if one exists. Describe what was verified and what wasn't.
- Subscribe to PR activity; treat review findings as real bugs to reproduce and fix, never by skipping or deleting a test.

## 7. Report honestly

Summarize what changed, what you verified (and how), and anything you couldn't check. Flag decisions the user should make instead of silently choosing.
