import type { Metadata } from "next";
import Link from "next/link";
import {
  ChevronRight,
  Cloud,
  CloudCog,
  FileCheck2,
  FileClock,
  Folder,
  FolderOpen,
  HardDriveUpload,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { todayInZone } from "@/lib/calendar";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { Banner } from "@/components/ui/banner";
import {
  buildStandardDocumentName,
  getDocumentWorkspace,
  type DocumentFolderNode,
} from "@/lib/document-workspace";

export const metadata: Metadata = {
  title: "Files | Volteira",
};

/**
 * One folder, and everything under it.
 *
 * The indent used to be `depth * 12` applied at every level, and because the
 * levels nest in the DOM it compounded: a job folder four deep carried
 * 0+12+24+36+48 = 120px before its 36px icon, which on a phone left about
 * ninety pixels for a name like "JOB-5 – 994 Red Gum Lane". The tree was then
 * wider than the screen, and since the grid it sits in lets its items grow to
 * fit their contents, it took the whole page sideways with it — which is why
 * the Connect button and the body copy were clipped too, on the other side of
 * the layout entirely.
 *
 * A flat 10px per level now, and the rail carries the hierarchy rather than
 * the whitespace. Four levels cost 40px instead of 120.
 */
function FolderBranch({ node, depth = 0 }: { node: DocumentFolderNode; depth?: number }) {
  const hasChildren = node.children.length > 0;
  const content = (
    <div className="flex min-h-12 items-center gap-2.5 rounded-control px-2 py-2 text-left hover:bg-white/[0.035] sm:gap-3 sm:px-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-chip bg-white/5 text-brand sm:h-9 sm:w-9">
        {hasChildren ? <FolderOpen className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden /> : <Folder className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{node.name}</span>
        {node.type === "job" ? <span className="block truncate text-[10px] text-ink-faint">Standard job documentation</span> : null}
      </span>
      {hasChildren ? <ChevronRight className="h-4 w-4 shrink-0 rotate-90 text-ink-faint" aria-hidden /> : null}
    </div>
  );

  if (!hasChildren) return content;

  return (
    <details open={depth < 2} className="group">
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{content}</summary>
      {/* The rail is the indent. Beyond four levels it stops growing, because
          a fifth step of whitespace costs more than it explains. */}
      <div className={`border-l border-white/8 ${depth < 4 ? "pl-2.5" : ""}`}>
        {node.children.map((child) => <FolderBranch key={child.id} node={child} depth={depth + 1} />)}
      </div>
    </details>
  );
}

function countFolders(nodes: DocumentFolderNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countFolders(node.children), 0);
}

function formatSyncTime(value: string | null) {
  if (!value) return "Not synced yet";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; drive?: string; setup?: string; job?: string }>;
}) {
  const [workspace, query, timeZone] = await Promise.all([
    getDocumentWorkspace(),
    searchParams,
    getOrganizationTimezone(),
  ]);
  const connected = workspace.connection?.status === "connected";
  const connectHref =
    workspace.organizationId && workspace.googleDriveReady
      ? `/api/integrations/google-drive/connect?organization_id=${encodeURIComponent(workspace.organizationId)}`
      : "#setup";
  const namingExample = buildStandardDocumentName({
    date: todayInZone(timeZone),
    jobNumber: query.job ?? "1045",
    customerName: "John Smith",
    documentType: "photo-before",
    description: "main-panel",
    extension: "jpg",
  });

  return (
    <FieldPageShell
      title={query.job ? `Job #${query.job} files` : "Files"}
      eyebrow="Documents and cloud sync"
      description="Files are filed by year, month, and job. Customer, property, payment status, and document type are filters in the app, not folders — so each file exists exactly once."
    >
      {query.connected === "google_drive" ? (
        <Banner tone="positive" className="mb-4">
          Google Drive is connected and the standard folder structure was created.
        </Banner>
      ) : null}
      {query.drive && query.drive !== "connected" ? (
        <div className="mb-4 flex items-start gap-3 rounded-panel border border-caution/20 bg-caution-bg p-4 text-sm text-caution">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden />
          Google Drive setup did not finish. No files were exposed; reconnect when you are back at the laptop.
        </div>
      ) : null}

      {/*
        `min-w-0` on both columns. A grid item's default min-width is `auto`,
        which means it will not shrink below the intrinsic width of its widest
        child — so the folder tree could push this whole layout wider than the
        phone, and every other card got clipped along with it. This is the line
        that keeps the page on screen.
      */}
      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <section className="min-w-0 rounded-panel border border-line bg-surface p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-ink-faint">Business filing system</p>
              <h2 className="mt-1 text-xl font-semibold">{workspace.businessName}</h2>
              <p className="mt-2 text-sm text-ink-muted">{countFolders(workspace.folders)} folders ready</p>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-control bg-brand/10 text-brand">
              <FolderOpen className="h-6 w-6" aria-hidden />
            </span>
          </div>

          <div className="mt-5 rounded-panel border border-white/8 bg-[#071823] p-2">
            {workspace.folders.map((folder) => <FolderBranch key={folder.id} node={folder} />)}
          </div>

          {workspace.source === "demo" ? (
            <p className="mt-3 text-xs leading-5 text-caution">Preview structure shown. The folders become live after the document migration is applied to Supabase.</p>
          ) : null}
        </section>

        <div className="min-w-0 space-y-4">
          <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-ink-faint">Primary cloud mirror</p>
                <h2 className="mt-1 text-lg font-semibold">Google Drive</h2>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${connected ? "bg-positive-bg text-positive" : "bg-caution-bg text-caution"}`}>
                {connected ? "Connected" : "Ready to connect"}
              </span>
            </div>

            <div className="mt-4 rounded-control bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <Cloud className="h-5 w-5 text-brand" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{workspace.connection?.accountEmail ?? "No Google account connected"}</p>
                  <p className="text-xs text-ink-faint">{formatSyncTime(workspace.connection?.lastSyncedAt ?? null)}</p>
                </div>
              </div>
            </div>

            {connected && workspace.connection?.rootUrl ? (
              <a href={workspace.connection.rootUrl} target="_blank" rel="noreferrer" className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand">
                <FolderOpen className="h-4 w-4" aria-hidden /> Open Google Drive folder
              </a>
            ) : (
              <Link href={connectHref} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand">
                <CloudCog className="h-4 w-4" aria-hidden /> Connect Google Drive
              </Link>
            )}

            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
              The app requests access only to folders and files it creates or that the user explicitly shares with it—not the entire Drive.
            </p>
          </section>

          <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-control bg-white/5 text-brand"><HardDriveUpload className="h-5 w-5" aria-hidden /></span>
              <div><p className="text-xs text-ink-faint">File naming standard</p><h2 className="font-semibold">Searchable without opening it</h2></div>
            </div>
            <code className="mt-4 block break-all rounded-control bg-canvas p-4 text-xs leading-5 text-ink-muted">{namingExample}</code>
            <p className="mt-3 text-xs leading-5 text-ink-muted">Date → job number → document type → short description. The original file extension is preserved.</p>
          </section>

          <section id="setup" className="rounded-panel border border-line bg-surface p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <h2 className="font-semibold">Connection readiness</h2>
                <p className="mt-2 text-sm leading-6 text-ink-muted">
                  {workspace.googleDriveReady
                    ? "Google credentials are configured. An owner or admin can connect the business Drive."
                    : "The Google OAuth credentials and encrypted server key still need to be added from the laptop before an owner can connect Drive."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-control bg-white/[0.03] p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
              <p className="text-xs leading-5 text-ink-muted">Refresh tokens are encrypted before storage and never sent to the phone or browser.</p>
            </div>
          </section>

        </div>
      </div>

      {/*
        Five blocks of read-once explanation used to sit open below the folder
        tree — how OneDrive would work, that estimates stay with their job,
        that versions are kept, that businesses are separated. All true, none
        of it needed twice, and on a phone it was most of the page. Folded away
        behind one line somebody can open the first time and never again.
      */}
      <details className="group mt-4 rounded-panel border border-line bg-surface">
        <summary className="tap-target flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          How filing works
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-open:rotate-90" aria-hidden />
        </summary>

        <div className="space-y-4 border-t border-line p-4">
          <div className="flex items-start gap-3">
            <RefreshCw className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">OneDrive-compatible structure</h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                The same folder and sync records support OneDrive. Google Drive is implemented
                first so users never maintain two competing folder trees.
              </p>
            </div>
          </div>

          {[
            { icon: FileCheck2, title: "No loose estimates", text: "Estimate PDFs stay with the job that created them." },
            { icon: FileClock, title: "Version history ready", text: "Document records preserve versions and sync state." },
            { icon: ShieldCheck, title: "Business-separated", text: "Row-level rules isolate every contractor’s files." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex items-start gap-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-ink-muted">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </details>
    </FieldPageShell>
  );
}
