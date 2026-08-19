/**
 * Back to the top of the screen.
 *
 * Two things make this less obvious than it looks.
 *
 * `globals.css` sets `scroll-behavior: smooth` on the document, which is right
 * for an anchor link and wrong here: arriving at Home after scrolling through a
 * long day would animate several screens' worth of content past you before
 * settling. `instant` overrides it for this one jump. The cast is because the
 * DOM types in this TypeScript version still describe `ScrollBehavior` as
 * "auto" | "smooth", while every browser this ships to implements `instant`.
 *
 * And the window is the scroll container — `html` is `h-full`, `body` is
 * `min-h-full`, and nothing in between scrolls on its own. Resetting an inner
 * element would move nothing, which is the version of this fix that looks
 * finished and does nothing at all.
 */
export function scrollToTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
}
