import { WhatsNewDialog } from "@/components/whats-new-dialog";
import { currentUser } from "@/lib/request-context";
import { RELEASES, releaseAnchor } from "@/lib/releases";

/**
 * Once per release, after signing in: a short "What's new" for the current
 * version. Shown to anyone signed in whose account has not yet acknowledged
 * this version (user metadata `last_seen_release`); Okay records it.
 */
export async function WhatsNewGate() {
  const user = await currentUser();
  if (!user) return null;
  const release = RELEASES[0];
  if (!release || user.user_metadata.last_seen_release === release.version) return null;

  // The few things that matter most: new and improved features first, then
  // a count of fixes rather than each one.
  const highlights = release.changes.filter((change) => change.kind !== "fixed").slice(0, 3);
  const fixes = release.changes.filter((change) => change.kind === "fixed").length;

  return (
    <WhatsNewDialog
      version={release.version}
      title={release.title}
      highlights={highlights.map((change) => ({ title: change.title, brief: change.brief ?? "" }))}
      fixes={fixes}
      moreHref={`/changelog#${releaseAnchor(release.version)}`}
    />
  );
}
