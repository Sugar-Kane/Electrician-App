---
name: responsive-ui
description: Build or change any screen, component, form, modal, table, nav or page so it works on every device and orientation - phone portrait and landscape, tablet portrait and landscape, laptop and desktop. Use this whenever the user asks for UI, a page, a layout, a dialog, a sheet, a card, a form, a menu, a sticky bar, or says "make it look right", "fix the mobile view", "it's cut off", "it doesn't fit", or "responsive", even if they never say the words mobile or tablet. Includes a script that screenshots a page at six viewports and flags horizontal overflow and tiny tap targets.
---

# Responsive UI

Every screen ships working on all of these, not just the one you are looking at. Fixing a layout after the fact is where most UI rework in this app has come from (zoom locks, sheets that don't fit one screen, scroll jumps), so the matrix below is part of "done".

## The device matrix

| Name | Size (w x h) | Why it matters |
|---|---|---|
| phone-small | 320 x 568 | Smallest supported width. Catches overflow and wrapping. |
| phone-portrait | 390 x 844 | The main case for field and mobile-first apps. |
| phone-landscape | 844 x 390 | Only ~390px tall: fixed-height heroes, sticky bars and sheets break here. |
| tablet-portrait | 768 x 1024 | Falls between `sm` and `lg`; the most commonly forgotten size. |
| tablet-landscape | 1024 x 768 | Exactly the `lg` boundary, so both layouts can misfire. |
| desktop | 1440 x 900 | Wide: check max-widths, not just that it fits. |

## How to build it

1. **Mobile first.** Write the base (unprefixed) classes for the phone. Add `sm:` / `md:` / `lg:` only to enhance. Do not hide required actions behind a breakpoint.
2. **Choose breakpoints from the content, then check the in-between widths.** If the layout switches at `lg` (1024), look at 768-1023 explicitly. A two-column layout that needs 900px is wrong at 800 even though "tablet" feels like it should have columns.
3. **Height is a layout axis, not only width.** Landscape phones are short. Use `min-h-*` instead of `h-*` for content, `dvh`/`svh` instead of `vh` (mobile address bars make `vh` taller than the screen), let panels scroll internally with `max-h-[100dvh]` + `overflow-y-auto`, and keep sticky headers/footers slim. For landscape-specific tweaks use `@media (orientation: landscape) and (max-height: 500px)`.
4. **Safe areas.** Set `viewport-fit=cover` and pad fixed bars with `env(safe-area-inset-bottom|left|right)`. Otherwise a notch or home indicator covers the primary button.
5. **Touch.** Interactive targets are at least 44x44px with spacing between. Inputs use at least 16px text (iOS zooms the page into smaller ones). Hover-only affordances must also work by tap: gate hover styling with `@media (hover: hover)`. Use `pointer: coarse` to enlarge, not screen width.
6. **Flex and grid overflow.** Add `min-w-0` on flex children that contain text, `break-words` on user-entered text (names, addresses, emails), `truncate` only when the full value is visible elsewhere. Never rely on a long string being short.
7. **Tables.** Below `sm`, render rows as stacked cards (label/value pairs) rather than a sideways-scrolling table. If a wide table must stay, scroll the wrapper, never the page.
8. **Modals, sheets, dropdowns.** Cap height at the dynamic viewport, scroll inside, trap focus, close on Escape, and make sure the primary action is reachable without scrolling when the keyboard is open (scroll the focused field into view).
9. **Zoom and accessibility.** Don't disable pinch zoom as a layout fix. If an app deliberately locks zoom, record why in the code, and compensate with 16px inputs and good contrast.
10. **Motion and theme.** Respect `prefers-reduced-motion`. Use the project's colour tokens so light/dark or a single theme stays consistent (see `design-tokens-first`).
11. **States.** Layouts must hold with empty, one-item, and very-long-content states, and with the loading skeleton (same dimensions as the loaded content, so nothing jumps).

## Verify - this is required, not optional

With the dev server running, run the checker from the project root:

```bash
node .claude/skills/responsive-ui/scripts/check_layouts.mjs \
  --base http://localhost:3000 --paths / /jobs /settings --out /tmp/layout-shots
```

It loads each path at all six viewports and reports, per viewport:
- horizontal page overflow (`scrollWidth > clientWidth`) and the offending elements,
- interactive elements smaller than 40x40px,
- a full-page screenshot saved to `--out`.

Exit code is 1 if any page overflows horizontally. Then **open the screenshots** for the screens you changed (phone-landscape and tablet-portrait first) and look at them; the script catches overflow, not ugliness. Pass `--auth-cookie "name=value"` if the pages need a session. Fix, rerun, and mention the result in the summary.

For one-off checks the project's Playwright config may already define `desktop` and `mobile` projects; those two are not enough on their own.

## Common failures and the fix

- Content cut off on phone-landscape: a fixed `h-screen` or `h-[600px]`. Use `min-h-[100dvh]` or let it flow.
- Bottom button hidden behind the home bar: missing safe-area padding.
- Tablet portrait shows the phone layout stretched, or the desktop layout cramped: add an `md:` step or move the `lg` switch.
- Page scrolls sideways at 320px: a flex child without `min-w-0`, a `w-[480px]`, or a long unbroken string.
- Tap target too small: put padding on the button, not margin around it, so the hit area grows.
- Sticky header + sticky footer eat the whole landscape screen: make one of them non-sticky at `max-height: 500px`.
