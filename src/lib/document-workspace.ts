import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type DocumentFolderNode = {
  id: string;
  folderKey: string;
  name: string;
  type: "root" | "system" | "customer" | "property" | "job" | "category" | "custom";
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

export const DOCUMENT_FOLDER_BLUEPRINT: BlueprintNode[] = [
  {
    key: "root",
    name: "Electrician App",
    type: "root",
    children: [
      {
        key: "company",
        name: "Company",
        type: "system",
        children: [
          { key: "company:business-info", name: "Business Information" },
          { key: "company:licenses-insurance", name: "Licenses & Insurance" },
          { key: "company:templates", name: "Templates" },
          { key: "company:price-book", name: "Price Book" },
        ],
      },
      {
        key: "customers",
        name: "Customers",
        type: "system",
        children: [
          {
            key: "example:customer",
            name: "Customer or Company",
            type: "customer",
            children: [
              {
                key: "example:properties",
                name: "Properties",
                children: [
                  {
                    key: "example:property",
                    name: "Service Address",
                    type: "property",
                    children: [
                      {
                        key: "example:job",
                        name: "Job #1045 – Panel Upgrade",
                        type: "job",
                        children: [
                          { key: "example:intake", name: "01 Intake" },
                          { key: "example:estimates", name: "02 Estimates" },
                          { key: "example:permits", name: "03 Permits" },
                          {
                            key: "example:photos",
                            name: "04 Photos",
                            children: [
                              { key: "example:before", name: "Before" },
                              { key: "example:after", name: "After" },
                            ],
                          },
                          { key: "example:invoices", name: "05 Invoices & Payments" },
                          { key: "example:warranties", name: "06 Warranties" },
                          { key: "example:completion", name: "07 Completion" },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        key: "operations",
        name: "Operations",
        type: "system",
        children: [
          { key: "operations:inventory", name: "Inventory" },
          { key: "operations:purchase-orders", name: "Purchase Orders" },
          { key: "operations:vendors", name: "Vendors" },
        ],
      },
      {
        key: "team",
        name: "Team",
        type: "system",
        children: [{ key: "team:certifications", name: "Certifications" }],
      },
      { key: "reports", name: "Reports", type: "system" },
    ],
  },
];

function blueprintFolders(nodes: BlueprintNode[]): DocumentFolderNode[] {
  return nodes.map((node) => ({
    id: `blueprint-${node.key}`,
    folderKey: node.key,
    name: node.name,
    type: node.type ?? "category",
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
    .toLowerCase()
    .slice(0, 60);
}

export function buildStandardDocumentName(input: {
  date: string;
  jobNumber: string;
  documentType: string;
  description: string;
  extension: string;
}) {
  const extension = input.extension.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "pdf";
  return [
    input.date,
    `job-${cleanFileSegment(input.jobNumber)}`,
    cleanFileSegment(input.documentType),
    cleanFileSegment(input.description),
  ]
    .filter(Boolean)
    .join("_")
    .concat(`.${extension}`);
}
