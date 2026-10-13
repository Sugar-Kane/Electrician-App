"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A link that loads its whole page ahead of the click, but only once someone
 * is heading for it: the pointer over it, keyboard focus on it, or a finger
 * touching it.
 *
 * Every page here is `force-dynamic`, so the default prefetch stops at the
 * loading skeleton. `prefetch` on every link in view fixed that by rendering
 * each menu page, and each row of a list, in the background on every page load:
 * dozens of full server renders, each with its own database round trips,
 * competing with the page that was actually asked for. Waiting for a sign of
 * intent keeps most of the head start (a hover comes a few hundred
 * milliseconds before the click) for a fraction of the work.
 */
export function IntentLink({ onMouseEnter, onFocus, onTouchStart, ...props }: Omit<ComponentProps<typeof Link>, "prefetch">) {
  const [heading, setHeading] = useState(false);
  return (
    <Link
      {...props}
      prefetch={heading}
      onMouseEnter={(event) => {
        setHeading(true);
        onMouseEnter?.(event);
      }}
      onFocus={(event) => {
        setHeading(true);
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        setHeading(true);
        onTouchStart?.(event);
      }}
    />
  );
}
