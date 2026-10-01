/**
 * Turning speech into text somebody may already be part-way through typing.
 *
 * Both halves of this are easy to get subtly wrong, and both were wrong in the
 * one place the app dictated before:
 *
 * A continuous recogniser hands back *every* result of the session on every
 * event, not just the new one. Reading the whole list each time and appending it
 * to the box means the second sentence arrives with the first one stapled to the
 * front of it — say two things and the note reads "check the panel check the
 * panel breaker is warm". So the caller tracks how much it has already read and
 * asks only for what came after.
 *
 * And dictated words have to join what is already there without eating it. The
 * previous version trimmed the existing text before appending, which quietly
 * destroyed a deliberate blank line every time somebody added a sentence by
 * voice.
 *
 * Import-free so all of it can be tested without a microphone.
 */

/** One alternative of one result: what the recogniser thinks it heard. */
type Alternative = { transcript: string };

/**
 * The words heard after the ones already read.
 *
 * `from` is a count of results consumed, not an index into anything the browser
 * owns — the caller keeps it, so this cannot double-read even on a browser that
 * numbers its events differently.
 */
export function spokenSince(results: ArrayLike<ArrayLike<Alternative>>, from: number): string {
  const pieces: string[] = [];

  for (let index = Math.max(0, from); index < results.length; index += 1) {
    // Only the first alternative. The rest are the recogniser's second guesses,
    // and stacking them produces the same sentence three times over.
    const heard = (results[index]?.[0]?.transcript ?? "").trim();
    if (heard) pieces.push(heard);
  }

  return pieces.join(" ");
}

/**
 * How dictated words join text that is already in the box.
 *
 * Exactly one space between what was typed and what was said, and whatever was
 * typed is left alone otherwise — including trailing newlines, which are
 * somebody's paragraph break and not whitespace to be tidied away.
 */
export function joinSpoken(current: string, spoken: string): string {
  const words = spoken.trim();
  if (!words) return current;
  if (!current) return words;

  return /\s$/.test(current) ? `${current}${words}` : `${current} ${words}`;
}

/**
 * What to say when the recogniser stops with an error, or "" to say nothing.
 *
 * Not every browser that has the API has a working recogniser behind it. Chrome and Edge send speech to Google and Microsoft; Safari uses the
 * phone's own Dictation, which can be switched off in Settings; some Chromium
 * browsers have the API and nothing behind it at all, and fail every time
 * with "network". Before, all of those looked the same: tap, and nothing.
 *
 * The keyboard's own microphone works in every one of them, so that is where
 * each message ends up.
 */
export function problemFor(error: string | undefined): string {
  switch (error) {
    case "not-allowed":
      return "This browser is not allowed to use the microphone. Turn it on for this site in your browser settings, then tap the microphone again.";
    case "service-not-allowed":
      return "Dictation is switched off on this device. On an iPhone, turn on Dictation in Settings › General › Keyboard — or use the microphone on your keyboard.";
    case "network":
      return "This browser could not reach its speech service. Check your connection, or use the microphone on your keyboard instead.";
    case "audio-capture":
      return "No microphone was found. Connect one, or type instead.";
    case "language-not-supported":
      return "This browser cannot dictate in English. Use the microphone on your keyboard instead.";
    default:
      // "no-speech" and "aborted": a pause, or a stop. Tapping again is the answer.
      return "";
  }
}
