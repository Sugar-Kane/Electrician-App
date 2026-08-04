import type { Metadata } from "next";
import Link from "next/link";
import {
  CheckCircle2,
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
import {
  buildStandardDocumentName,
  getDocumentWorkspace,
  type DocumentFolderNode,
} from "@/lib/document-workspace";

export const metadata: Metadata = {
  title: "Files | Volterra",
};

function FolderBranch({ node, depth = 0 }: { node: DocumentFolderNode; depth?: number }) {
  const hasChildren = node.children.length > 0;
  const content = (
    <div className="flex min-h-12 items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-white/[0.035]">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-[#ffc21c]">
        {hasChildren ? <FolderOpen className="h-5 w-5" aria-hidden /> : <Folder className="h-5 w-5" aria-hidden />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{node.name}</span>
        {node.type === "job" ? <span className="block text-[10px] text-slate-500">Standard job documentation</span> : null}
      </span>
      {hasChildren ? <ChevronRight className="h-4 w-4 rotate-90 text-slate-600" aria-hidden /> : null}
    </div>
  );

  if (!hasChildren) return <div style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}>{content}</div>;

  return (
    <details open={depth < 2} className="group" style={{ paddingLeft: `${Math.min(depth, 5) * 12}px` }}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">{content}</summary>
      <div className="border-l border-white/8">
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
  const [workspace, query] = await Promise.all([getDocumentWorkspace(), searchParams]);
  const connected = workspace.connection?.status === "connected";
  const connectHref =
    workspace.organizationId && workspace.googleDriveReady
      ? `/api/integrations/google-drive/connect?organization_id=${encodeURIComponent(workspace.organizationId)}`
      : "#setup";
  const namingExample = buildStandardDocumentName({
    date: "2026-08-03",
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
      active="More"
    >
      {query.connected === "google_drive" ? (
        <div className="mb-4 flex items-start gap-3 rounded-3xl border border-emerald-400/20 bg-emerald-400/[0.05] p-4 text-sm text-emerald-100">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
          Google Drive is connected and the standard folder structure was created.
        </div>
      ) : null}
      {query.drive && query.drive !== "connected" ? (
        <div className="mb-4 flex items-start gap-3 rounded-3xl border border-amber-400/20 bg-amber-400/[0.05] p-4 text-sm text-amber-100">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
          Google Drive setup did not finish. No files were exposed; reconnect when you are back at the laptop.
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">Business filing system</p>
              <h2 className="mt-1 text-xl font-semibold">{workspace.businessName}</h2>
              <p className="mt-2 text-sm text-slate-400">{countFolders(workspace.folders)} folders ready</p>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ffc21c]/10 text-[#ffc21c]">
              <FolderOpen className="h-6 w-6" aria-hidden />
            </span>
          </div>

          <div className="mt-5 rounded-3xl border border-white/8 bg-[#071823] p-2">
            {workspace.folders.map((folder) => <FolderBranch key={folder.id} node={folder} />)}
          </div>

          {workspace.source === "demo" ? (
            <p className="mt-3 text-xs leading-5 text-amber-200">Preview structure shown. The folders become live after the document migration is applied to Supabase.</p>
          ) : null}
        </section>

        <div className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-slate-500">Primary cloud mirror</p>
                <h2 className="mt-1 text-lg font-semibold">Google Drive</h2>
              </div>
              <span className={`rounded-full px-3 py-1.5 text-[10px] font-semibold ${connected ? "bg-emerald-400/10 text-emerald-300" : "bg-amber-400/10 text-amber-300"}`}>
                {connected ? "Connected" : "Ready to connect"}
              </span>
            </div>

            <div className="mt-4 rounded-2xl bg-white/[0.035] p-4">
              <div className="flex items-center gap-3">
                <Cloud className="h-5 w-5 text-[#ffc21c]" aria-hidden />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{workspace.connection?.accountEmail ?? "No Google account connected"}</p>
                  <p className="text-xs text-slate-500">{formatSyncTime(workspace.connection?.lastSyncedAt ?? null)}</p>
                </div>
              </div>
            </div>

            {connected && workspace.connection?.rootUrl ? (
              <a href={workspace.connection.rootUrl} target="_blank" rel="noreferrer" className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]">
                <FolderOpen className="h-4 w-4" aria-hidden /> Open Google Drive folder
              </a>
            ) : (
              <Link href={connectHref} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]">
                <CloudCog className="h-4 w-4" aria-hidden /> Connect Google Drive
              </Link>
            )}

            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-slate-400">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
              The app requests access only to folders and files it creates or that the user explicitly shares with it—not the entire Drive.
            </p>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/5 text-[#ffc21c]"><HardDriveUpload className="h-5 w-5" aria-hidden /></span>
              <div><p className="text-xs text-slate-500">File naming standard</p><h2 className="font-semibold">Searchable without opening it</h2></div>
            </div>
            <code className="mt-4 block break-all rounded-2xl bg-[#06131d] p-4 text-xs leading-5 text-slate-300">{namingExample}</code>
            <p className="mt-3 text-xs leading-5 text-slate-400">Date → job number → document type → short description. The original file extension is preserved.</p>
          </section>

          <section id="setup" className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
              <div>
                <h2 className="font-semibold">Connection readiness</h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {workspace.googleDriveReady
                    ? "Google credentials are configured. An owner or admin can connect the business Drive."
                    : "The Google OAuth credentials and encrypted server key still need to be added from the laptop before an owner can connect Drive."}
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-white/[0.03] p-4">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
              <p className="text-xs leading-5 text-slate-400">Refresh tokens are encrypted before storage and never sent to the phone or browser.</p>
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
            <div className="flex items-center gap-3"><RefreshCw className="h-5 w-5 text-slate-400" aria-hidden /><div><p className="text-xs text-slate-500">Additional provider</p><h2 className="font-semibold">OneDrive-compatible structure</h2></div></div>
            <p className="mt-3 text-sm leading-6 text-slate-400">The same folder and sync records support OneDrive. Google Drive is implemented first so users never maintain two competing folder trees.</p>
          </section>
        </div>
      </div>

      <section className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { icon: FileCheck2, title: "No loose estimates", text: "Estimate PDFs stay with the job that created them." },
          { icon: FileClock, title: "Version history ready", text: "Document records preserve versions and sync state." },
          { icon: ShieldCheck, title: "Business-separated", text: "Row-level rules isolate every contractor’s files." },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4">
            <Icon className="h-5 w-5 text-[#ffc21c]" aria-hidden />
            <h2 className="mt-3 text-sm font-semibold">{title}</h2>
            <p className="mt-1 text-xs leading-5 text-slate-400">{text}</p>
          </div>
        ))}
      </section>
    </FieldPageShell>
  );
}
