import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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
