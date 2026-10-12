import { AdminInviteForm } from "@/components/admin-invite-form";
import { AdminTime } from "@/components/admin-time";
import { Card, Empty } from "@/components/admin-ui";
import { listOrganizationMembers, type OrganizationDetail } from "@/lib/admin-console";

/** Who can sign in, and a way to invite somebody when nobody inside can. */
export async function PeopleTab({ organization }: { organization: OrganizationDetail }) {
  const members = await listOrganizationMembers(organization.id);
  const zone = organization.timeZone;

  return (
    <Card title="People">
      {members.length === 0 ? (
        <Empty>Nobody has joined this business.</Empty>
      ) : (
        <ul className="space-y-2">
          {members.map((member) => (
            <li key={member.userId} className="rounded-control border border-line p-4">
              <p className="text-sm font-semibold">{member.fullName || member.email}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {member.email} · {member.role}
              </p>
              <p className="mt-1 text-xs text-ink-faint">
                Joined <AdminTime iso={member.joinedAt} timeZone={zone} dateOnly /> · last signed in{" "}
                <AdminTime iso={member.lastSignInAt} timeZone={zone} empty="never" />
                {member.emailConfirmed ? "" : " · email not confirmed"}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-line pt-5">
        <p className="mb-4 text-sm text-ink-muted">
          Invite somebody into this business. Works even when nobody on the inside can sign in to do it themselves.
        </p>
        <AdminInviteForm organizationId={organization.id} />
      </div>
    </Card>
  );
}
