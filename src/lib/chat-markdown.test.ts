import test from "node:test";
import assert from "node:assert/strict";

import { headingOf, parseChatMarkdown, parseSegments } from "./chat-markdown.ts";

test("bold is emphasis, not asterisks on the screen", () => {
  // What the screenshot showed: **#5** rendered with its asterisks visible.
  assert.deepEqual(parseSegments("**#5** — Adam, Nipomo"), [
    { text: "#5", bold: true },
    { text: " — Adam, Nipomo" },
  ]);
});

test("inline code is marked", () => {
  assert.deepEqual(parseSegments("set `NEXT_PUBLIC_X` first"), [
    { text: "set " },
    { text: "NEXT_PUBLIC_X", code: true },
    { text: " first" },
  ]);
});

test("plain text comes back as one segment", () => {
  assert.deepEqual(parseSegments("One job tomorrow"), [{ text: "One job tomorrow" }]);
  assert.deepEqual(parseSegments(""), [{ text: "" }]);
});

test("an unclosed marker is left exactly as written", () => {
  // Degrading to plain text is right. Swallowing the rest of the line because
  // a model produced a stray asterisk would lose the answer.
  assert.deepEqual(parseSegments("2 ** 3 is eight"), [{ text: "2 ** 3 is eight" }]);
  assert.deepEqual(parseSegments("**unclosed"), [{ text: "**unclosed" }]);
});

test("bold does not run across a line", () => {
  const lines = parseChatMarkdown("**one\ntwo**");
  assert.deepEqual(lines[0]!.segments, [{ text: "**one" }]);
  assert.deepEqual(lines[1]!.segments, [{ text: "two**" }]);
});

test("bullets are recognised and the marker removed", () => {
  const lines = parseChatMarkdown("- first\n* second\n• third\nnot a bullet");

  assert.equal(lines[0]!.bullet, true);
  assert.deepEqual(lines[0]!.segments, [{ text: "first" }]);
  assert.equal(lines[1]!.bullet, true);
  assert.equal(lines[2]!.bullet, true);
  assert.equal(lines[3]!.bullet, false);
  assert.deepEqual(lines[3]!.segments, [{ text: "not a bullet" }]);
});

test("blank lines survive, so paragraphs stay apart", () => {
  const lines = parseChatMarkdown("one\n\ntwo");
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[1]!.segments, [{ text: "" }]);
});

test("markup inside a bullet still parses", () => {
  const [line] = parseChatMarkdown("- **#5** Adam");
  assert.equal(line!.bullet, true);
  assert.deepEqual(line!.segments, [{ text: "#5", bold: true }, { text: " Adam" }]);
});

/*
 * Section headings, from the first post this actually published.
 *
 * The three strings below are the real headings out of the dryer post on
 * volteira.com, which rendered as `<p><strong>` and left a 700 word article
 * with no outline between its title and the takeaway block.
 */
const heading = (block: string) => headingOf(parseChatMarkdown(block));

test("a lone bold line is a section heading", () => {
  assert.equal(heading("**A breaker is a measuring device**"), "A breaker is a measuring device");
  assert.equal(heading("**What we check, and why in that order**"), "What we check, and why in that order");
  assert.equal(heading("**What you can look at tonight**"), "What you can look at tonight");
});

test("prose that merely contains bold is not a heading", () => {
  // The paragraph this rule most has to leave alone: bold inside a sentence.
  assert.equal(heading("The breaker's job is to watch **how much current** is flowing."), "");

  // Bold, one line, but punctuated as a sentence rather than titled as a head.
  assert.equal(heading("**It almost never is.**"), "");

  // Two lines. A heading is one.
  assert.equal(heading("**A breaker is a measuring device**\nand here is why"), "");

  // A bulleted line, even a fully bold one.
  assert.equal(heading("- **Check the vent duct**"), "");

  // Long enough to be a sentence someone emphasised, not a section title.
  assert.equal(
    heading(
      "**Every reset is you telling a safety device to ignore what it just measured, which is not a plan**",
    ),
    "",
  );

  assert.equal(heading(""), "");
  assert.equal(heading("Plain text"), "");
});
