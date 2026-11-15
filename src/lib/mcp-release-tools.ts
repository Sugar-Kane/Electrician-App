import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import { CURRENT_VERSION, releaseDateLabel, releasesSince } from "@/lib/releases";

/**
 * Volteira's release notes for ChatGPT: what is new, by version.
 *
 * Read-only and the same for every business, from the list that drives the
 * public /changelog page, so the assistant never describes a feature that
 * is not deployed.
 */

export const RELEASE_MCP_TOOLS: McpTool[] = [
  {
    name: "list_feature_updates",
    title: "What's new in Volteira",
    description:
      "Volteira's release notes: the current version and what each release added, improved or fixed, newest first. Use when the owner asks what's new, what changed, or whether Volteira can do something yet. Pass since_version to get only newer releases.",
    inputSchema: {
      type: "object",
      properties: {
        since_version: { type: "string", description: "Only releases newer than this version, e.g. 1.1.0." },
        limit: { type: "number", description: "How many releases at most (default 3)." },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
];

export function isReleaseTool(name: string): boolean {
  return RELEASE_MCP_TOOLS.some((tool) => tool.name === name);
}

export function runReleaseTool(name: string, args: Record<string, unknown>, origin = ""): ToolResult {
  if (name !== "list_feature_updates") return { isError: true, text: "Unknown tool." };
  const since = typeof args.since_version === "string" ? args.since_version.trim().slice(0, 20) : "";
  const limit = Math.min(10, Math.max(1, Math.round(Number(args.limit) || 3)));
  const releases = releasesSince(since).slice(0, limit);
  const header = `Volteira is on version ${CURRENT_VERSION}.${origin ? ` Full notes: ${origin.replace(/\/+$/, "")}/changelog` : ""}`;
  if (releases.length === 0) return { text: `${header}\nNothing newer than ${since}.` };
  const body = releases
    .map((release) =>
      [
        `## v${release.version} · ${releaseDateLabel(release.date)} · ${release.title}`,
        release.summary,
        ...release.changes.map((change) => `- [${change.kind}] ${change.title}: ${change.detail}`),
      ].join("\n"),
    )
    .join("\n\n");
  const more = releasesSince(since).length - releases.length;
  return { text: `${header}\n\n${body}${more > 0 ? `\n\n(${more} older release${more === 1 ? "" : "s"} not shown; raise limit to see them.)` : ""}` };
}

