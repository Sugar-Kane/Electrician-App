# Phase 2: supervised AI automation

AI may suggest; a person approves the exact content; Volteira carries it out once and records what happened. Every capability is **off** until its flag is set, and the migration has **not** been applied to production.

## What is built

| Piece | Where |
| --- | --- |
| Database: proposal queue, policy, fingerprint, status guard, audit, events, claim/finish/reconcile | `supabase/migrations/20261115000000_supervised_actions.sql` |
| Database tests (throwaway local Postgres, incl. race tests) | `scripts/test-supervised-db.sh`, `supabase/tests/` |
| Policy mirror, provider-outcome classification, backoff, flags | `src/lib/supervised-actions.ts` |
| Approved message templates | `src/lib/supervised-templates.ts` |
| Reads and decisions | `src/lib/supervised-actions-server.ts` |
| Executor | `src/lib/supervised-executor.ts` |
| Trigger rules / event recording | `src/lib/automation-rules.ts`, `src/lib/automation-triggers-server.ts` |
| ChatGPT (MCP) tools | `src/lib/mcp-supervised-tools.ts`, registered in `src/app/api/mcp/[token]/route.ts` |
| Approve / reject, reconcile, worker | `src/app/api/operations/proposals/[id]/{decision,reconcile}`, `src/app/api/operations/worker` |
| Approval inbox | `src/app/operations/page.tsx`, `src/components/supervised-proposal-card.tsx`, `src/components/operations-approval-controls.tsx` |

### Guarantees and where they live

- **Bound to exact content.** The database computes `content_hash` (sha256 of the canonical action) on insert; a trigger refuses any later change to what the action does. Approve/reject must present the fingerprint; a mismatch is `content_changed`.
- **Who may approve.** `private.supervised_action_approver` (mirrored in `approverFor`): owner only for contracts, estimates, purchases, refunds, price changes, cancellations, and customer messages written for the occasion; owner or admin for templated customer messages, job notes and internal follow-ups; unknown action types: nobody. Technicians, dispatchers and accountants never approve. Role is read from `organization_members` at decision time.
- **Identity.** In the app, `auth.uid()` from the person's own session. From ChatGPT, the owner who made the connection, re-verified as an owner on every call; nothing about identity or tenant is taken from the model. No self-approval of a person's own proposal (an AI proposal made through the owner's connection is the AI's).
- **Tenancy.** Every function checks the job, customer and proposer belong to the business; another business's proposal reads as `not_found`. RLS: owners/admins of the business read proposals, events and audit; nobody writes them except through the functions.
- **Once.** Deciding locks the row (`FOR UPDATE`); 20 simultaneous approvals give one. Claims use `SKIP LOCKED` and a fencing `claim_token`; 10 simultaneous claims give one. Idempotency and dedupe keys are unique per business.
- **Uncertain is not failed.** A timeout, dropped connection or provider 5xx is `uncertain`; a worker that loses its lease leaves the action `uncertain`. Neither is retried; the owner checks the provider and settles it. Only a definite "not done" (rate limit, a save that failed) is retried, with backoff 30 s, 2 m, 8 m, 32 m, ≤ 1 h, up to `max_attempts` (3).
- **Audit.** A trigger writes an append-only row for every status change, with actor, channel, attempt and fingerprint, whichever path made it.
- **Binding and financial actions are never run by the executor.** They can be proposed and approved; the owner carries them out in Volteira and marks them done ("I did this" / "Not doing it"). From ChatGPT they can be proposed and rejected, not approved (unless `VOLTEIRA_PHASE2_MCP_APPROVE_RESTRICTED=true`).
- **Customer messages.** Recipient is taken from the customer record when proposed and must still match at send time. Event-driven proposals need an active transactional SMS opt-in; every send goes through `sendSms`, which refuses after STOP. Quiet hours defer without using an attempt. Email uses the provider's idempotency key and honours an email opt-out. Templates are transactional only; there are no marketing templates.

### Triggers

| Event | Hooked from | Proposes |
| --- | --- | --- |
| `lead.received` | website intake (`/api/intake/website`), new requests only, keyed by Volteira's request id | internal follow-up (runs without a person) |
| `contract.signed` | customer signs (`/contract/[token]`) | internal "book the work, order materials" |
| `appointment.completed` | job marked complete | internal "no invoice yet", only when none exists |
| `invoice.overdue` | worker scan, once per invoice per due date | templated reminder text (owner/admin approve), or a "call them" note with no consent |
| `materials.shortage` | worker scan, once per item per week | purchase (owner approves, done by hand) |
| `estimate.accepted` | **not hooked**: Volteira has no separate acceptance step; signing the contract is the acceptance | templated thank-you (rule exists) |

The website's existing auto-text and the existing job-complete and signed-contract texts are unchanged; no trigger duplicates them.

### Website handoff (Pacific Plains Electric)

The PPE site (`lib/volteira/forward.ts`) posts each request with its own `reference` and the business's website key; Volteira resolves the business from the key only, and `website_intake` deduplicates on the reference, so a retry after a timeout is the same request. The trigger fires only for a new request. No change to the PPE site is needed.

## Flags (all default off)

| Variable | Effect |
| --- | --- |
| `VOLTEIRA_PHASE2_APPROVALS_ENABLED=true` | Approve/reject/reconcile in the inbox (and from ChatGPT). |
| `VOLTEIRA_PHASE2_EXECUTE=send_customer_message,add_job_note,...` | Action types the executor may run. Only types with a handler run: `send_text`, `send_customer_message`, `send_customer_email`, `add_job_note`, `create_internal_task`. |
| `VOLTEIRA_PHASE2_WORKER_ENABLED=true` | The worker route answers, and an approval is run right after it is made. |
| `VOLTEIRA_SUPERVISED_WORKER_TOKEN` | ≥ 32 random characters; required in `x-supervised-worker-token`. |
| `VOLTEIRA_PHASE2_TRIGGERS_ENABLED=true` | Business events create proposals; the worker runs the overdue/shortage scans. |
| `VOLTEIRA_PHASE2_MCP_ENABLED=true` | ChatGPT is offered the five supervised tools. |
| `VOLTEIRA_PHASE2_MCP_APPROVE_RESTRICTED=true` | Lets ChatGPT approve binding/financial proposals. Leave off. |

## Rollout

1. Apply `20261115000000_supervised_actions.sql` in the Supabase SQL editor; then align `supabase_migrations.schema_migrations` to version `20261115000000`, name `supervised_actions` (see AGENTS.md).
2. Turn on `VOLTEIRA_PHASE2_APPROVALS_ENABLED` and `VOLTEIRA_PHASE2_MCP_ENABLED` only. Propose a note from ChatGPT on a test job; approve it in the inbox; confirm the history.
3. Turn on `VOLTEIRA_PHASE2_TRIGGERS_ENABLED`. Watch "Recent automation activity" for a few days; proposals wait in the inbox.
4. Set `VOLTEIRA_SUPERVISED_WORKER_TOKEN`, `VOLTEIRA_PHASE2_WORKER_ENABLED`, and `VOLTEIRA_PHASE2_EXECUTE=add_job_note,create_internal_task`. Schedule the worker with `20261115010000_supervised_worker_schedule.sql` (pg_cron every 5 minutes; the token is generated in Vault and copied to Vercel). Stop it with `select cron.unschedule('volteira-supervised-worker');`.
5. With a test customer who has opted in, add `send_customer_message` to `VOLTEIRA_PHASE2_EXECUTE`; approve one reminder; confirm delivery in Messages and Twilio.

## Rollback

Unset the flags (instant; nothing runs and the inbox becomes read-only). Unschedule the worker if scheduled. The migration is additive; leaving it in place is safe. Anything mid-flight shows as `uncertain` and waits for the owner.

## Known limits

- Contracts, estimates, purchases, refunds, price changes and cancellations are approval records, not automated.
- Uncertain outcomes are settled by the owner; there is no automatic provider lookup yet (Twilio message SIDs and Resend ids are kept as receipts to make the check quick).
- `estimate.accepted` has no source event (see above).
- Database tests run on a local Postgres with a stub of the surrounding schema, not a Supabase staging project; there is no staging environment.
