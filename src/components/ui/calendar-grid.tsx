/**
 * The shape of a month grid, in one place.
 *
 * Two grids draw a month now — the weekly hours pattern and the date picker —
 * and the cell sizing is the part that was hard to get right rather than the
 * part that is obvious. All three classes are load-bearing:
 *
 *  - `aspect-square` for a square wherever there is room
 *  - `min-h-11` for the 44px a thumb needs, when there is not
 *  - `min-w-0` and `max-w-full` so the button stays inside its column. An
 *    aspect-ratio box transfers `min-height` back through the ratio into a
 *    minimum *width*, and `min-width: 0` alone does not stop it: measured at
 *    320px the track came out 40px and the button rendered 44 inside it,
 *    overflowing the grid by 4px with nothing visible to say so.
 *
 * Seven 44px columns need the whole width of the narrowest phone, so a square
 * that big cannot fit there. Height is the dimension a thumb misses on.
 */

/** One day. Square where it can be, always tall enough to hit. */
export const CALENDAR_CELL = "aspect-square min-h-11 min-w-0 max-w-full";

/** Seven equal columns, tight enough that they fit a 320px phone. */
export const CALENDAR_ROW = "grid grid-cols-7 gap-0.5 sm:gap-1";
