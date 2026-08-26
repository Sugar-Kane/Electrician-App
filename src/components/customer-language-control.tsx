"use client";

import { useActionState } from "react";
import { Languages, LoaderCircle } from "lucide-react";

import { setCustomerLanguage, type LanguageActionState } from "@/app/customers/[customerId]/actions";
import { FormMessage } from "@/components/ui/field";
import {
  describeLanguageChoice,
  SUPPORTED_LANGUAGES,
  type LanguageState,
} from "@/lib/customer-language";

/**
 * Which language this customer is written to in, and the way to overrule it.
 *
 * Two buttons rather than a dropdown. There are two languages, both fit, and a
 * dropdown costs a tap and a popover to change something a thumb could have
 * changed directly. Each is a submit button carrying its own value, so the
 * choice and the save are one press with no client state in between.
 *
 * The line underneath is the part that makes the control usable at all. Somebody
 * looking at "Spanish" cannot tell whether the app guessed it or they set it, and
 * therefore cannot tell whether changing it will stick — which is exactly the
 * doubt that makes a person stop using a setting. `describeLanguageChoice` says
 * which it is in one sentence.
 */

const initialState: LanguageActionState = { error: "" };

export function CustomerLanguageControl({
  customerId,
  language,
}: {
  customerId: string;
  language: LanguageState;
}) {
  const [state, action, pending] = useActionState(setCustomerLanguage, initialState);

  return (
    /*
     * Inside the contact card rather than a panel of its own, directly under
     * "Prefers: text". It is the same kind of fact — how this person is
     * reached — and a sixth panel on this page would push "Waiting on us"
     * further down for a setting nobody opens the page to change.
     */
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Languages className="h-4 w-4 text-ink-faint" aria-hidden />
        Messages in
      </h3>

      <form action={action} className="mt-3">
        <input type="hidden" name="customerId" value={customerId} />

        <div
          className="flex gap-2"
          role="group"
          aria-label="The language this customer is written to in"
        >
          {SUPPORTED_LANGUAGES.map((option) => {
            const current = option.value === language.language;
            return (
              <button
                key={option.value}
                type="submit"
                name="language"
                value={option.value}
                disabled={pending}
                aria-pressed={current}
                className={`tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border px-4 text-sm font-semibold disabled:opacity-60 ${
                  current
                    ? "border-brand bg-brand text-on-brand"
                    : "border-line text-ink hover:text-ink"
                }`}
              >
                {pending && !current ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : null}
                {option.label}
              </button>
            );
          })}
        </div>
      </form>

      <p className="mt-2 text-xs leading-4 text-ink-muted">
        {describeLanguageChoice(language)}
      </p>

      <div className="mt-2">
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    </div>
  );
}
