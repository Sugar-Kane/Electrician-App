"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, TriangleAlert } from "lucide-react";

import { acceptInvitation, type AcceptState } from "@/app/invite/[token]/actions";

const initialState: AcceptState = { error: "" };

function JoinButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target mt-6 flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-bold text-[#071723] disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {pending ? "Joining…" : "Accept and join"}
    </button>
  );
}

export function AcceptInvitationForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(acceptInvitation, initialState);

  return (
    <form action={formAction}>
      <input type="hidden" name="token" value={token} />
      {state.error ? (
        <p className="mt-4 flex items-start gap-2 text-sm text-rose-300">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      ) : null}
      <JoinButton />
    </form>
  );
}
