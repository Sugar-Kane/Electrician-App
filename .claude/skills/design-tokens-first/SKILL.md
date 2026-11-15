---
name: design-tokens-first
description: Set up or extend an app's visual system - colours, type, radii, spacing, status colours, dark/light, contrast, shared UI primitives - so every screen looks like one product. Use when starting a new app or UI, adding any colour, button, card, badge or status style, when the user says "make it look consistent", "match the theme", "brand colour", "dark mode", "restyle", or when you are about to write a hex colour or arbitrary pixel value into a component.
---

# Design tokens first

Volteira once had seven near-identical yellows, ten radii, a light dashboard repainted dark by ninety lines of overrides, and a primary button with 1.5:1 text contrast. Each was cheap to create and expensive to unwind. The rule: define the visual vocabulary once, and make components only reference it.

## New app: do this before the first screen

1. Create the tokens in one place (Tailwind 4: `@theme` in `globals.css`; otherwise CSS variables on `:root`):
   - **Ground**, furthest back to closest: canvas, surface, raised, sunken.
   - **Brand** + strong + the text colour that sits on it (`on-brand`).
   - **Text** by loudness: ink, muted, faint.
   - **Lines** as opacities over the ground, not fixed greys.
   - **Status** pairs: a text colour and a tint background for positive, caution, critical, info.
   - **Three radii** (panel, control, chip), and nothing else.
   - **Motion**: opacity/transform only, behind `motion-safe:`.
2. Measure contrast when you pick colours (4.5:1 for text under 18px, 3:1 for large text and UI borders). Check the faintest text on every ground and every tint it appears on, not just the main background.
3. Build the few primitives every screen reuses: page shell, panel, button (primary/secondary/danger), field, badge, empty state, skeleton, dialog/sheet. Components pull from tokens; screens pull from components.
4. Decide theme policy once: one theme, or light/dark via `color-scheme` and `prefers-color-scheme`. Don't repaint a theme with overrides on top of another.

## Existing app: before writing any style

- Search for the token and the primitive first. If `bg-surface` exists, don't write `#0b1b27`. If a `Button` exists, don't hand-roll one.
- If the thing you need doesn't exist, add the token or primitive in the shared place and use it, rather than a one-off value. If you would need a fourth radius or an eighth grey, that is a signal to reuse an existing one.
- Colour is never the only signal: pair status colours with an icon or label.

## Form controls and base layer gotchas

- Put `font: inherit; color: inherit` for `button/input/select/textarea` inside `@layer base`. Unlayered rules beat every Tailwind utility and silently override `text-*` on buttons.
- Native pickers (date, select list) are drawn by the OS and can't be themed with CSS; if they must match the product, build a custom control.
- Set `accent-color` and `color-scheme` so checkboxes, scrollbars and autofill follow the theme.

## Check

Grep the diff for `#[0-9a-f]{3,8}`, `rgb(`, and `\[[0-9]+px\]`. Each hit needs a reason or should become a token. Then run the `responsive-ui` check, since tokens like radius and padding interact with small screens.
