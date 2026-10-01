"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser, PenLine, Type } from "lucide-react";

import { signatureFont } from "@/components/signature-font";

/**
 * Drawing or typing a signature, inside whatever form is collecting it.
 *
 * The customer's pad on a contract and a member adopting their signature for
 * the business use this same input, so a signature drawn in either place is
 * captured and cropped the same way. It posts `method` and `image` with the
 * form it sits in; the name, the consent and the button belong to that form.
 *
 * Drawn by default because that is what a signature looks like to the person
 * giving it, with typing one tap away — both are equally valid, and typing is
 * the only way in for somebody using a keyboard or a screen reader, for whom a
 * canvas is a blank rectangle.
 */

export type SignatureValue = { method: "drawn" | "typed"; image: string };

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/** The widest a drawn signature is sent. Plenty for a line on a letter page. */
const MAX_EXPORT_WIDTH = 900;

/**
 * The drawing, cut down to the ink.
 *
 * The pad is wide and mostly empty. Exporting all of it means the signature is
 * a small scribble in a large transparent box, and scaled into a line on the
 * PDF it comes out tiny. Cropping to what was actually drawn is what lets it
 * fill the line the way a pen would.
 */
function exportInk(canvas: HTMLCanvasElement, bounds: Bounds, ratio: number): string {
  const pad = 10 * ratio;
  const x = Math.max(0, Math.floor(bounds.minX - pad));
  const y = Math.max(0, Math.floor(bounds.minY - pad));
  const width = Math.min(canvas.width, Math.ceil(bounds.maxX + pad)) - x;
  const height = Math.min(canvas.height, Math.ceil(bounds.maxY + pad)) - y;
  if (width <= 0 || height <= 0) return "";

  // Scaled down on a dense screen, so what is sent stays well inside the
  // server's size ceiling rather than depending on whose phone it was.
  const scale = Math.min(1, MAX_EXPORT_WIDTH / width);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  out.getContext("2d")?.drawImage(canvas, x, y, width, height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export function SignatureInput({
  printedName,
  onChange,
}: {
  /** Shown as the signature in Type mode, as it will be printed. */
  printedName: string;
  onChange: (value: SignatureValue) => void;
}) {
  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [image, setImage] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const bounds = useRef<Bounds | null>(null);
  const ratio = useRef(1);

  useEffect(() => {
    onChange({ method, image });
  }, [method, image, onChange]);

  // Sized once to the screen's real pixel density, so lines are crisp rather
  // than a blurred upscale of a canvas drawn at CSS pixels.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || method !== "drawn") return;
    ratio.current = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * ratio.current);
    canvas.height = Math.round(rect.height * ratio.current);
    bounds.current = null;
    setImage("");
  }, [method]);

  /** A pointer position in the canvas's own pixels, whatever its CSS size. */
  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function extend(p: { x: number; y: number }) {
    const b = bounds.current;
    bounds.current = b
      ? { minX: Math.min(b.minX, p.x), minY: Math.min(b.minY, p.y), maxX: Math.max(b.maxX, p.x), maxY: Math.max(b.maxY, p.y) }
      : { minX: p.x, minY: p.y, maxX: p.x, maxY: p.y };
  }

  function stroke(from: { x: number; y: number }, to: { x: number; y: number }) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.6 * ratio.current;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    const p = point(event);
    last.current = p;
    extend(p);
    // A tap is a dot, not nothing — the dot on an "i" is part of a signature.
    stroke(p, { x: p.x + 0.1, y: p.y + 0.1 });
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !last.current) return;
    const p = point(event);
    stroke(last.current, p);
    last.current = p;
    extend(p);
  }

  function onPointerUp() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (canvas && bounds.current) setImage(exportInk(canvas, bounds.current, ratio.current));
  }

  function clear() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    bounds.current = null;
    setImage("");
  }

  return (
    <div className="space-y-4">
      <input type="hidden" name="method" value={method} />
      <input type="hidden" name="image" value={method === "drawn" ? image : ""} />

      <div role="radiogroup" aria-label="How to sign" className="grid grid-cols-2 gap-2">
        {(
          [
            { value: "drawn", label: "Draw", Icon: PenLine },
            { value: "typed", label: "Type", Icon: Type },
          ] as const
        ).map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={method === value}
            onClick={() => setMethod(value)}
            className={`tap-target inline-flex min-h-11 items-center justify-center gap-2 rounded-control border text-sm font-semibold ${
              method === value ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-muted"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {method === "drawn" ? (
        <div>
          <div className="relative">
            {/*
              White like paper whatever the page around it, because dark ink on
              a dark background cannot be seen. The exported image is still
              transparent — the white here is only the page behind the pen.

              `touch-none` is what keeps a finger drawing rather than scrolling
              the page, which on a phone is the whole difference between a pad
              and a rectangle.
            */}
            <canvas
              ref={canvasRef}
              aria-label="Signature drawing area. If you cannot draw here, choose Type instead."
              className="block h-44 w-full touch-none rounded-control border border-line bg-white"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={onPointerUp}
            />
            {!image ? (
              <p className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-slate-400">
                Sign here with your finger
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={clear}
            disabled={!image}
            className="tap-target mt-2 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-ink-muted disabled:opacity-40"
          >
            <Eraser className="h-4 w-4" aria-hidden />
            Clear and start again
          </button>
        </div>
      ) : (
        <div className="rounded-control border border-line bg-white px-4 py-5">
          <p className={`${signatureFont.className} text-3xl leading-tight text-slate-900`}>
            {printedName || "Your name"}
          </p>
          <p className="mt-1 text-xs text-slate-500">Your typed name below will be your signature.</p>
        </div>
      )}
    </div>
  );
}
