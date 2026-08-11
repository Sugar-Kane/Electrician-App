"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

/**
 * One button, in four voices.
 *
 * Buttons were previously written inline everywhere, so the same action could
 * be a yellow pill on one page and a bordered ghost on the next, at four
 * different heights. Height in particular is not cosmetic here: this is used
 * one-handed, outdoors, and anything under 44px is a target people miss.
 */

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand text-on-brand font-bold hover:bg-brand-strong",
  secondary: "border border-line bg-raised text-ink font-semibold hover:border-line-strong",
  ghost: "text-ink-muted font-semibold hover:bg-raised hover:text-ink",
  danger: "border border-critical/30 bg-critical-bg text-critical font-semibold hover:bg-critical/15",
};

const SIZES: Record<Size, string> = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-14 px-5 text-sm",
};

function classes(variant: Variant, size: Size, block: boolean, extra: string) {
  return [
    "tap-target inline-flex items-center justify-center gap-2 rounded-control transition",
    "disabled:cursor-not-allowed disabled:opacity-60",
    VARIANTS[variant],
    SIZES[size],
    block ? "w-full" : "",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  ...props
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  block?: boolean;
} & ComponentProps<"button">) {
  return (
    <button {...props} className={classes(variant, size, block, className)}>
      {children}
    </button>
  );
}

/** The same thing, when it navigates rather than acts. */
export function ButtonLink({
  children,
  href,
  variant = "primary",
  size = "md",
  block = false,
  className = "",
  ...props
}: {
  children: ReactNode;
  href: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
} & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  return (
    <Link {...props} href={href} className={classes(variant, size, block, className)}>
      {children}
    </Link>
  );
}

/**
 * A submit button that knows its form is in flight.
 *
 * Every server-action form in the app had its own copy of this, each with a
 * different spinner and a different disabled style, and a couple had none at
 * all — so a slow save looked like a button that did nothing.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "lg",
  block = true,
  className = "",
}: {
  children: ReactNode;
  pendingLabel: string;
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={classes(variant, size, block, className)}
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
}
