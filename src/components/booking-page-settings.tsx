"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { CheckCircle2, Clock3, Globe, ImageUp, LoaderCircle, Palette, Trash2 } from "lucide-react";

import {
  checkBookingDomain,
  removeBookingDomain,
  saveBookingDomain,
  saveBrandColor,
  saveLogo,
  type BookingPageState,
} from "@/app/settings/business/booking-page-actions";
import { brandTheme, DEFAULT_BRAND } from "@/lib/branding";

/**
 * What a customer sees when they go to book.
 *
 * These three settings are the only ones in the app that change something
 * outside it, so the copy says what each one does to the customer rather than
 * what it does to a database row.
 */

const initialState: BookingPageState = { error: "" };

export type BookingDomain = {
  id: string;
  hostname: string;
  verifiedAt: string;
};

function Message({ state }: { state: BookingPageState }) {
  if (state.error) return <p className="mt-2 text-sm text-critical">{state.error}</p>;
  if (state.notice) return <p className="mt-2 text-sm text-positive">{state.notice}</p>;
  return null;
}

function LogoForm({ logo }: { logo: string }) {
  const [state, save, saving] = useActionState(saveLogo, initialState);

  return (
    <form action={save} className="rounded-control border border-line p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <ImageUp className="h-4 w-4 text-ink-muted" aria-hidden /> Logo
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        Shown at the top of your booking page instead of your name. PNG, JPG, WebP or SVG, up to
        2&nbsp;MB.
      </p>

      {logo ? (
        <span className="mt-3 inline-flex rounded-control border border-line bg-white/5 p-2">
          <Image src={logo} alt="Your current logo" width={160} height={40} unoptimized className="h-10 w-auto object-contain" />
        </span>
      ) : null}

      <input
        type="file"
        name="logo"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="mt-3 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-control file:border file:border-line file:bg-transparent file:px-3 file:text-sm file:font-semibold"
      />

      <Message state={state} />

      <button
        type="submit"
        disabled={saving}
        className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Uploading…" : "Save logo"}
      </button>
    </form>
  );
}

function ColorForm({ brandColor }: { brandColor: string }) {
  const [state, save, saving] = useActionState(saveBrandColor, initialState);
  const [colour, setColour] = useState(brandColor || DEFAULT_BRAND);

  // Computed here as well as on the server so the warning appears while
  // somebody is dragging the picker, not after they save.
  const theme = brandTheme(colour);

  return (
    <form action={save} className="rounded-control border border-line p-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Palette className="h-4 w-4 text-ink-muted" aria-hidden /> Accent colour
      </p>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        Used for buttons and highlights on your booking page.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="color"
          name="brandColor"
          value={colour}
          onChange={(event) => setColour(event.target.value)}
          aria-label="Accent colour"
          className="h-12 w-16 cursor-pointer rounded-control border border-line bg-transparent"
        />
        <span
          className="inline-flex min-h-12 items-center rounded-control px-4 text-sm font-bold"
          style={{ backgroundColor: theme.brand, color: theme.onBrand }}
        >
          Book a diagnostic
        </span>
      </div>

      {theme.ratio < 4.5 ? (
        <p className="mt-2 text-sm text-caution">
          Text on this colour is hard to read ({theme.ratio.toFixed(1)}:1, below the 4.5:1
          standard). A darker or lighter shade would be clearer.
        </p>
      ) : null}

      <Message state={state} />

      <button
        type="submit"
        disabled={saving}
        className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Save colour"}
      </button>
    </form>
  );
}

function DomainRow({ domain }: { domain: BookingDomain }) {
  const [checkState, check, checking] = useActionState(checkBookingDomain, initialState);
  const [removeState, remove, removing] = useActionState(removeBookingDomain, initialState);

  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex items-center gap-2">
        {domain.verifiedAt ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
        ) : (
          <Clock3 className="h-4 w-4 shrink-0 text-caution" aria-hidden />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{domain.hostname}</span>
          <span className="block text-xs text-ink-muted">
            {domain.verifiedAt ? "Live" : "Waiting for DNS"}
          </span>
        </span>

        <form action={remove}>
          <input type="hidden" name="domainId" value={domain.id} />
          <button
            type="submit"
            disabled={removing}
            aria-label={`Remove ${domain.hostname}`}
            className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-control border border-line text-critical disabled:opacity-60"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </form>
      </div>

      {domain.verifiedAt ? null : (
        <div className="mt-2 rounded-control bg-sunken p-3">
          <p className="text-xs leading-5 text-ink-muted">
            At your domain provider, add a <strong className="text-ink">CNAME</strong> record for{" "}
            <code className="text-ink">{domain.hostname.split(".")[0]}</code> pointing to{" "}
            <code className="text-ink">cname.vercel-dns.com</code>. It can take up to an hour.
          </p>
          <form action={check}>
            <input type="hidden" name="domainId" value={domain.id} />
            <button
              type="submit"
              disabled={checking}
              className="tap-target mt-2 inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-3 text-sm font-semibold disabled:opacity-60"
            >
              {checking ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {checking ? "Checking…" : "Check DNS"}
            </button>
          </form>
        </div>
      )}

      <Message state={checkState} />
      <Message state={removeState} />
    </li>
  );
}

function DomainForm() {
  const [state, save, saving] = useActionState(saveBookingDomain, initialState);

  return (
    <form action={save} className="mt-3">
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-muted">Add a subdomain</span>
        <input
          type="text"
          name="hostname"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="book.yourcompany.com"
          className="min-h-12 w-full rounded-control border border-line bg-transparent px-3 text-sm"
        />
      </label>

      <Message state={state} />

      <button
        type="submit"
        disabled={saving}
        className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {saving ? "Saving…" : "Add domain"}
      </button>
    </form>
  );
}

export function BookingPageSettings({
  logo,
  brandColor,
  domains,
  bookingUrl,
}: {
  logo: string;
  brandColor: string;
  domains: BookingDomain[];
  bookingUrl: string;
}) {
  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <h2 className="text-sm font-semibold">Your booking page</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        Where customers book online. Link to it from your website, or put it on your own subdomain
        so they never leave your brand.
      </p>

      {bookingUrl ? (
        <p className="mt-2 break-all text-xs text-ink-muted">
          Always available at{" "}
          <a href={bookingUrl} className="font-semibold text-brand">
            {bookingUrl}
          </a>
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <LogoForm logo={logo} />
        <ColorForm brandColor={brandColor} />
      </div>

      <div className="mt-3 rounded-control border border-line p-4">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Globe className="h-4 w-4 text-ink-muted" aria-hidden /> Your own domain
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          A subdomain of a domain you already own, like{" "}
          <code className="text-ink">book.yourcompany.com</code>. Not your main domain — that would
          replace your website.
        </p>

        {domains.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {domains.map((domain) => (
              <DomainRow key={domain.id} domain={domain} />
            ))}
          </ul>
        ) : null}

        <DomainForm />
      </div>
    </section>
  );
}
