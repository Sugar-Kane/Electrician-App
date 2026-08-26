/**
 * Serialising structured data into a `<script>` element, safely.
 *
 * `JSON.stringify` escapes quotes and backslashes and leaves `<` alone. Inside
 * a `<script>` element the parser is not reading JSON, it is looking for the
 * closing tag, so the sequence `</script>` anywhere in a string ends the
 * element early and everything after it becomes markup the browser runs.
 *
 * Every field that reaches this is model-written, and the model's input
 * includes text a customer typed into a text message. That is a path from an
 * inbound SMS to script execution in a stranger's browser on a public page, and
 * escaping `<` closes it. `&` and the line separators go too: the first stops
 * an entity being reassembled, the last two are literal newlines to a
 * JavaScript parser but not to JSON.
 *
 * The separators are written as escapes rather than as themselves. Pasted in
 * literally they are line terminators, and every tool between here and the file
 * is entitled to treat them as such: this exact line has been broken twice by
 * being written the obvious way.
 *
 * Its own module rather than a private helper inside the component, so the
 * escaping can be tested without rendering React.
 */
export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
