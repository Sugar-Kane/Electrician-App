"use client";

import { useActionState, useCallback, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, PenLine } from "lucide-react";

import {
  removeContractSigner,
  saveContractSigner,
  type SignerState,
} from "@/app/settings/contract/actions";
import { SignatureInput, type SignatureValue } from "@/components/signature-input";
import { FormMessage, inputClass } from "@/components/ui/field";
import { readPrintedName } from "@/lib/contract-signing";

/**
 * The signature that goes on contracts you send, adopted once.
 *
 * Sending a contract, or handing it to a customer to sign in person, signs it
 * for the business with this before the customer sees it. Everybody who sends
 * contracts adopts their own, here, with the same pad customers sign on.
 */

export type SavedSigner = {
  name: string;
  title: string;
  method: "drawn" | "typed";
  image: string;
  adoptedLabel: string;
};

const initialState: SignerState = { error: "" };

function SaveButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={!ready || pending}
      className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-50"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
      {pending ? "Saving…" : "Save my signature"}
    </button>
  );
}

export function ContractSignerSection({
  saved,
  defaultName,
  businessName,
}: {
  saved: SavedSigner | null;
  defaultName: string;
  businessName: string;
}) {
  // Replacing a saved signature opens the form; with none saved it is open.
  const [replacing, setReplacing] = useState(false);
  const [name, setName] = useState(saved?.name ?? defaultName);
  const [title, setTitle] = useState(saved?.title ?? "");
  const [consent, setConsent] = useState(false);
  const [signature, setSignature] = useState<SignatureValue>({ method: "drawn", image: "" });
  const onSignatureChange = useCallback((value: SignatureValue) => setSignature(value), []);

  // One state for both buttons, so the message on screen is always about the
  // last thing somebody did rather than whichever action happened to run first.
  const [state, act] = useActionState(async (previous: SignerState, formData: FormData) => {
    const result =
      formData.get("intent") === "remove"
        ? await removeContractSigner(previous)
        : await saveContractSigner(previous, formData);
    if (!result.error) {
      setReplacing(false);
      setConsent(false);
    }
    return result;
  }, initialState);

  const printed = readPrintedName(name);
  const ready = consent && Boolean(printed) && (signature.method === "typed" || Boolean(signature.image));
  const showForm = replacing || !saved;
  const business = businessName || "this business";

  return (
    <section id="signature" className="scroll-mt-24 rounded-panel border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold">Your signature</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        When you send a contract, or hand it to a customer to sign in person, it is signed for{" "}
        {business} with this first. Everyone who sends contracts saves their own.
      </p>

      {saved && !showForm ? (
        <div className="mt-4">
          <div className="rounded-control border border-line bg-white px-4 pb-3 pt-4 text-slate-900">
            <div className="flex h-16 items-end">
              {saved.method === "drawn" && saved.image ? (
                // A data URI from the pad: there is nothing for next/image to
                // fetch. The height is inline because globals.css's unlayered
                // `img { height: auto }` beats a height class.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={saved.image}
                  alt={`Your signature, ${saved.name}`}
                  style={{ height: "3.5rem" }}
                  className="w-auto max-w-full object-contain object-left-bottom"
                />
              ) : (
                <span className="mb-1 font-serif text-3xl italic leading-none">{saved.name}</span>
              )}
            </div>
            <p className="border-t border-slate-900 pt-1 text-sm">
              {saved.title ? `${saved.name}, ${saved.title}` : saved.name}
            </p>
          </div>
          <p className="mt-2 text-xs text-ink-faint">Adopted {saved.adoptedLabel}</p>

          <div className="mt-3 flex flex-wrap items-center gap-x-6">
            <button
              type="button"
              onClick={() => setReplacing(true)}
              className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-brand"
            >
              Replace it
            </button>
            <form action={act}>
              <input type="hidden" name="intent" value="remove" />
              <button type="submit" className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted">
                Remove it
              </button>
            </form>
          </div>
        </div>
      ) : (
        <form action={act} className="mt-4 space-y-4">
          <input type="hidden" name="intent" value="save" />
          <SignatureInput printedName={printed} onChange={onSignatureChange} />

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold">Your full name</span>
              <input
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="name"
                required
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold">Title (optional)</span>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Owner"
                maxLength={80}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>

          <label className="flex min-h-11 items-start gap-3 text-sm leading-6">
            <input
              type="checkbox"
              name="consent"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-1 h-5 w-5 shrink-0"
            />
            <span>
              I adopt this as my signature. Contracts I send for {business} will be signed with it,
              and it counts the same as signing them by hand.
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <SaveButton ready={ready} />
            {saved ? (
              <button
                type="button"
                onClick={() => setReplacing(false)}
                className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted"
              >
                Keep the one I have
              </button>
            ) : null}
          </div>
        </form>
      )}

      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    </section>
  );
}
