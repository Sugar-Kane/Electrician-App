import Link from "next/link";
import { GraduationCap } from "lucide-react";

import { JournalDiagram } from "@/components/journal-diagram";
import { parseChatMarkdown } from "@/lib/chat-markdown";
import type { JournalPost } from "@/lib/journal-data";

/**
 * One post, as a stranger reads it.
 *
 * Rendered on both addresses from this one component, so the version a
 * homeowner lands on from a search result cannot differ from the version on the
 * business's own domain. The same reason `book/by-host` delegates to the slug
 * page rather than copying it.
 *
 * The body goes through `parseChatMarkdown`, which the chat bubbles already
 * use. It handles the small amount of markup a model actually writes — bold,
 * inline code, bullet lines — and leaves everything else as plain text. A real
 * markdown parser here would be a dependency and an injection surface for text
 * a model produced from a customer's own words, to render three constructs.
 */

function Prose({ text }: { text: string }) {
  // Blank lines are paragraph breaks, which is how the model was asked to write
  // and how somebody typing into a box separates thoughts.
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim().length > 0);

  return (
    <>
      {paragraphs.map((block, index) => {
        const lines = parseChatMarkdown(block);
        const bulleted = lines.every((line) => line.bullet);

        if (bulleted) {
          return (
            <ul key={index} className="my-4 list-disc space-y-1.5 pl-5">
              {lines.map((line, row) => (
                <li key={row} className="text-[15px] leading-7 text-ink">
                  {line.segments.map((segment, part) =>
                    segment.bold ? (
                      <strong key={part} className="font-semibold">{segment.text}</strong>
                    ) : segment.code ? (
                      <code key={part} className="rounded bg-white/5 px-1 py-0.5 text-sm">{segment.text}</code>
                    ) : (
                      <span key={part}>{segment.text}</span>
                    ),
                  )}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p key={index} className="my-4 text-[15px] leading-7 text-ink">
            {lines.map((line, row) => (
              <span key={row}>
                {row > 0 ? <br /> : null}
                {line.segments.map((segment, part) =>
                  segment.bold ? (
                    <strong key={part} className="font-semibold">{segment.text}</strong>
                  ) : segment.code ? (
                    <code key={part} className="rounded bg-white/5 px-1 py-0.5 text-sm">{segment.text}</code>
                  ) : (
                    <span key={part}>{segment.text}</span>
                  ),
                )}
              </span>
            ))}
          </p>
        );
      })}
    </>
  );
}

function published(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function JournalArticle({
  post,
  /** Where "more from this journal" points, which differs per hostname. */
  indexHref,
  /** The booking page, for the one call to action at the end. */
  bookHref,
}: {
  post: JournalPost;
  indexHref: string;
  bookHref: string;
}) {
  const where = [post.town, post.state].filter(Boolean).join(", ");

  return (
    /*
     * `id="main-content"` because the root layout renders a "Skip to content"
     * link pointing at it. Every shell inside the app provides one; these public
     * pages did not, so the skip link landed nowhere on exactly the pages a
     * stranger using a keyboard or a screen reader is most likely to arrive on.
     */
    <article
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12"
    >
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {[published(post.publishedAt), where].filter(Boolean).join(" · ")}
        </p>
        <h1 className="mt-2 text-balance text-2xl font-bold leading-tight text-ink sm:text-3xl">
          {post.title}
        </h1>
        {post.dek ? (
          <p className="mt-3 text-pretty text-base leading-7 text-ink-muted">{post.dek}</p>
        ) : null}
      </header>

      <div className="mt-6">
        <Prose text={post.body} />
      </div>

      {post.diagram ? (
        <JournalDiagram
          diagram={post.diagram}
          labels={post.diagramLabels}
          caption={post.diagramCaption}
        />
      ) : null}

      {/*
        The lesson gets its own block rather than being paragraph six.

        It is the part somebody came for and the part they might come back for,
        and burying the takeaway inside the prose is how a post gets skimmed and
        closed. Held in its own column in the database for the same reason.
      */}
      {post.lesson ? (
        <section className="mt-8 rounded-panel border border-brand/25 bg-brand/[0.06] p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em] text-brand">
            <GraduationCap className="h-4 w-4" aria-hidden />
            What to take away
          </h2>
          <div className="mt-1 [&_p]:my-2 [&_p]:text-[15px]">
            <Prose text={post.lesson} />
          </div>
        </section>
      ) : null}

      <footer className="mt-10 border-t border-line pt-6">
        <p className="text-sm leading-6 text-ink-muted">
          {post.businessName} are electricians in {post.baseCity}
          {post.baseState ? `, ${post.baseState}` : ""}. If this is happening in your house and you
          would rather somebody looked at it, we can come out.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={bookHref}
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control bg-brand px-5 text-sm font-bold text-on-brand"
          >
            Book a visit
          </Link>
          <Link
            href={indexHref}
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-5 text-sm font-semibold text-ink"
          >
            More from the journal
          </Link>
        </div>
      </footer>
    </article>
  );
}

/**
 * The list, on either hostname.
 *
 * Deliberately plain. Somebody who has read one post and wants another is
 * scanning titles, and a grid of cards with excerpts is more to read rather
 * than less.
 */
export function JournalIndex({
  businessName,
  city,
  state,
  posts,
  hrefFor,
}: {
  businessName: string;
  city: string;
  state: string;
  posts: { slug: string; title: string; dek: string; publishedAt: string }[];
  hrefFor: (slug: string) => string;
}) {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-12"
    >
      <header>
        <h1 className="text-2xl font-bold text-ink sm:text-3xl">Work journal</h1>
        <p className="mt-2 text-base leading-7 text-ink-muted">
          Things we get called out for around {city}
          {state ? `, ${state}` : ""}, and what is usually going on. Written by {businessName}.
        </p>
      </header>

      {posts.length === 0 ? (
        <p className="mt-8 rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
          Nothing here yet. Posts turn up as jobs are finished.
        </p>
      ) : (
        <ul className="mt-8 space-y-1">
          {posts.map((post) => (
            <li key={post.slug}>
              <Link
                href={hrefFor(post.slug)}
                className="block rounded-control px-3 py-4 hover:bg-white/5"
              >
                <span className="block text-lg font-semibold leading-snug text-ink">
                  {post.title}
                </span>
                {post.dek ? (
                  <span className="mt-1 block text-sm leading-6 text-ink-muted">{post.dek}</span>
                ) : null}
                <span className="mt-1.5 block text-xs text-ink-faint">
                  {published(post.publishedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
