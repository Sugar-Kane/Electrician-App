import type { ReactNode } from "react";
import { CheckCircle2, TriangleAlert } from "lucide-react";

/**
 * Form fields, so a text input is the same object on every page.
 *
 * Previously each form re-declared the same forty-character class string, and
 * they had drifted: different heights, two different focus colours, and hint
 * text that was sometimes above the field and sometimes below it.
 */

export const inputClass =
  "min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Sits under the control, where it is read after the thing it describes. */
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="mt-2 block">{children}</span>
      {hint ? <span className="mt-2 block text-xs leading-5 text-ink-faint">{hint}</span> : null}
    </label>
  );
}

export function TextInput(props: React.ComponentProps<"input">) {
  return <input {...props} className={`${inputClass} ${props.className ?? ""}`} />;
}

/*
 * `SelectInput` used to be here, wrapping a native `<select>`. It is now
 * `SelectField` in `select-field.tsx`, because a native select's open list on a
 * phone is drawn by the operating system and nothing on the page reaches inside
 * it. Import that instead — it takes `choices` rather than `<option>` children.
 */

/**
 * What a form says back.
 *
 * One shape for both outcomes, because a success that looks structurally
 * different from a failure is one people learn to skim past.
 */
export function FormMessage({ error, notice }: { error?: string; notice?: string }) {
  if (error) {
    return (
      <p className="mt-4 flex items-start gap-2 text-sm text-critical">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{error}</span>
      </p>
    );
  }
  if (notice) {
    return (
      <p className="mt-4 flex items-start gap-2 break-words text-sm text-positive">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{notice}</span>
      </p>
    );
  }
  return null;
}
