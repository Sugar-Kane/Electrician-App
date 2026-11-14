# Phase 2: supervised AI automation

## Product outcome
Pacific Plains Electric's owner can review an AI-proposed action, approve or reject it, and observe its final outcome without allowing a model to bypass business authorization. This is a shared Volteira capability, scoped to the authenticated business, not a separate PPE-only database.

## Scope and acceptance criteria
1. **Approval inbox:** Show pending proposals with the exact action, customer/job reference, amount, recipient, document/version, expiry, creator, and reason. Never render a generic approval that hides the concrete consequences.
2. **Decision controls:** Authenticated owner or permitted admin can approve/reject. Contract delivery, estimates, purchases, refunds, pricing, and cancellation require owner approval by default. Approval is bound to a canonical payload hash. Disallow approving one's own proposal.
3. **Durable execution:** Transactionally claim approved work once, with unique idempotency key and state machine proposed -> approved/rejected/expired -> executing -> completed/failed. Retrying must not duplicate external side effects; reconcile ambiguous delivery outcomes.
4. **Audit trail:** Append-only business-scoped actor, action, payload version/hash, approval, attempt, provider receipt, error, and timestamps. Redact credentials and sensitive customer text from general activity screens.
5. **Workflow triggers:** Website request received, estimate accepted, contract signed, appointment scheduled/completed, invoice overdue, material shortage. Triggers create proposals or pre-approved internal tasks, not unreviewed binding actions.
6. **Customer communication:** Consent-aware templates, STOP suppression, quiet hours, delivery receipts, retries, and explicit approval for messages outside approved templates.
7. **Integrations:** Reuse existing Volteira contracts, task, SMS, and invoice code. Website intake must use the documented business-scoped API and a stable request idempotency key. Verify deployment and MCP tool catalog separately.
8. **Operations UI:** Pending, approved, rejected, running, completed, failed, and expired views, with drill-down and actionable failure explanations.
9. **MCP tools:** Propose action, list/get proposals, approve/reject where authorized, and inspect execution status. No model-supplied organization ID or approval actor.
10. **Quality gate:** Unit tests for RBAC, tenancy, replay, concurrent approval, retries, expiration, payload changes, consent, and provider timeouts; staging end-to-end tests before enabling production.

## Safety rules
- Model suggestions are untrusted inputs; enforce authorization in server/database code.
- No auto-approval for binding or financial actions, even when proposed via ChatGPT.
- Do not revive the old disabled background worker without examining why it was removed.
- Use a dedicated staging environment, feature flags default off, and no real customer messages or purchases in tests.
- Keep Supabase RLS and tenant isolation; no service-role database client exposed to browser.
- Never claim 'sent', 'signed', 'paid', or 'ordered' until the provider confirms it.

## Delivery sequence
A. Inventory and reuse existing proposal/execution schema and functions; document compatibility.
B. Add tenant-scoped database transitions and approval inbox.
C. Add idempotent executor and audit, with mock providers and failure injection.
D. Add event triggers, consent-aware communications, and website handoff.
E. Add MCP tools and run staging E2E tests.
F. Obtain owner approval to enable each production action class.

The policy module in this branch is the first implementation slice, not a complete workflow engine. It must not be wired to live execution before the database and audit guarantees are implemented.
