import test from "node:test";
import assert from "node:assert/strict";

import { parseChatMarkdown, parseSegments } from "./chat-markdown.ts";

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
