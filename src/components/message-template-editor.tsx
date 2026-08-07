"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, LoaderCircle, MoonStar, Zap } from "lucide-react";

import {
  saveMessageTemplate,
  type TemplateActionState,
} from "@/app/settings/messages/actions";
import { renderTemplate, triggerIgnoresQuietHours } from "@/lib/message-templates";

const initialState: TemplateActionState = { error: "" };

/** Stand-ins used only for the live preview, never for a real send. */
const PREVIEW_VARIABLES = {
  customer_first_name: "Ada",
  business_name: "Pacific Plains Electric",
  business_phone: "(805) 555-0123",
  arrival_window: "Tue Aug 11, 8:00-10:00 AM",
  job_number: "1042",
  technician_name: "Nick",
};

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#ffc21c] px-4 text-sm font-bold text-[#071723] disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      Save
    </button>
  );
}

export function MessageTemplateEditor({
  trigger,
  label,
  description,
  body,
  isActive,
}: {
  trigger: string;
  label: string;
  description: string;
  body: string;
  isActive: boolean;
}) {
  const [state, formAction] = useActionState(saveMessageTemplate, initialState);
  const [draft, setDraft] = useState(body);
  const [active, setActive] = useState(isActive);

  const preview = renderTemplate(draft, PREVIEW_VARIABLES);
  const timeCritical = triggerIgnoresQuietHours(trigger);

  return (
    <form action={formAction} className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
      <input type="hidden" name="trigger" value={trigger} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">{label}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <label className="tap-target flex shrink-0 cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            name="isActive"
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            className="h-5 w-5 accent-[#ffc21c]"
          />
          On
        </label>
      </div>

      <textarea
        name="body"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value.slice(0, 1600))}
        className="mt-4 w-full resize-y rounded-2xl border border-white/10 bg-[#0d202d] p-4 text-sm leading-6 text-white outline-none focus:border-[#ffc21c]/70"
      />

      <p className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs leading-5 text-slate-300">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Preview
        </span>
        {preview || "This would send nothing."}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
          {timeCritical ? (
            <>
              <Zap className="h-3.5 w-3.5 text-[#ffc21c]" aria-hidden /> Sends during quiet hours
            </>
          ) : (
            <>
              <MoonStar className="h-3.5 w-3.5 text-indigo-300" aria-hidden /> Held during quiet hours
            </>
          )}
        </span>
        <div className="flex items-center gap-3">
          {state.saved && !state.error ? (
            <span className="flex items-center gap-1 text-xs text-emerald-300">
              <Check className="h-3.5 w-3.5" aria-hidden /> Saved
            </span>
          ) : null}
          <span className="text-[11px] text-slate-600">{draft.length}/1600</span>
          <SaveButton />
        </div>
      </div>

      {state.error ? (
        <p role="alert" className="mt-3 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-3 text-sm text-red-200">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
