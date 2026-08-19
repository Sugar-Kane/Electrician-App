"use client";

import { parseChatMarkdown } from "@/lib/chat-markdown";

/**
 * A reply, with its markdown rendered rather than shown.
 *
 * The model writes bold and bullets; a bubble that printed the asterisks was
 * the version this replaced. Everything is rendered as text nodes — nothing
 * here builds HTML from what a model produced.
 *
 * Its own component because two screens show the assistant's answers now: the
 * chat, and the search box that puts the same question to it.
 */
export function ChatMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseChatMarkdown(text).map((line, lineIndex) => (
        <p key={lineIndex} className={line.bullet ? "flex gap-2" : ""}>
          {line.bullet ? <span aria-hidden>·</span> : null}
          <span>
            {line.segments.map((segment, index) =>
              segment.bold ? (
                <strong key={index} className="font-semibold">
                  {segment.text}
                </strong>
              ) : segment.code ? (
                <code key={index} className="rounded bg-white/10 px-1 text-[0.9em]">
                  {segment.text}
                </code>
              ) : (
                <span key={index}>{segment.text}</span>
              ),
            )}
          </span>
        </p>
      ))}
    </>
  );
}
