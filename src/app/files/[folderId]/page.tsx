import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, Folder } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { FolderFiles } from "@/components/folder-files";
import { getFolderContents } from "@/lib/document-workspace";

export const metadata: Metadata = { title: "Files | Volteira" };
export const dynamic = "force-dynamic";

/**
 * Inside a folder.
 *
 * The files page has drawn a folder tree since it was built and never listed a
 * single file — there was no route into a folder at all, so every invoice PDF,
 * permit and job photo the app filed was reachable only from the screen that
 * made it. This is the way in.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>;
}) {
  const { folderId } = await params;
  const { trail, folders, files } = await getFolderContents(folderId);

  // An empty trail means the folder is not this business's, or does not exist.
  // Both are "not found" from here; which one it is is not the caller's
  // business to learn.
  if (trail.length === 0) notFound();

  const here = trail[trail.length - 1]!;
  const parent = trail.length > 1 ? trail[trail.length - 2] : null;

  return (
    <FieldPageShell
      title={here.name}
      eyebrow="Files"
      backHref={parent ? `/files/${parent.id}` : "/files"}
    >
      <nav aria-label="Where you are" className="mb-3 flex flex-wrap items-center gap-1 px-1">
        <Link href="/files" prefetch className="text-xs text-ink-muted hover:text-ink">
          Files
        </Link>
        {trail.map((step, index) => (
          <span key={step.id} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
            {index === trail.length - 1 ? (
              <span className="text-xs font-semibold text-ink">{step.name}</span>
            ) : (
              <Link
                href={`/files/${step.id}`}
                prefetch
                className="text-xs text-ink-muted hover:text-ink"
              >
                {step.name}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {folders.length > 0 ? (
        <ul className="mb-3 grid gap-2 sm:grid-cols-2">
          {folders.map((folder) => (
            <li key={folder.id}>
              <Link
                href={`/files/${folder.id}`}
                prefetch
                className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line bg-surface px-3"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                  <Folder className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{folder.name}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      <FolderFiles files={files} hasFolders={folders.length > 0} />
    </FieldPageShell>
  );
}
