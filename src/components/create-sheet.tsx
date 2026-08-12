"use client";

import { useEffect } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  MessageCircle,
  Plus,
  ReceiptText,
  UserRoundPlus,
  X,
} from "lucide-react";

/**
 * The centre button.
 *
 * It used to open the assistant, which put AI at the spine of the product: the
 * one button always under the thumb assumed the next thing somebody wanted was
 * to type a question. The commoner intent is to write down work that has just
 * been agreed — at a customer's panel, mid-conversation.
 *
 * So the button creates, and the assistant is one of the things it offers.
 * Nothing is lost and the mental model stops being AI-first.
 */

const ACTIONS = [
  {
    label: "New customer",
    detail: "Someone to book work for later",
    href: "/jobs/new?focus=customer",
    icon: UserRoundPlus,
  },
  {
    label: "New job",
    detail: "Customer, address, and what is wrong",
    href: "/jobs/new",
    icon: CalendarPlus,
  },
  {
    label: "New invoice",
    detail: "Bill for work already done",
    href: "/invoices?new=1",
    icon: ReceiptText,
  },
  {
    label: "Ask Volteira",
    detail: "Jobs, invoices, stock, code",
    href: "/assistant",
    icon: MessageCircle,
  },
];

export function CreateSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Escape closes it, because a sheet that can only be dismissed by a small X
  // is a trap for anybody who opened it by accident with a thumb.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Create"
        // Sits above the bottom bar and clears the home indicator. A sheet whose
        // last row is under the iPhone gesture area is a row nobody can tap.
        className="absolute inset-x-0 bottom-0 rounded-t-panel border-t border-line bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" aria-hidden />

        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Create</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-target grid h-11 w-11 place-items-center rounded-control text-ink-faint"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        <ul className="space-y-1.5">
          {ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <li key={action.label}>
                <Link
                  href={action.href}
                  onClick={onClose}
                  className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line px-4 active:bg-white/5"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-brand/10">
                    <Icon className="h-5 w-5 text-brand" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{action.label}</span>
                    <span className="block truncate text-xs text-ink-muted">{action.detail}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export { Plus };
