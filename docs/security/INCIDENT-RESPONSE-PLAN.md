# Volteira incident response and breach notification plan

> **Draft for counsel.** This plan is an operating process, not legal advice. Every legal deadline and content rule below comes from the compliance registers (`compliance/registry/california.json`, CA-004-001 to CA-004-008). Those entries were written without reading the enacted text of Cal. Civ. Code 1798.82 (leginfo was blocked). A California attorney must confirm the clocks, the definition of personal information, and the notice wording before this plan is relied on. Requirement SEC-006-007.

Owner of this plan: Shadam LLC (Volteira platform). Review it at least once a year, and after every real incident, with a tabletop exercise (section 9).

## 1. Roles

| Role | Who | Does |
|---|---|---|
| Incident lead | Adam (Shadam LLC) | Declares an incident, runs this plan, makes the notification decision with counsel |
| Counsel | Outside California privacy counsel (name and phone to be filled in) | Decides whether notice is legally required, approves every notice |
| Technical responder | Whoever is on call for Volteira | Contains, preserves evidence, rotates keys |
| Tenant contact | The owner of each affected contractor business | Receives Volteira's tenant notice; gives their own customers notice where they own the data |

Contacts to keep current in a private copy (not in this repository): counsel, cyber insurer, Supabase, Vercel, Stripe, Twilio, Resend, Google (Calendar/Drive/Maps), Anthropic/OpenAI, local FBI field office / IC3.

## 2. What counts as an incident

Anything that may have exposed, changed or destroyed data Volteira holds, or that let someone act as a business they are not. For example:

- someone outside a business reading or changing its records (a tenant-isolation failure);
- a leaked secret (Supabase service-role key, Stripe or Twilio keys, MCP connection token, Vercel env var);
- a staff or owner account taken over;
- a subprocessor telling us they had a breach;
- a lost or stolen device signed in to Volteira;
- texts, emails or payments sent that nobody asked for.

**Personal information under 1798.82** (verify the current list with counsel, CA-004-001): a first name or initial and last name together with an SSN, a driver's licence or state ID number, a financial account or card number with its access code, medical or health-insurance information, biometric data, or similar. A username or email address together with its password or security answer also counts. Encrypted data is excluded unless the key was taken too.

Most of what Volteira holds (customer names, phones, addresses, job notes) is **not** 1798.82 personal information on its own. It still matters under the contracts with our tenants and under the CCPA. Sign-in credentials, and any card or bank details in notes or photos, can make it reportable.

## 3. The first hour

1. **Open the incident log** (section 8). Write down the time you found out. The clocks start at discovery.
2. **Contain the incident.** Stop the leak without destroying evidence:
   - Leaked key: rotate it (section 6), then check its logs for use.
   - Account taken over: sign the person out everywhere (Supabase Auth → user → sign out sessions), reset their password, and remove the member from the business if needed.
   - ChatGPT/MCP connection: revoke it in Settings → Connections (`mcp_business_credentials.revoked_at`).
   - Bad deploy: roll back in Vercel.
3. **Preserve evidence.** Export, before anything ages out:
   - Supabase logs (API, auth, Postgres) and Vercel runtime logs for the window;
   - the `mcp_call_log`, `activity_events` and `task_proposals` rows for the businesses involved;
   - Stripe and Twilio event lists.

   Keep the exports outside the app, with access limited to the incident lead and counsel.
4. **Call counsel** once any personal information may be involved.

## 4. Deciding whether notice is required (with counsel)

Answer each question in the incident log, with the basis for each answer:

1. Was computerized data acquired, or reasonably believed to have been acquired, by an unauthorized person?
2. Did that data include 1798.82 personal information (section 2), unencrypted or with the key?
3. Whose data is it? Volteira is a **service provider** for its contractor tenants. For data a tenant owns (their customers), Volteira tells the tenant **immediately** (CA-004-006). The tenant, as data owner, then notifies their customers unless a contract says otherwise. For data Volteira owns (its own users: owners and staff), Volteira notifies the people affected.
4. Which states do the affected people live in? Other states' laws apply to their residents. Counsel lists them.
5. Do any contracts require notice of their own: Stripe, Twilio (A2P 10DLC), the cyber insurer, or tenant terms?
6. Is law enforcement asking us to delay? Get that request in writing and log it.

Record the decision and its basis even when the answer is "no notice required" (CA-004-008).

## 5. Clocks (verify with counsel)

| Duty | Deadline in the register | Register |
|---|---|---|
| Tell affected tenants (Volteira as service provider) | Immediately after discovery | CA-004-006, SEC-006-008 |
| Notify affected California residents | Most expedient time possible and without unreasonable delay, and within 30 calendar days of discovery, subject to the permitted delays | CA-004-002 |
| Send a sample copy to the California Attorney General (more than 500 CA residents notified for one breach) | Within 15 calendar days of notifying residents, electronically, with no personal information | CA-004-005 |
| Substitute notice (cost or numbers too high, or no contact details) | Only where the statutory thresholds are met | CA-004-007 |

Put the dates in the log on the day the incident is declared: discovery, the 30-day date and, once residents are notified, the 15-day AG date.

## 6. Rotating secrets

| Secret | Where | Then |
|---|---|---|
| Supabase service-role / JWT secret | Supabase → Project settings → API | Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel, redeploy |
| Stripe secret and webhook secrets | Stripe Dashboard → Developers | Update `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`, redeploy |
| Twilio auth token | Twilio Console → Account → API keys & tokens | Update `TWILIO_AUTH_TOKEN`, redeploy (inbound signature checks use it) |
| Resend API key | Resend → API Keys | Update `RESEND_API_KEY`, redeploy |
| Google OAuth client secrets, Maps keys | Google Cloud Console | Update the `GOOGLE_*` variables, redeploy |
| Anthropic API key | Anthropic Console | Update `ANTHROPIC_API_KEY`, redeploy |
| ChatGPT (MCP) connections | Volteira → Settings → Connections | Revoke each; owners reconnect |

## 7. Notices

- **To tenants** (Volteira → contractor business): `compliance/templates/breach/tenant-incident-notice.md`.
- **To individuals** (the Notice of Data Breach, with the statutory headings): `compliance/templates/breach/notice-of-data-breach.md`.
- **To the Attorney General** (sample copy, more than 500 CA residents): `compliance/templates/breach/attorney-general-submission.md`.

Counsel approves every notice before it is sent. Notices go out through the normal providers (Resend for email, mail for letters), never through the app's customer texting. Don't send a notice to an email account whose own credentials were breached (CA-004-004).

## 8. Incident log

Keep one log per incident in a private, access-limited document, not in this repository. Copy this list:

- Incident number, title, who declared it, and when
- When and how it was discovered (this starts the clocks)
- Timeline of actions, each with its time and who did it
- Systems, businesses (tenants) and people affected; data types
- Containment steps and the keys rotated
- Evidence exported, and where it is kept
- Notification decision for each question in section 4, with its basis and counsel's sign-off
- Dates: tenants told; 30-day resident deadline; residents notified; 15-day AG deadline; AG sample sent; any law-enforcement delay
- Lessons learned, and the follow-up issues opened

## 9. Annual tabletop

Once a year, walk through one scenario end to end with the log open. For example: "a Supabase service-role key was pushed to a public repo on Friday night", or "a contractor's owner account was taken over and their customers' data downloaded". Check that the contacts are current, keys can be rotated within an hour, and the templates still match counsel's advice. Record the date in the legal review register (`compliance/legal-review-register.md`).
