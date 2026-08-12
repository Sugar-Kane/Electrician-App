"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, LoaderCircle, MailPlus, TriangleAlert, UserRound } from "lucide-react";

import {
  inviteTeammate,
  revokeInvitation,
  type TeamActionState,
} from "@/app/settings/team/actions";
import { roleLabel } from "@/lib/invitation-message";

export type Member = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  isMe: boolean;
};

export type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
};

const initialState: TeamActionState = { error: "" };
const inputClass =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint focus:border-brand/70";

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <MailPlus className="h-5 w-5" aria-hidden />}
      {pending ? pendingLabel : label}
    </button>
  );
}

function RevokeButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target min-h-10 shrink-0 rounded-chip border border-line px-3 text-xs font-semibold text-ink-muted disabled:opacity-60"
    >
      {pending ? "Cancelling…" : "Cancel"}
    </button>
  );
}

function expiryLabel(value: string): string {
  const expires = new Date(value);
  if (Number.isNaN(expires.getTime())) return "";
  const days = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return "Expired";
  return `Expires in ${days} ${days === 1 ? "day" : "days"}`;
}

export function TeamManager({
  organizationId,
  members,
  invitations,
  canManage,
}: {
  organizationId: string;
  members: Member[];
  invitations: Invitation[];
  /** Owners and admins invite; everyone else reads. */
  canManage: boolean;
}) {
  const [inviteState, inviteAction] = useActionState(inviteTeammate, initialState);
  const [revokeState, revokeAction] = useActionState(revokeInvitation, initialState);

  return (
    <div className="space-y-4">
      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">In this business</h2>
        <ul className="mt-4 space-y-2">
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex items-center gap-3 rounded-control border border-line p-4"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/5">
                <UserRound className="h-5 w-5 text-ink-muted" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {member.fullName || member.email}
                  {member.isMe ? <span className="ml-2 text-xs text-ink-faint">you</span> : null}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {member.fullName ? `${member.email} · ` : ""}
                  {roleLabel(member.role).replace(/^an? /, "")}
                </span>
              </span>
            </li>
          ))}
          {members.length === 0 ? (
            <li className="rounded-control border border-line p-4 text-sm text-ink-muted">
              Only you, for now.
            </li>
          ) : null}
        </ul>
      </section>

      {invitations.length > 0 ? (
        <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 className="text-lg font-semibold">Waiting to accept</h2>
          <ul className="mt-4 space-y-2">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex items-center gap-3 rounded-control border border-line p-4"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{invitation.email}</span>
                  <span className="block truncate text-xs text-ink-muted">
                    {roleLabel(invitation.role).replace(/^an? /, "")} · {expiryLabel(invitation.expiresAt)}
                  </span>
                </span>
                {canManage ? (
                  <form action={revokeAction}>
                    <input type="hidden" name="invitationId" value={invitation.id} />
                    <RevokeButton />
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          {revokeState.error ? (
            <p className="mt-4 text-sm text-critical">{revokeState.error}</p>
          ) : null}
          {revokeState.notice ? (
            <p className="mt-4 text-sm text-positive">{revokeState.notice}</p>
          ) : null}
        </section>
      ) : null}

      {canManage ? (
        <form action={inviteAction}>
          <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Invite someone</h2>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              They get an email with a link. It only works for the address you send it to,
              so a forwarded link cannot let somebody else in.
            </p>

            <input type="hidden" name="organizationId" value={organizationId} />

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-ink">Email</span>
                <input
                  name="email"
                  type="email"
                  inputMode="email"
                  required
                  placeholder="them@example.com"
                  className={inputClass}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-ink">Role</span>
                <select name="role" defaultValue="technician" className={inputClass}>
                  <option value="owner">Owner — full access, including billing</option>
                  <option value="admin">Administrator — everything except billing</option>
                  <option value="dispatcher">Dispatcher — schedule and customers</option>
                  <option value="technician">Technician — their own jobs</option>
                  <option value="accountant">Accountant — invoices and payments</option>
                </select>
              </label>
            </div>

            {inviteState.error ? (
              <p className="mt-4 flex items-start gap-2 text-sm text-critical">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {inviteState.error}
              </p>
            ) : null}
            {inviteState.notice ? (
              <p className="mt-4 flex items-start gap-2 break-words text-sm text-positive">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {inviteState.notice}
              </p>
            ) : null}

            <div className="mt-5">
              <SubmitButton label="Send invitation" pendingLabel="Sending…" />
            </div>
          </section>
        </form>
      ) : null}
    </div>
  );
}
