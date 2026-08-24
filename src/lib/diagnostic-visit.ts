/**
 * What a diagnostic visit costs and how long it takes, when nothing says.
 *
 * The real answer lives in `service_settings` per business, and every prompt,
 * booking page and confirmation reads it from there. These are only the
 * fallback for a business with no settings row — a state that should not exist,
 * and used to quote three different figures depending on which code path you
 * reached it through, including a free one.
 *
 * They are here, named, so that changing the house price is one edit rather
 * than a search for a four-digit number. The matching column defaults are moved
 * in `20260824121000_diagnostic_fee_and_length.sql`; if you change one, change
 * the other.
 *
 * Import-free, so it can be read from the server, the browser and a test.
 */

/** $180. */
export const DEFAULT_DIAGNOSTIC_FEE_CENTS = 18_000;

/** Two hours on site. */
export const DEFAULT_DIAGNOSTIC_MINUTES = 120;
