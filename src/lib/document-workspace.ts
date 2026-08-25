import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type DocumentFolderNode = {
  id: string;
  folderKey: string;
  name: string;
  type: "root" | "system" | "year" | "month" | "job" | "custom";
  children: DocumentFolderNode[];
};

export type DocumentConnection = {
  provider: "google_drive" | "onedrive";
  status: "connecting" | "connected" | "error" | "revoked";
  accountEmail: string | null;
  rootUrl: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
};

export type DocumentWorkspace = {
  source: "demo" | "supabase";
  organizationId: string | null;
  businessName: string;
  folders: DocumentFolderNode[];
  connection: DocumentConnection | null;
  googleDriveReady: boolean;
};

type BlueprintNode = {
  key: string;
  name: string;
  type?: DocumentFolderNode["type"];
  children?: BlueprintNode[];
};

/**
 * The Drive mirror is deliberately shallow: Jobs -> Year -> Month -> Job.
 *
 * It is NOT organised by customer or property, and job folders have no
 * document-type subfolders. Two reasons:
 *
 *  - Repeat customers would fragment across months and years under a customer
 *    tree, and every job would multiply into a dozen near-empty category
 *    folders.
 *  - Customer, property, payment status, and document type are app concerns.
 *    They are filters over the database, not physical directories. A file
 *    exists exactly once; paying an invoice changes metadata, never location.
 *
 * The customer name and address go in the job folder's own name so Drive's
 * search stays useful to an owner poking around outside the app.
 */
export const DOCUMENT_FOLDER_BLUEPRINT: BlueprintNode[] = [
  {
    key: "root",
    name: "Electrician App",
    type: "root",
    children: [
      {
        key: "jobs",
        name: "Jobs",
        type: "system",
        children: [
          {
            // Year and month folders are created on demand as jobs are opened.
            // This entry is the shape, shown before any job exists.
            key: "jobs:year",
            name: "2026",
            type: "year",
            children: [
              {
                key: "jobs:year:month",
                name: "08 – August",
                type: "month",
                children: [
                  {
                    key: "jobs:year:month:job",
                    name: "JOB-1045 – John Smith – 123 Maple – Panel Upgrade",
                    type: "job",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        key: "business",
        name: "Business",
        type: "system",
        children: [
          { key: "business:company-documents", name: "Company Documents", type: "system" },
          { key: "business:templates", name: "Templates", type: "system" },
          {
            key: "business:expenses",
            name: "Expenses",
            type: "system",
            children: [
              {
                key: "business:expenses:year",
                name: "2026",
                type: "year",
                children: [
                  { key: "business:expenses:year:month", name: "08 – August", type: "month" },
                ],
              },
            ],
          },
        ],
      },
      {
        key: "accountant-exports",
        name: "Accountant Exports",
        type: "system",
        children: [
          { key: "accountant-exports:year", name: "2026", type: "year" },
        ],
      },
    ],
  },
];

function blueprintFolders(nodes: BlueprintNode[]): DocumentFolderNode[] {
  return nodes.map((node) => ({
    id: `blueprint-${node.key}`,
    folderKey: node.key,
    name: node.name,
    type: node.type ?? "custom",
    children: blueprintFolders(node.children ?? []),
  }));
}

type FolderRow = {
  id: string;
  folder_key: string;
  display_name: string;
  folder_type: DocumentFolderNode["type"];
  parent_folder_id: string | null;
  sort_order: number;
};

function buildFolderTree(rows: FolderRow[]) {
  const byId = new Map<string, DocumentFolderNode>();
  const sortOrder = new Map<string, number>();

  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      folderKey: row.folder_key,
      name: row.display_name,
      type: row.folder_type,
      children: [],
    });
    sortOrder.set(row.id, row.sort_order);
  }

  const roots: DocumentFolderNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id);
    if (!node) continue;
    const parent = row.parent_folder_id ? byId.get(row.parent_folder_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortChildren = (nodes: DocumentFolderNode[]) => {
    nodes.sort(
      (left, right) =>
        (sortOrder.get(left.id) ?? 0) - (sortOrder.get(right.id) ?? 0) ||
        left.name.localeCompare(right.name),
    );
    nodes.forEach((node) => sortChildren(node.children));
  };
  sortChildren(roots);
  return roots;
}

function hasSupabaseEnvironment() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function googleDriveReady() {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
      process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
      process.env.SUPABASE_SECRET_KEY &&
      process.env.DOCUMENT_SYNC_ENCRYPTION_KEY,
  );
}

export async function getDocumentWorkspace(): Promise<DocumentWorkspace> {
  const fallback: DocumentWorkspace = {
    source: "demo",
    organizationId: null,
    businessName: "Pacific Plains Electric",
    folders: blueprintFolders(DOCUMENT_FOLDER_BLUEPRINT),
    connection: null,
    googleDriveReady: googleDriveReady(),
  };

  if (!hasSupabaseEnvironment()) return fallback;

  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return fallback;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, organizations(name)")
      .eq("user_id", authData.user.id)
      .limit(1)
      .maybeSingle();

    if (!membership) return fallback;
    const organizationId = membership.organization_id;
    const untyped = supabase as unknown as SupabaseClient;
    const [folderResult, integrationResult] = await Promise.all([
      untyped
        .from("document_folders")
        .select("id,folder_key,display_name,folder_type,parent_folder_id,sort_order")
        .eq("organization_id", organizationId)
        .order("sort_order")
        .order("display_name"),
      untyped
        .from("document_integrations")
        .select(
          "provider,status,external_account_email,root_external_url,last_synced_at,last_error",
        )
        .eq("organization_id", organizationId)
        .eq("provider", "google_drive")
        .maybeSingle(),
    ]);

    const folderRows = (folderResult.data ?? []) as FolderRow[];
    const integration = integrationResult.data as {
      provider: "google_drive";
      status: DocumentConnection["status"];
      external_account_email: string | null;
      root_external_url: string | null;
      last_synced_at: string | null;
      last_error: string | null;
    } | null;

    return {
      source: "supabase",
      organizationId,
      businessName:
        (membership.organizations as unknown as { name?: string } | null)?.name ??
        fallback.businessName,
      folders:
        folderRows.length > 0
          ? buildFolderTree(folderRows)
          : blueprintFolders(DOCUMENT_FOLDER_BLUEPRINT),
      connection: integration
        ? {
            provider: integration.provider,
            status: integration.status,
            accountEmail: integration.external_account_email,
            rootUrl: integration.root_external_url,
            lastSyncedAt: integration.last_synced_at,
            lastError: integration.last_error,
          }
        : null,
      googleDriveReady: googleDriveReady(),
    };
  } catch {
    return fallback;
  }
}

function cleanFileSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Title-Case-With-Hyphens, e.g. "john smith" -> "John-Smith". */
function titleSegment(value: string) {
  return cleanFileSegment(value)
    .split("-")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join("-");
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "08 – August" — zero-padded so Drive sorts chronologically. */
export function buildMonthFolderName(month: number) {
  const index = Math.min(Math.max(month, 1), 12);
  return `${String(index).padStart(2, "0")} – ${MONTH_NAMES[index - 1]}`;
}

/**
 * "JOB-1045 – John Smith – 123 Maple – Panel Upgrade"
 *
 * Customer and address are included so Drive's own search remains useful to an
 * owner browsing outside the app. Built only from database values — never from
 * anything a model inferred.
 */
export function buildJobFolderName(input: {
  jobNumber: string | number;
  customerName: string;
  addressLine: string;
  workType: string;
}) {
  return [
    `JOB-${String(input.jobNumber).trim()}`,
    input.customerName.trim(),
    input.addressLine.trim(),
    input.workType.trim(),
  ]
    .filter(Boolean)
    .join(" – ");
}

/**
 * YYYY-MM-DD_JOB-NUMBER_CUSTOMER_DOCUMENT-TYPE_DESCRIPTION.ext
 * e.g. 2026-08-01_JOB-1045_John-Smith_Estimate.pdf
 *
 * Every segment comes from trusted database values. A model may suggest a
 * document type, but the job number, customer, and date are read from records
 * — never inferred — so a misclassification can never invent an identifier.
 * `description` is optional and omitted when absent rather than padded.
 */
export function buildStandardDocumentName(input: {
  date: string;
  jobNumber: string;
  customerName: string;
  documentType: string;
  description?: string;
  extension: string;
}) {
  const extension = input.extension.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "pdf";
  return [
    input.date,
    `JOB-${cleanFileSegment(String(input.jobNumber))}`,
    titleSegment(input.customerName),
    titleSegment(input.documentType),
    input.description ? titleSegment(input.description) : "",
  ]
    .filter(Boolean)
    .join("_")
    .concat(`.${extension}`);
}

export type FolderFile = {
  id: string;
  name: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  documentType: string;
  version: number;
  whenLabel: string;
  /** Signed for an hour, or empty when storage could not be reached. */
  url: string;
  /** True when the browser can show it inline rather than only download it. */
  previewable: boolean;
  jobNumber: string;
};

export type FolderContents = {
  /** Root first, this folder last. Empty when the folder is not the caller's. */
  trail: { id: string; name: string }[];
  folders: DocumentFolderNode[];
  files: FolderFile[];
};

/** Long enough to read a document, short enough not to be worth passing on. */
const FILE_URL_SECONDS = 60 * 60;

function readableInline(mimeType: string): boolean {
  return (
    mimeType === "application/pdf" ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("text/")
  );
}

/**
 * What is actually in a folder.
 *
 * The files page has drawn a folder tree since it was built and has never
 * listed a single file — `documents` was not queried there at all, and there
 * was no route into a folder to query it from. So every invoice PDF, permit and
 * job photo the app has ever filed was reachable only by the screen that made
 * it.
 *
 * Signed in one batch: a job folder holds a dozen documents, and a dozen round
 * trips to sign a dozen links is the page.
 */
export async function getFolderContents(folderId: string): Promise<FolderContents> {
  const empty: FolderContents = { trail: [], folders: [], files: [] };

  const context = await currentContext();
  if (!context) return empty;

  const supabase = asFlexibleClient(await createClient());
  const organizationId = context.organizationId;

  const { data: folderRows } = await supabase
    .from("document_folders")
    .select("id, folder_key, display_name, folder_type, parent_folder_id, sort_order")
    .eq("organization_id", organizationId);

  const rows = (folderRows ?? []) as Record<string, unknown>[];
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  if (!byId.has(folderId)) return empty;

  // Root first. Walking up and reversing, with a hard stop, because a folder
  // whose parent chain loops would otherwise hang the page rather than fail.
  const trail: { id: string; name: string }[] = [];
  let cursor: string | null = folderId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const row: Record<string, unknown> | undefined = byId.get(cursor);
    if (!row) break;
    trail.unshift({ id: String(row.id), name: String(row.display_name ?? "Folder") });
    cursor = typeof row.parent_folder_id === "string" ? row.parent_folder_id : null;
  }

  const folders: DocumentFolderNode[] = rows
    .filter((row) => row.parent_folder_id === folderId)
    .sort(
      (a, b) =>
        Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
        String(a.display_name).localeCompare(String(b.display_name)),
    )
    .map((row) => ({
      id: String(row.id),
      folderKey: String(row.folder_key ?? ""),
      name: String(row.display_name ?? "Folder"),
      type: (String(row.folder_type ?? "custom") as DocumentFolderNode["type"]) ?? "custom",
      children: [],
    }));

  const { data: documentRows } = await supabase
    .from("documents")
    .select(
      "id, display_name, file_name, mime_type, size_bytes, document_type, version_number, created_at, storage_path, jobs ( job_number )",
    )
    .eq("organization_id", organizationId)
    .eq("folder_id", folderId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const documents = (documentRows ?? []) as Record<string, unknown>[];
  const signed = new Map<string, string>();

  if (documents.length > 0) {
    try {
      const admin = getSupabaseAdmin();
      const paths = documents
        .map((row) => (typeof row.storage_path === "string" ? row.storage_path : ""))
        .filter(Boolean);

      const { data, error } = await admin.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrls(paths, FILE_URL_SECONDS);

      if (error) console.error("files: links could not be signed", error);
      for (const entry of data ?? []) {
        if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
      }
    } catch (error) {
      // A list with names and no links is still a list of what exists.
      console.error("files: storage is not reachable", error);
    }
  }

  const files: FolderFile[] = documents.map((row) => {
    const mimeType = typeof row.mime_type === "string" ? row.mime_type : "";
    const job = (row.jobs ?? null) as { job_number?: unknown } | null;

    return {
      id: String(row.id),
      name: String(row.display_name ?? row.file_name ?? "Document"),
      fileName: String(row.file_name ?? ""),
      mimeType,
      sizeBytes: Number(row.size_bytes ?? 0),
      documentType: typeof row.document_type === "string" ? row.document_type : "other",
      version: Number(row.version_number ?? 1),
      whenLabel: formatFiledAt(
        typeof row.created_at === "string" ? row.created_at : "",
        context.timeZone,
      ),
      url: signed.get(typeof row.storage_path === "string" ? row.storage_path : "") ?? "",
      previewable: readableInline(mimeType),
      jobNumber: job?.job_number ? String(job.job_number) : "",
    };
  });

  return { trail, folders, files };
}

function formatFiledAt(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

export type DocumentVersion = {
  id: string;
  version: number;
  whenLabel: string;
  sizeBytes: number;
  /** True for the one currently on file. */
  current: boolean;
};

/**
 * Every version of a document the app generates.
 *
 * `version_number` has been incremented on every regeneration since August and
 * the superseded rows archived rather than deleted — object and all — so the
 * history has existed all along and has been reachable from nowhere. An invoice
 * regenerated after a correction simply replaced itself, and the figure it used
 * to say was gone as far as anybody could tell.
 *
 * Versions hang off the record, not off the document row: an invoice's second
 * PDF is a different `documents` row with the same `invoice_id`. So the lookup
 * starts from whatever this document belongs to, and a document that belongs to
 * nothing — an uploaded file — has exactly one version, itself.
 */
export async function getDocumentVersions(documentId: string): Promise<DocumentVersion[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());

  const { data } = await supabase
    .from("documents")
    .select("id, invoice_id, contract_id, version_number, created_at, size_bytes, archived_at")
    .eq("id", documentId)
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row) return [];

  const owner =
    typeof row.invoice_id === "string" && row.invoice_id
      ? { column: "invoice_id", id: row.invoice_id }
      : typeof row.contract_id === "string" && row.contract_id
        ? { column: "contract_id", id: row.contract_id }
        : null;

  // An uploaded file has no record behind it and no earlier version to go back
  // to. One version, itself, said plainly rather than as an empty list.
  if (!owner) {
    return [
      {
        id: String(row.id),
        version: Number(row.version_number ?? 1),
        whenLabel: formatFiledAt(
          typeof row.created_at === "string" ? row.created_at : "",
          context.timeZone,
        ),
        sizeBytes: Number(row.size_bytes ?? 0),
        current: row.archived_at === null,
      },
    ];
  }

  const { data: siblings } = await supabase
    .from("documents")
    .select("id, version_number, created_at, size_bytes, archived_at")
    .eq("organization_id", context.organizationId)
    .eq(owner.column, owner.id)
    .order("version_number", { ascending: false })
    .limit(50);

  return ((siblings ?? []) as Record<string, unknown>[]).map((version) => ({
    id: String(version.id),
    version: Number(version.version_number ?? 1),
    whenLabel: formatFiledAt(
      typeof version.created_at === "string" ? version.created_at : "",
      context.timeZone,
    ),
    sizeBytes: Number(version.size_bytes ?? 0),
    current: version.archived_at === null,
  }));
}
