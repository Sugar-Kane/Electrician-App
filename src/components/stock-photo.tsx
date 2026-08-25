"use client";

import { useRef, useState } from "react";
import { Camera, LoaderCircle, Package } from "lucide-react";

import { attachStockPhoto, createStockPhotoUpload } from "@/app/inventory/actions";
import { createClient } from "@/lib/supabase/client";

/**
 * A photo of the part, taken rather than linked.
 *
 * The field this replaces asked an electrician standing at a van for a URL.
 * Nobody has a URL for a breaker; they have the thing in their hand and a
 * camera in the other.
 *
 * The file goes from the browser straight to storage. A Server Action's request
 * body is capped around a megabyte by the framework and four and a half by the
 * platform, and a photo off a phone is three to five — posting it through an
 * action means the request is rejected before any of the careful messages below
 * could be reached.
 *
 * `capture` is deliberately absent from the input. Android reads it as "the
 * camera and nothing else", which shuts the gallery out — and half the time the
 * photo somebody wants is one they took yesterday.
 */

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,image/*";

export function StockPhoto({
  itemId,
  photoUrl,
  name,
}: {
  itemId: string;
  photoUrl: string;
  name: string;
}) {
  const [shown, setShown] = useState(photoUrl);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const picker = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setProblem("");
    setBusy(true);

    try {
      const ticket = await createStockPhotoUpload({
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!ticket.ok) {
        setProblem(ticket.error);
        return;
      }

      // Straight from the phone to storage. The token is only good for this
      // one object, so nothing else can be written with it.
      const sent = await createClient()
        .storage.from(ticket.bucket)
        .uploadToSignedUrl(ticket.path, ticket.token, file, {
          contentType: file.type || "application/octet-stream",
        });

      if (sent.error) {
        setProblem("That photo did not upload. Try again.");
        return;
      }

      const recorded = await attachStockPhoto({ itemId, path: ticket.path });
      if (recorded.error) {
        setProblem(recorded.error);
        return;
      }

      // Shown straight away from the file itself rather than waiting for a
      // signed URL to come back: the photo is already on this device.
      setShown(URL.createObjectURL(file));
    } catch {
      setProblem("That photo did not upload. Try again.");
    } finally {
      setBusy(false);
      if (picker.current) picker.current.value = "";
    }
  }

  return (
    <div className="shrink-0">
      <input
        ref={picker}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <button
        type="button"
        onClick={() => picker.current?.click()}
        disabled={busy}
        aria-label={shown ? `Replace the photo of ${name}` : `Add a photo of ${name}`}
        className="relative grid h-24 w-24 place-items-center overflow-hidden rounded-panel border border-line bg-white/5 disabled:opacity-60"
      >
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-full w-full object-cover" />
        ) : (
          <Package className="h-8 w-8 text-brand" aria-hidden />
        )}

        <span className="absolute inset-x-0 bottom-0 grid place-items-center bg-black/60 py-1 text-[10px] font-semibold text-white">
          {busy ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <span className="flex items-center gap-1">
              <Camera className="h-3 w-3" aria-hidden />
              {shown ? "Replace" : "Add photo"}
            </span>
          )}
        </span>
      </button>

      {problem ? (
        <p className="mt-2 max-w-24 text-[11px] leading-4 text-critical">{problem}</p>
      ) : null}
    </div>
  );
}
