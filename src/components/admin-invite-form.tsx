"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

import { adminInvite, type AdminInviteState } from "@/app/admin/organizations/[id]/actions";
import { SelectField } from "@/components/ui/select-field";

const initialState: AdminInviteState = { error: "" };
const inputClass =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint focus:border-brand/70";

function SendButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-13 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {pending ? "Sending…" : "Send invitation"}
    </button>
  );
}

export function AdminInviteForm({ organizationId }: { organizationId: string }) {
  const [state, formAction] = useActionState(adminInvite, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="organizationId" value={organizationId} />

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
        <label className="block">
          <span className="text-sm font-medium text-ink">Email</span>
          <input
            name="email"
            type="email"
            inputMode="email"
            required
            placeholder="them@example.com"
            className={inputClass}
          />
        </label>
        <div className="block">
          <span className="text-sm font-medium text-ink">Role</span>
          <span className="mt-2 block">
            <SelectField
              name="role"
              defaultValue="owner"
              label="Role"
              choices={[
                { value: "owner", label: "Owner" },
                { value: "admin", label: "Administrator" },
                { value: "dispatcher", label: "Dispatcher" },
                { value: "technician", label: "Technician" },
                { value: "accountant", label: "Accountant" },
              ]}
            />
          </span>
        </div>
      </div>

      {state.error ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <div className="mt-4">
          <p className="flex items-start gap-2 text-sm text-positive">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {state.notice}
          </p>
          {state.link ? (
            <p className="mt-2 break-all rounded-chip bg-black/30 p-3 text-xs text-ink-muted">
              {state.link}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <SendButton />
      </div>
    </form>
  );
}
