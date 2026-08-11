import test from "node:test";
import assert from "node:assert/strict";

import {
  acceptOutcome,
  invitationEmail,
  invitationLink,
  roleLabel,
  type InvitationFacts,
} from "./invitation-message.ts";

const FACTS: InvitationFacts = {
  organizationName: "Pacific Plains Electric",
  email: "nicholas.kane92@gmail.com",
  inviterName: "Adam Kane",
  role: "owner",
  link: "https://www.volteira.com/invite/2f1b7c14-9f2a-4b8e-8c1d-6a0e2b4f7d33",
  expiresInDays: 14,
};

test("the subject says who, what business, and that it is an invitation", () => {
  const mail = invitationEmail(FACTS);
  assert.match(mail.subject, /Adam Kane/);
  assert.match(mail.subject, /Pacific Plains Electric/);
  assert.match(mail.subject, /invited/i);
});

test("the link survives a mail client that strips the button", () => {
  // The text body has no markup to strip, and the HTML repeats the URL in
  // plain text underneath. Either one alone is enough to accept.
  const mail = invitationEmail(FACTS);
  assert.match(mail.text, /https:\/\/www\.volteira\.com\/invite\//);
  assert.equal(mail.html.match(/2f1b7c14-9f2a-4b8e-8c1d-6a0e2b4f7d33/g)?.length, 2);
});

test("both bodies say which address has to be used", () => {
  // The likeliest failure is accepting from the wrong Gmail, so this is not
  // fine print.
  const mail = invitationEmail(FACTS);
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /nicholas\.kane92@gmail\.com/);
    assert.match(body, /only works for that address/);
    assert.match(body, /14 days/);
  }
});

test("one day is a day, not 1 days", () => {
  const mail = invitationEmail({ ...FACTS, expiresInDays: 1 });
  assert.match(mail.text, /1 day\b/);
  assert.doesNotMatch(mail.text, /1 days/);
});

test("a business name cannot become markup in the invitation", () => {
  // The name is tenant-controlled and this email goes to somebody who has not
  // agreed to anything yet.
  const mail = invitationEmail({
    ...FACTS,
    organizationName: '<img src=x onerror=alert(1)>',
    inviterName: "</a><script>alert(2)</script>",
  });
  assert.doesNotMatch(mail.html, /<img|<script/);
  assert.match(mail.html, /&lt;img/);
  assert.match(mail.html, /&lt;script&gt;/);
});

test("an invitation with no inviter name still reads as a sentence", () => {
  const mail = invitationEmail({ ...FACTS, inviterName: "   " });
  assert.match(mail.text, /^Someone invited you to join Pacific Plains Electric/);
});

test("every role has words, and an unknown one does not print a blank", () => {
  for (const role of ["owner", "admin", "dispatcher", "technician", "accountant"]) {
    assert.match(roleLabel(role), /^a/, role);
  }
  assert.equal(roleLabel("wizard"), "a team member");
});

test("the link has exactly one slash between origin and path", () => {
  const token = "2f1b7c14-9f2a-4b8e-8c1d-6a0e2b4f7d33";
  assert.equal(invitationLink("https://www.volteira.com", token), `https://www.volteira.com/invite/${token}`);
  assert.equal(invitationLink("https://www.volteira.com/", token), `https://www.volteira.com/invite/${token}`);
});

test("only joining and already-joining count as success", () => {
  assert.equal(acceptOutcome("joined").ok, true);
  assert.equal(acceptOutcome("already_member").ok, true);

  for (const status of ["wrong_email", "expired", "revoked", "accepted", "invalid", "signed_out", "unconfirmed_email"]) {
    assert.equal(acceptOutcome(status).ok, false, status);
  }
});

test("a refusal says what to do next, not just what went wrong", () => {
  // Somebody stuck on this page has no other way to find out.
  for (const status of ["wrong_email", "expired", "revoked", "accepted", "invalid", "unconfirmed_email"]) {
    const outcome = acceptOutcome(status);
    assert.ok(outcome.detail.length > 20, status);
    assert.match(outcome.detail, /sign in|Sign out|new one|confirmation|copied/i, status);
  }
});

test("an unrecognised status is refused rather than treated as a pass", () => {
  assert.equal(acceptOutcome("").ok, false);
  assert.equal(acceptOutcome("definitely_fine").ok, false);
});
