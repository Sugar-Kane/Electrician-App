"use client";

import { useActionState, useCallback, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";

import { signContract } from "@/app/contract/[token]/actions";
import { SignatureInput, type SignatureValue } from "@/components/signature-input";
import { readPrintedName } from "@/lib/contract-signing";

/**
 * Where a customer signs, on whatever phone is in their hand.
 *
 * Shared by the texted link and the in-person sheet, so a signature taken at
 * the door and one taken from a text are the same thing recorded the same way.
 * The drawing itself is `SignatureInput`, which the business's own signature
 * is adopted with too.
 */

function SubmitButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!ready || pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-50"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending ? "Signing…" : "Sign contract"}
    </button>
  );
}

export function SignaturePad({
  token,
  defaultName,
  onSigned,
}: {
  /**
   * The contract's public token, which is the whole of the signing authority.
   *
   * Taken rather than an action, so both ways in — the texted link and the
   * in-person sheet — are bound to the one signing action here and cannot be
   * handed a different one.
   */
  token: string;
  /** Pre-filled for convenience; the signer can and should correct it. */
  defaultName: string;
  onSigned?: () => void;
}) {
  const [state, formAction] = useActionState(signContract.bind(null, token), { error: "" });
  const [name, setName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState<SignatureValue>({ method: "drawn", image: "" });
  const onSignatureChange = useCallback((value: SignatureValue) => setSignature(value), []);

  useEffect(() => {
    if (state.signed) onSigned?.();
  }, [state.signed, onSigned]);

  const printed = readPrintedName(name);
  const ready = consent && Boolean(printed) && (signature.method === "typed" || Boolean(signature.image));

  return (
    <form action={formAction} className="space-y-4">
      <SignatureInput printedName={printed} onChange={onSignatureChange} />

      <label className="block">
        <span className="text-sm font-semibold">Your full name</span>
        <input
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
          required
          className="mt-1 block min-h-11 w-full rounded-control border border-line bg-transparent px-3 text-base"
        />
      </label>

      <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
        <input
          type="checkbox"
          name="consent"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-1 h-5 w-5 shrink-0"
        />
        <span>
          I agree to sign this contract electronically, and that my electronic signature counts the
          same as signing it by hand.
        </span>
      </label>

      {state.error ? (
        <p role="alert" className="rounded-control bg-caution-bg px-3 py-2 text-sm text-caution">
          {state.error}
        </p>
      ) : null}

      <SubmitButton ready={ready} />
    </form>
  );
}
