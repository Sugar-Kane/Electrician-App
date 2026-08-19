"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  BriefcaseBusiness,
  ChevronRight,
  LoaderCircle,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";

import { chatAction, type ChatState } from "@/app/assistant/agent-actions";
import { searchCustomers, type CustomerMatch } from "@/app/search/actions";
import { ChatMarkdown } from "@/components/ui/chat-markdown";
import { looksLikeAQuestion } from "@/lib/customer-search";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * One box for finding things and for asking about them.
 *
 * There used to be a search page with a button and an assistant on another
 * screen, and the first thing anybody had to decide was which of the two they
 * wanted. They are the same intent — "get me to the thing I am thinking about"
 * — so this is one control that does both.
 *
 * The split between them is where the cost is. **Matches appear as you type**:
 * customers and jobs, out of the database, on a short debounce, because the
 * answer to "John" is a list and waiting for a button to see it is the
 * complaint this replaces. **The assistant answers on Enter**, because a model
 * call per keystroke is expensive, slow and mostly answers half-typed
 * questions. When what somebody typed reads like a question rather than a name,
 * the box says so and offers the assistant with a keystroke.
 *
 * Nothing here can change anything: the assistant reads, and the results are
 * links.
 */

const initialChat: ChatState = { turns: [], error: "" };

/** Long enough that a fast typist makes one request, short enough to feel live. */
const DEBOUNCE_MS = 180;

/** Below two characters every customer matches, which is not an answer. */
const MINIMUM_QUERY = 2;

export function SearchConsole({ jobs }: { jobs: PilotJob[] }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<CustomerMatch[]>([]);
  const [searching, startSearching] = useTransition();
  const [chat, ask, asking] = useActionState(chatAction, initialChat);

  /*
   * Each search carries the number of the keystroke that started it, and a
   * reply is only used if nothing newer has been asked for. Without this a slow
   * request for "Jo" can land after a fast one for "John Smith" and replace the
   * right answer with an older, wronger one — a race that shows up exactly when
   * the network is bad and never on a developer's machine.
   */
  const generation = useRef(0);

  useEffect(() => {
    const typed = query.trim();
    // Nothing to ask for yet, and nothing to clear either: whether matches are
    // shown is derived from the query below, so the effect never has to reach
    // back and empty the list it filled.
    if (typed.length < MINIMUM_QUERY) return;

    const mine = ++generation.current;
    const timer = setTimeout(() => {
      startSearching(async () => {
        const found = await searchCustomers(typed);
        if (generation.current === mine) setMatches(found);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const needle = query.trim().toLowerCase();
  // Derived rather than stored, so deleting back to one letter hides the list
  // immediately instead of waiting for a request that is not going to be sent.
  const customerMatches = needle.length >= MINIMUM_QUERY ? matches : [];
  const jobMatches = needle
    ? jobs
        .filter((job) =>
          `${job.customer} ${job.contactName} ${job.id} ${job.address} ${job.city} ${job.workType}`
            .toLowerCase()
            .includes(needle),
        )
        .slice(0, 6)
    : [];

  const question = looksLikeAQuestion(query);
  const answered = chat.turns.length > 0;
  const nothing =
    needle.length >= MINIMUM_QUERY && customerMatches.length === 0 && jobMatches.length === 0;

  return (
    <div className="space-y-3">
      <form action={ask} className="rounded-panel border border-line bg-surface p-3 sm:p-4">
        <label className="flex min-h-13 items-center gap-3 rounded-control border border-line bg-raised px-3">
          <Search className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
          <span className="sr-only">Search customers and jobs, or ask a question</span>
          <input
            name="question"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
            autoComplete="off"
            enterKeyHint="search"
            placeholder="Name, number, address — or ask a question"
            className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-ink-faint"
          />
          {searching ? (
            <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-ink-faint" aria-hidden />
          ) : null}
        </label>

        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] leading-4 text-ink-faint">
            {question
              ? "That reads like a question — press Ask and Volteira will answer it."
              : "Matches appear as you type. Press Ask to put the same words to Volteira."}
          </p>
          <button
            type="submit"
            disabled={asking || query.trim().length === 0}
            className={`tap-target inline-flex min-h-11 shrink-0 items-center gap-2 rounded-control px-3 text-sm font-semibold disabled:opacity-50 ${
              question ? "bg-brand text-on-brand" : "border border-line text-ink"
            }`}
          >
            {asking ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Sparkles className="h-4 w-4" aria-hidden />
            )}
            Ask
          </button>
        </div>
      </form>

      {chat.error ? (
        <p className="rounded-control border border-critical/40 bg-critical-bg px-3 py-2 text-sm text-critical">
          {chat.error}
        </p>
      ) : null}

      {answered ? (
        <section className="rounded-panel border border-brand/40 bg-brand/[0.06] p-3 sm:p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden />
            Volteira
          </h2>
          <div className="mt-2 space-y-3">
            {chat.turns.slice(-2).map((turn, index) => (
              <div key={`${turn.role}-${index}`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                  {turn.role === "user" ? "You asked" : "Answer"}
                </p>
                <div className="mt-1 text-sm leading-6 text-ink">
                  {turn.role === "user" ? turn.text : <ChatMarkdown text={turn.text} />}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {customerMatches.length > 0 ? (
        <section className="overflow-hidden rounded-panel border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Customers
          </h2>
          <ul>
            {customerMatches.map((customer) => (
              <li key={customer.id}>
                <Link
                  href={`/customers/${customer.id}`}
                  className="tap-row flex min-h-[74px] items-center gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0 active:bg-white/5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand/10 text-brand">
                    <UserRound className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{customer.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {[customer.address, customer.phone].filter(Boolean).join(" · ") ||
                        customer.email ||
                        "No address or number on file"}
                    </span>
                    {customer.status ? (
                      <span className="mt-0.5 block truncate text-[10px] text-brand">
                        {customer.status}
                      </span>
                    ) : null}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {jobMatches.length > 0 ? (
        <section className="overflow-hidden rounded-panel border border-line bg-surface">
          <h2 className="border-b border-line px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
            Jobs
          </h2>
          <ul>
            {jobMatches.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  className="tap-row flex min-h-[74px] items-center gap-3 border-t border-white/[0.06] px-4 py-3 first:border-t-0 active:bg-white/5"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5">
                    <BriefcaseBusiness className="h-5 w-5 text-brand" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {job.customer} · #{job.id}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {job.workType} · {job.dateLabel || job.date}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-ink-faint">
                      {job.address}
                      {job.city ? `, ${job.city}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Said rather than left blank, and it does not offer to create anybody:
        a customer who cannot be found by name, number or address is far more
        often a spelling than a stranger, and "no matches, add customer" is the
        button that fills a database with the same person three times.
      */}
      {nothing && !searching ? (
        <p className="rounded-panel border border-dashed border-line p-6 text-center text-sm leading-6 text-ink-muted">
          Nothing matches “{query.trim()}”. Try part of a phone number, or the street name.
        </p>
      ) : null}
    </div>
  );
}
