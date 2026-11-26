# Remediation backlog

Generated 2026-11-26 by `compliance/scripts/build-backlog.mjs` from: `compliance/application-audits/2026-11-24`.

**For approval. Nothing here has been implemented.** Each item names the finding, the rule it
supports, where the problem is, and what would show it fixed. Priorities: P0 fix before relying
on the feature; P1 fix soon; P2 planned; P3 improvement. Items marked ⚖️ need a lawyer to confirm
the requirement or the fix before work starts. A citation not yet re-verified against its official
source is marked ❔; the problem was still observed.

| Priority | Items |
|---|---|
| P0 | 17 |
| P1 | 101 |
| P2 | 127 |
| P3 | 55 |
| **Total** | **300** |

## P0

### F-CSLB-002-001-APP ⚖️: Identify home improvement contracts (B&P 7151.2) and apply B&P 7159

- **Requirement:** CSLB-002-001 (Cal. Bus. & Prof. Code §§ 7151, 7151.2, 7159(a))
- **Observed:** RED, severity critical, confidence high
- **Problem:** No contract-type classification exists. contracts.kind is only agreement\|change_order; jobs.category is an operational category (diagnostic, work_order, ...). One generic template is used for every job, and it is not a 7159 contract.
- **Fix:** Add contract_type (and property/customer type) to jobs/contracts, default residential to home_improvement, and select a type-specific locked template.
- **Files:** `src/app/jobs/[jobId]/contract-actions.ts:190`, `src/app/jobs/[jobId]/contract-actions.ts:338`, `src/lib/contract-template.ts:193`
- **Done when:** Each job/contract classified (home improvement, service and repair, commercial, new construction, subcontract); residential work defaults to home improvement and uses the 7159 template. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-002-009-APP ⚖️ ❔: Home solicitation determination for in-home and remote signing

- **Requirement:** CSLB-002-009 (Cal. Civ. Code § 1689.5; Cal. Bus. & Prof. Code § 7159(e) (Three-Day Right to Cancel exception for contracts negotiated at the contractor's place of business; verify paragraph))
- **Observed:** RED, severity critical, confidence high
- **Problem:** No signing-location record and no cancellation notice or form in any contract; in-person tablet signing and remote link signing both produce the same notice-free document. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Default every residential contract to include the cancellation notice/forms; only omit when a 'negotiated at contractor's place of business' attestation is recorded.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/pdf/contract-document.tsx:79`, `src/components/signature-pad.tsx:1`
- **Done when:** Default to cancellation notice and Notice of Cancellation unless tenant records negotiation at its place of business (in-home tablet and remote e-sign included). Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-016-APP: Downpayment heading, amount and 12-point notice

- **Requirement:** CSLB-003-016 (Cal. Bus. & Prof. Code § 7159(d)(8))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Cap is enforced in planAmounts (passing test). But the rendered contract labels the $800 deposit 'Diagnostic fee: $800.00, due on signing' (the {{deposit}} placeholder is reused); there is no 'Downpayment' heading; the notice reads 'DOWN PAYMENT' (two words) and renders at 10pt regular, not 12pt bold.
- **Fix:** Render a 'Downpayment' heading with the amount and the verbatim notice in 12pt bold from a fixed component; stop labelling a down payment as a diagnostic fee.
- **Files:** `src/lib/contract-template.ts:204`, `src/app/jobs/[jobId]/contract-actions.ts:410`, `src/lib/payment-plan.ts:57`, `src/lib/payment-plan.ts:244`
- **Done when:** 'Downpayment' heading, the amount, and 12pt bold 'THE DOWNPAYMENT MAY NOT EXCEED $1,000 OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS.' Tests: src/lib/payment-plan.test.ts::California caps the down payment at 10% or $1,000, whichever is less.
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-017-APP: Schedule of Progress Payments heading, phase detail and 12-point 'Do not pay ahead' notice

- **Requirement:** CSLB-003-017 (Cal. Bus. & Prof. Code § 7159(d)(9))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Rendered block is headed 'PAYMENT SCHEDULE' with 'Payment 2 $3,200.00 (40%) due 2026-12-05' - tied to a calendar date, not to work performed; the 'Do not pay ahead of the work' statement is absent (only 'Progress payments are for work performed or materials delivered.'), all at 10pt regular.
- **Fix:** Require a work/milestone description per progress payment, use the statutory heading, add the verbatim 12pt bold statement, and disallow date-only progress payments for home-improvement contracts.
- **Files:** `src/lib/payment-plan.ts:214`, `src/lib/payment-plan.ts:244`
- **Done when:** 'Schedule of Progress Payments' heading; each payment in dollars and cents tied to specific work/materials; 12pt bold 'Do not pay ahead of the work...' statement. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-025-APP ⚖️: Mechanics Lien Warning notice

- **Requirement:** CSLB-003-025 (Cal. Bus. & Prof. Code § 7159(e)(4))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Missing from the default template and the rendered contract; no statutory text exists anywhere in src.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/pdf/contract-document.tsx:79`
- **Done when:** 'Mechanics Lien Warning' heading and full statutory text verbatim. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-002-APP ⚖️ ❔: Three business days to cancel; five business days for buyers 65 or older

- **Requirement:** CSLB-007-002 (Cal. Civ. Code § 1689.6; Cal. Bus. & Prof. Code § 7159(e) (verify); AB 2471 (Stats. 2020))
- **Observed:** RED, severity critical, confidence high
- **Problem:** No senior-buyer question, no deadline computation, no cancellation notice; deposit pay link is sent immediately after signing (after() in signContract).
- **Fix:** Ask 65+ at signing, compute and store the deadline, print the three/five-day version, and hold deposit requests and work until it passes.
- **Files:** `src/app/contract/[token]/actions.ts:89`, `src/app/contract/[token]/actions.ts:190`
- **Done when:** Three business days (five for 65+) cancellation; senior status asked; deadline computed in business days. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-003-APP ⚖️: Three-Day (or Five-Day) Right to Cancel notice text and 12-point boldface

- **Requirement:** CSLB-007-003 (Cal. Bus. & Prof. Code § 7159(e)(6); Cal. Civ. Code § 1689.7(a))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Absent from template and rendered contract, although the e-sign consent text tells the customer the agreement includes 'any notice of your right to cancel'.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/esign-consent.ts:28`
- **Done when:** 'Three-Day Right to Cancel' notice verbatim in 12pt bold near the owner's signature, acknowledged by signature/date. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-004-APP ⚖️ ❔: Notice of Cancellation form in duplicate, detachable

- **Requirement:** CSLB-007-004 (Cal. Civ. Code § 1689.7 (verify subdivision); Cal. Bus. & Prof. Code § 7159(e)(6))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Absent.
- **Fix:** Render two filled Notice of Cancellation pages in the PDF and an in-app cancellation button.
- **Files:** `src/lib/pdf/contract-document.tsx:79`
- **Done when:** Completed 'Notice of Cancellation' form in duplicate, detachable, with transaction date and deadline; electronic send option. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-007-APP ⚖️ ❔: Refund within 10 days after cancellation; goods return rules

- **Requirement:** CSLB-007-007 (Cal. Civ. Code §§ 1689.10, 1689.11 (verify))
- **Observed:** RED, severity critical, confidence high
- **Problem:** contracts.status has no 'cancelled by buyer' state (draft\|sent\|signed\|void); there is no buyer cancellation record or deadline-tracked refund workflow tied to contracts.
- **Fix:** Add buyer cancellation (status, received_at, method), a 10-day refund task with automatic Stripe refund of all payments, and audit logging.
- **Files:** `src/app/contract/[token]/actions.ts:89`
- **Done when:** Record a cancellation and refund all payments (including deposit via Stripe) within 10 days with an audit trail. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-011-APP: In-home and remote e-signature both default to cancellation notices

- **Requirement:** CSLB-007-011 (Cal. Bus. & Prof. Code § 7159(e)(6); Cal. Civ. Code § 1689.5)
- **Observed:** RED, severity critical, confidence high
- **Problem:** Notices are not included and everything printed in the body is the tenant-editable template. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/pdf/contract-document.tsx:79`, `src/app/settings/contract/actions.ts:39`
- **Done when:** Right to Cancel notice and forms included in every home-improvement contract unless place-of-business negotiation recorded; tenant cannot remove them by editing. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-008-001-APP: Mechanics Lien Warning included verbatim in home improvement contracts

- **Requirement:** CSLB-008-001 (Cal. Bus. & Prof. Code § 7159(e)(4))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Absent (see CSLB-003-025).
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`
- **Done when:** Full statutory Mechanics Lien Warning in every home-improvement contract. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-002-005-APP: Honor consent revocation made by any reasonable means

- **Requirement:** FED-002-005 (47 CFR 64.1200(a)(10) (Report and Order, FCC 24-24, CG Docket No. 02-278))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Inbound handling matches only the exact single words stop, stopall, unsubscribe, cancel, end, quit after stripping non-letters (route.ts:23, 89). 'revoke' and 'opt out' (normalised to 'optout') are not recognised, and a sentence such as 'please stop texting me' is passed to the AI intake instead of opting out. There is no path to record a revocation made by voice, email or to staff. A STOP from a customer with no consent row updates zero rows (route.ts:142-151), so the local ledger records nothing and sendSms will text them again unless Twilio's own list blocks it. Any org member can also UPDATE or DELETE messaging_consent rows under RLS, so a STOP can be cleared outside the START path.
- **Fix:** Add 'revoke', 'optout'/'opt out' and other synonyms; detect free-text revocation intent before the AI intake and treat it as an opt-out; upsert (not update) the opt-out row so a STOP lands with no prior row; add staff/voice/email 'customer asked to stop' actions that write the ledger; restrict UPDATE/DELETE of opted_out_at to the service role or a START-only function; add tests for each keyword and the no-row case.
- **Files:** `src/app/api/twilio/inbound/route.ts:23-24`, `src/app/api/twilio/inbound/route.ts:89`, `src/app/api/twilio/inbound/route.ts:142-151`, `src/app/api/twilio/inbound/route.ts:282-292`, `src/lib/messaging-rules.ts:101-108`
- **Done when:** Revocation accepted by any reasonable means, including replies of stop, quit, end, revoke, opt out, cancel, unsubscribe, free-text revocations, voice, email or telling staff. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-SEC-001-002-APP: Owners, admins and platform staff must use MFA

- **Requirement:** SEC-001-002 (OWASP ASVS 5.0.0 V6.3.3; OWASP ASVS 5.0.0 V8.4.2; NIST CSF 2.0 PR.AA-03)
- **Observed:** RED, severity critical, confidence high
- **Problem:** MFA does not exist, so no role is required to use it. Platform admin access is gated by private.is_platform_admin() only; no admin_* RPC or server action checks aal (catalog: checks_aal=false for every admin_* function). Owner-only actions (Stripe Connect start, team management, MCP credentials, report export) have no step-up.
- **Fix:** After SEC-001-001, add a requireAal2() helper used by admin layout/actions, owner/admin server actions and the admin_* RPCs (check auth.jwt()->>'aal' = 'aal2' in SQL); record any tenant-level relaxation in platform_admin_audit.
- **Files:** `src/app/settings/payments/start/route.ts:25`, `src/app/settings/team/actions.ts:37`, `src/app/reports/export/route.ts:20`, `src/lib/admin-console.ts:996`
- **Done when:** Owners, admins and platform admins need an aal2 session for privileged actions (billing, members, export, MCP connections, admin console). Tests: src/lib/admin-trace.test.ts.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-007-APP ⚖️: Breach notification workflow supports Cal. Civ. Code 1798.82 duties

- **Requirement:** SEC-006-007 (NIST CSF 2.0 RS.CO-02; NIST CSF 2.0 GV.OC-03)
- **Observed:** RED, severity critical, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing).
- **Fix:** With counsel, create a breach-notification workflow and notice templates meeting Cal. Civ. Code 1798.82 headings and AG submission rules.
- **Done when:** Workflow to decide 1798.82 notification, draft compliant notices, track timing, AG sample copy >500 residents; other states and contracts. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-CA-005-007-APP ⚖️ ❔: Home solicitation contracts: right to cancel and Notice of Cancellation formalities

- **Requirement:** CA-005-007 (Cal. Civ. Code 1689.5, 1689.6, 1689.7)
- **Observed:** RED, severity high, confidence high
- **Problem:** No home-solicitation determination exists (no signing-location field), and the default template and rendered contract contain no cancellation statement or Notice of Cancellation form. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Record signing context per contract and default to home-solicitation; render the statutory cancellation notice (12pt bold) next to the buyer signature and two completed Notice of Cancellation forms; block deposit requests and work scheduling until the cancellation deadline passes unless a valid emergency waiver is on file.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/pdf/contract-document.tsx:79`
- **Done when:** Home solicitation contracts identified; statutory cancellation statement in required type/placement with a completed detachable Notice of Cancellation; no non-emergency work during the period. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CA-005-008-APP ⚖️ ❔: Electronic delivery and signing of cancellation notices

- **Requirement:** CA-005-008 (Cal. Civ. Code 1633.3, 1633.8, 1689.7)
- **Observed:** RED, severity high, confidence high
- **Problem:** Signed PDF contains no cancellation notice or form; there is no in-app or email cancellation path for the customer and no cancellation status on contracts.
- **Fix:** Implement CA-005-007 notice in the PDF, add a 'Cancel this contract' action on the customer's link that records the notice with timestamp and notifies the business; obtain the legal opinion.
- **Files:** `src/lib/pdf/contract-document.tsx:79`, `src/app/contract/[token]/actions.ts:89`
- **Done when:** Until legal opinion, provide the cancellation notice in the signed PDF, deliver a retainable copy, accept cancellation by any written means including in-app. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-001-APP ⚖️ ❔: Home solicitation contract definition triggers cancellation rights

- **Requirement:** CSLB-007-001 (Cal. Civ. Code § 1689.5)
- **Observed:** RED, severity high, confidence high
- **Problem:** No identification; no cancellation regime.
- **Fix:** See CSLB-002-009.
- **Files:** `src/app/jobs/[jobId]/contract-actions.ts:190`
- **Done when:** Home solicitation contracts identified and 1689.6-1689.14 applied. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

## P1

### F-CA-003-002-APP ❔: Reasonable security procedures for personal information

- **Requirement:** CA-003-002 (Cal. Civ. Code 1798.81.5(b))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** RLS on 95/95 public tables, tenant reference guard triggers, signed webhooks and tenant path tests pass; but MT-03 HIGH remains open (REMEDIATION.md:13), the readiness decision is NOT READY (line 5), and no MFA enforcement or incident plan exists.
- **Fix:** Close MT-03, enforce MFA for owners/admins, adopt an incident plan.
- **Files:** `docs/security/REMEDIATION.md:5-25`, `src/lib/twilio.ts:493-518`
- **Done when:** Reasonable security procedures for PI. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-004-002-APP ⚖️ ❔: Notify affected California residents within 30 calendar days of discovery

- **Requirement:** CA-004-002 (Cal. Civ. Code 1798.82(a) as amended by SB 446 (Stats. 2025))
- **Observed:** RED, severity critical, confidence medium
- **Problem:** No breach notification process or clock tracking exists.
- **Fix:** Define the notification workflow with the 30-day clock.
- **Files:** `docs/security`
- **Done when:** Process to notify California residents within 30 calendar days. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-004-006-APP ❔: Service provider duty to notify data owner immediately

- **Requirement:** CA-004-006 (Cal. Civ. Code 1798.82(b))
- **Observed:** RED, severity critical, confidence medium
- **Problem:** No tenant terms with an incident-notification commitment and no tenant notification procedure exist.
- **Fix:** Commit to immediate tenant notice in tenant terms and the plan; obtain matching vendor commitments.
- **Files:** `docs/security`, `src/app/signup`
- **Done when:** Service provider notifies data owner (tenant) immediately; tenant terms set the commitment; subprocessors owe the same. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-006-005-APP ❔: Recording confidential communications requires consent of all parties (AI voice line)

- **Requirement:** CA-006-005 (Cal. Penal Code 632)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Every inbound and outbound AI greeting says 'This call may be recorded or transcribed' before the caller speaks (tested on both the Gather and xAI paths). Gaps: Twilio starts recording at answer (record-from-answer-dual, twilio-sip.ts:63) and xAI receives audio before the notice finishes; the notice does not say an AI assistant/third-party vendor processes the call; the delivery of the disclosure is not logged per call.
- **Fix:** Say the notice (including AI processing) via TwiML <Say> before bridging to xAI and before recording starts; log disclosure delivery per call; obtain counsel confirmation that continuing is consent.
- **Files:** `src/lib/voice-intake.ts:19-61`, `src/lib/grok-voice.ts:171-178`, `src/lib/twilio-sip.ts:63-66`
- **Done when:** Clear disclosure at the start that the call is recorded and transcribed (including by an AI assistant), before recording/transcribing; applied to outbound calls and transfers; logged. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-006-006-APP ❔: Intercepting or recording cellular/cordless communications requires all-party consent

- **Requirement:** CA-006-006 (Cal. Penal Code 632.7)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** The same notice is given on all calls regardless of phone type (tested), but recording starts at answer before the notice is spoken (twilio-sip.ts:63).
- **Fix:** Start recording only after the notice (record after <Say>, or start recording via API after disclosure).
- **Files:** `src/lib/twilio-sip.ts:63-66`, `src/lib/voice-intake.ts:44-61`
- **Done when:** Treat all cellular/cordless calls as covered; all-party consent via the CA-006-005 disclosure before recording or transcribing. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CSLB-001-002-APP ⚖️: Unlicensed contractor cannot recover compensation; disgorgement risk

- **Requirement:** CSLB-001-002 (Cal. Bus. & Prof. Code § 7031)
- **Observed:** RED, severity critical, confidence high
- **Problem:** No license status, expiry or verification date is stored, so a lapse can never be surfaced; invoicing and payment requests continue regardless.
- **Fix:** Store CSLB status/expiry with verification date; show a blocking banner and require acknowledgement before invoices/pay links when status is not Active or verification is stale.
- **Files:** `src/app/settings/business/actions.ts:81`, `src/lib/pdf/store.ts:69`
- **Done when:** A license lapse mid-job is surfaced so the tenant does not keep invoicing/collecting unknowingly. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-001-APP: Home improvement contract and any changes must be in writing and signed

- **Requirement:** CSLB-003-001 (Cal. Bus. & Prof. Code § 7159(d))
- **Observed:** RED, severity critical, confidence medium
- **Problem:** Both parties can sign (contractor via sign_contract_as_contractor, customer via sign_contract_in_app), but job scheduling/workflow never checks contract signature status; a job can be scheduled and progressed with no signed contract.
- **Fix:** Block the in-progress/started transition (and crew dispatch) for home-improvement jobs without a contract signed by both parties.
- **Files:** `src/lib/job-workflow.ts:1`, `src/lib/job-stage.ts:1`, `src/app/jobs/[jobId]/contract-actions.ts:190`
- **Done when:** Contract and changes signed by both parties before work; app does not let a home-improvement job be marked started until fully signed. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-003-APP: Signed and dated copy delivered to buyer before work starts

- **Requirement:** CSLB-003-003 (Cal. Bus. & Prof. Code § 7159(c)(3)(A))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** The business signs when sending, so after the customer signs the copy carries both signatures and dates; sendSignedContractCopy emails the PDF / texts the link immediately. Delivery is not recorded (console only) and work start is not gated on delivery.
- **Fix:** Store delivered_at/channel on the contract and require it before a home-improvement job can start.
- **Files:** `src/lib/contract-copy.ts:44`, `src/app/contract/[token]/actions.ts:174`
- **Done when:** Signed and dated copy delivered to buyer before work starts; delivery recorded. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-009-APP: Contractor name, business address and license number

- **Requirement:** CSLB-003-009 (Cal. Bus. & Prof. Code § 7159(d)(1))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Rendered synthetic contract shows 'Fixture Electric', 'Lic. 0000000' and the base address in the page-1 letterhead and license again in the footer. Values come from free-text organizations fields, never verified; license and address are silently omitted when empty and generation is not blocked.
- **Fix:** Source name/address/license from the verified record (CSLB-001-006) and refuse to generate when any is missing.
- **Files:** `src/lib/pdf/letterhead.tsx:121`, `src/lib/pdf/store.ts:69`, `src/lib/pdf/letterhead.tsx:149`
- **Done when:** Contractor name, business address and license number, from the verified license record. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-013-APP: Contract Price heading with amount in dollars and cents

- **Requirement:** CSLB-003-013 (Cal. Bus. & Prof. Code § 7159(d)(5))
- **Observed:** RED, severity critical, confidence high
- **Problem:** Amount is computed from integer cents and printed with cents ('Total: $8,000.00' in the rendered contract; money tests pass), but the heading is 'PRICE' / 'Total:', not 'Contract Price'.
- **Fix:** Use the statutory 'Contract Price' heading in the home-improvement template.
- **Files:** `src/lib/contract-template.ts:202`, `src/lib/contract-template.ts:143`
- **Done when:** Heading 'Contract Price' followed by the amount in dollars and cents from integer cents. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-006-001-APP: Change orders in writing and signed before the changed work begins

- **Requirement:** CSLB-006-001 (Cal. Bus. & Prof. Code § 7159(c)(5), (d), (d)(13))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** A change order is applied to invoices only once approved (check constraint change_orders_applied_only_when_approved), and approval comes from the customer's signature trigger (approve_signed_change_order) or the 'contract_revision' path for unsigned contracts - inspected live. Work start on change-order items is not tracked or gated, and the contractor's signature on the change order is not required by the database for approval.
- **Fix:** Require the contractor signature as well before approval; block scheduling/marking done of change-order items until approved.
- **Files:** `src/app/contract/[token]/actions.ts:151`, `src/lib/change-orders-server.ts:1`, `src/lib/change-order-document.ts:51`
- **Done when:** Change order in writing and signed before work; no start or invoicing of change-order work until both parties sign. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-002-001-APP ⚖️: Prior express consent for autodialed or artificial/prerecorded-voice calls and texts to wireless numbers

- **Requirement:** FED-002-001 (47 U.S.C. 227(b)(1)(A)(iii); 47 CFR 64.1200(a)(1)(iii))
- **Observed:** RED, severity critical, confidence high
- **Problem:** The ledger exists and is tenant-scoped (messaging_consent with organization_id, source, opted_in_at, proof_text carrying SMS_CONSENT_VERSION), but the send gate deliberately allows texts with no consent record and when the record cannot be read: textRefusal() returns null for null/'unknown' consent and only a STOP refuses (messaging-rules.ts:101-108; twilio.ts:270-276). recordManualSmsConsent() writes an 'admin' consent automatically when staff enter a mobile number on a new job, with no disclosure shown to the customer. In production 5 customers have phones but only 1 consent row exists while 4 outbound texts were sent.
- **Fix:** Make sendSms refuse when there is no opted-in row (or the read fails) for this organization+customer, except for an explicitly enumerated, counsel-approved exempt category; record a consent row (source, wording version, captured_by) at every capture point including phone booking and owner entry, and show the customer the disclosure (or send a one-time confirmation text) when consent is inferred from a number given to the business. Add a test that a customer with no consent row is not texted.
- **Files:** `src/lib/messaging-rules.ts:94-108`, `src/lib/twilio.ts:246-277`, `src/lib/customer-text.ts:35-53`, `src/lib/manual-sms-consent.ts:271-326`, `src/app/api/twilio/inbound/route.ts:119-136`
- **Done when:** Consent recorded per tenant and number (source, date, scope, wording) before any automated text, and sends blocked when no valid consent is on file or it has been revoked. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-002-006-APP: Process revocation within a reasonable time not exceeding 10 business days

- **Requirement:** FED-002-006 (47 CFR 64.1200(a)(10))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Where a consent row exists, a STOP is written synchronously before anything else and returns 500 so Twilio retries if it fails (route.ts:138-151); sendSms re-reads consent on every send (twilio.ts:270-275), and the supervised executor treats a STOP as a final failure (tested). Gaps: a STOP with no prior row is not recorded (zero-row update), and an unreadable consent record is treated as allowed.
- **Fix:** Upsert the opt-out row; fail closed when consent cannot be read; add an integration test from inbound STOP to a refused send.
- **Files:** `src/app/api/twilio/inbound/route.ts:138-151`, `src/lib/twilio.ts:270-276`, `src/lib/customer-text.ts:165-174`
- **Done when:** Revocations processed immediately at send time and never later than 10 business days. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-004-002-APP: Reasonable data security for customer and tenant data (FTC Act section 5 unfairness)

- **Requirement:** FED-004-002 (15 U.S.C. 45(a), 45(n))
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** RLS is enabled on all 95 public tables; tenant guard triggers exist (e.g. zz_tenant_references_guard on messaging_consent); MCP authorization, tenant storage path and webhook signature tests pass. However docs/security/REMEDIATION.md:5 records 'NOT READY to onboard a second paying business' with MT-03 HIGH (live RLS/storage/MCP isolation unverified) open; no MFA enforcement for admins was found; there is no incident response plan.
- **Fix:** Close MT-03 with two-tenant authenticated tests; enforce MFA (aal2) for owners and platform admins; write an incident response plan (FED-011-006).
- **Files:** `docs/security/REMEDIATION.md:5-25`, `docs/security/MULTI-TENANT-READINESS.md:98-100`, `src/lib/mcp-business-authorization.ts`, `src/app/api/twilio/inbound/route.ts:34-45`
- **Done when:** Reasonable security: tenant isolation, access control, MFA for admins, least-privilege AI/MCP tools, secrets, logging, vendor oversight, incident response. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-SEC-001-016-APP: Volteira platform admin area has layered access control

- **Requirement:** SEC-001-016 (OWASP ASVS 5.0.0 V8.4.2; NIST CSF 2.0 PR.AA-05)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Platform admin is a server-side allowlist (platform_admins table, private.is_platform_admin checked inside every admin_* RPC; RPCs not executable by anon). Masking and trace/impersonation logging with reason are implemented and tested (admin-mask, admin-trace, admin-removal-rules tests pass; impersonation_sessions carry reason and expiry). Missing: aal2 requirement (no MFA) and any documented quarterly admin review.
- **Fix:** Require aal2 for the admin area (see SEC-001-002) and record a quarterly review of platform_admins membership.
- **Files:** `src/lib/admin-console.ts:996`, `src/lib/request-context.ts:192`
- **Done when:** Platform admin by server-side allowlist with aal2; PI masked by default; unmasking/trace logged with reason; quarterly review. Tests: src/lib/admin-mask.test.ts, src/lib/admin-trace.test.ts, src/lib/admin-removal-rules.test.ts.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-001-APP: Row-level security is enabled on every tenant table

- **Requirement:** SEC-002-001 (OWASP ASVS 5.0.0 V8.4.1; OWASP ASVS 5.0.0 V8.2.2; OWASP API Security Top 10 2023 API1:2023; NIST CSF 2.0 PR.AA-05)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** All 95 public tables have relrowsecurity = true (none disabled); 0 tables use FORCE RLS. Four tables have RLS with zero policies (booking_calendar_connections, booking_calendar_events, organization_ai_keys, task_work), which denies all non-service access. No views. The behavioural two-tenant check has not been run. Run 2 (2026-11-25): as Tenant A, 0 Tenant B rows were visible in all 14 seeded tables plus the organization row and storage objects (customers, properties, jobs, estimates, contracts, invoices, invoice_payments, documents, conversations, messages, both settings tables, organization_members, organization_subscriptions). Remaining ~80 tables were not exercised, so 'every table' is not yet shown.
- **Fix:** Run compliance/tests/tenant-isolation/two-tenant-rollback.sql (TI-002) on a branch/copy and attach results; add a CI check that fails when a migration creates a public table without enable row level security.
- **Files:** `supabase/migrations/20261117130000_tenant_relationship_and_storage_guards.sql:1`
- **Done when:** RLS enabled on every Data API table; FORCE RLS considered; Tenant A sees zero Tenant B rows in every table; new tables enable RLS. Tests: compliance/tests/tenant-isolation/two-tenant-rollback.sql.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-002-APP: RLS policies are scoped by organization membership

- **Requirement:** SEC-002-002 (OWASP ASVS 5.0.0 V8.2.2; OWASP ASVS 5.0.0 V8.3.1; OWASP API Security Top 10 2023 API1:2023; OWASP Top 10:2025 A01:2025)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** Policies use private.is_org_member / is_org_admin / can_edit_billing (membership via organization_members and auth.uid()); none reference user_metadata. Only USING (true) policy is site_videos (marketing videos, not tenant data). Defect: 'Owners can delete organizations' compares membership.organization_id = membership.id (unqualified id bound to the subquery table), so it never matches and owners cannot delete (fails closed, but not the intended rule). Run 2 (2026-11-25): Tenant A updated and deleted 0 Tenant B rows in all 14 seeded tables and the organization row. Not exercised for the remaining tables or for non-owner roles.
- **Fix:** Run TI-002..TI-005; fix the organizations delete policy to compare membership.organization_id = organizations.id in a new migration.
- **Files:** `supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:185`
- **Done when:** Policies check organization membership via organization_members, never user_metadata; no USING (true) on tenant data; A affects zero B rows. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-003-APP: Writes cannot move or create rows in another tenant

- **Requirement:** SEC-002-003 (OWASP ASVS 5.0.0 V8.2.2; OWASP ASVS 5.0.0 V15.3.3; OWASP API Security Top 10 2023 API3:2023)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** No UPDATE policy lacks WITH CHECK; INSERT policies check membership of the new organization_id. 89 tables carry zz_tenant_owner_immutable (keep_tenant_owner raises when organization_id changes) and zz_tenant_references_guard (cross-tenant references refused). The prior audit's local harness (scripts/security/tenant-isolation-test.sql) is not part of npm test and has not been run against the live schema in this audit. Run 2 (2026-11-25): inserting a customer with B's organization_id and joining B's membership were refused by RLS (42501); moving A's own customer to B was refused by the tenant guard ('A customers row cannot move to another business'); a job pointing at B's customer was refused ('refers to a record that belongs to another business'). Exercised on customers, organization_members and jobs only.
- **Fix:** Run TI-006..TI-008 and record results; wire scripts/security/replay-migrations.sh + tenant-isolation-test.sql into a pre-release job.
- **Files:** `supabase/migrations/20261117130000_tenant_relationship_and_storage_guards.sql:1`, `scripts/security/tenant-isolation-test.sql:1`
- **Done when:** INSERT/UPDATE WITH CHECK requires membership of the new organization_id; organization_id immutable after insert; A cannot insert into or move rows to B. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-004-APP: SECURITY DEFINER functions check membership and pin search_path

- **Requirement:** SEC-002-004 (OWASP ASVS 5.0.0 V8.3.1; OWASP ASVS 5.0.0 V8.2.1; NIST CSF 2.0 PR.AA-05)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** All 178 SECURITY DEFINER functions in public/private set search_path in proconfig. Service-only money/worker RPCs (settle_*, record_stripe_refund, claim_*, website_intake, etc.) are not executable by authenticated. Default ACL for functions in public still grants EXECUTE to anon and authenticated, and 37 SECURITY DEFINER functions are anon-executable (token/slug public RPCs plus private trigger helpers); 52 authenticated-executable ones have no auth.uid()/membership helper in their own body and rely on token checks or private.* gate helpers (sampled: correctly gated). sweep_expired_impersonations is callable by any signed-in user (low impact).
- **Fix:** Change default privileges (alter default privileges in schema public revoke execute on functions from anon, authenticated); revoke anon EXECUTE from private.* trigger helpers; run TI-009 and extend it to each anon RPC with another tenant's identifiers.
- **Files:** `supabase/migrations/20261111010000_security_role_and_rpc_hardening.sql:1`
- **Done when:** Every SECURITY DEFINER function pins search_path, checks membership for tenant data, and EXECUTE is revoked where not needed. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-006-APP: The anon role cannot read or write tenant data

- **Requirement:** SEC-002-006 (OWASP ASVS 5.0.0 V8.2.1; OWASP ASVS 5.0.0 V8.4.1; OWASP API Security Top 10 2023 API5:2023)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** anon holds table privileges only on site_videos and tenant_legal_pages (published pages only). Other anon access is through SECURITY DEFINER RPCs that take a token/slug (get_invoice_by_link, get_public_contract, sign_contract_in_app, decline_change_order, list_public_booking_slots, create_public_booking_intake, etc.). Their outputs were not inspected field by field, and anon behaviour has not been exercised. Run 2 (2026-11-25): anon was refused (42501 permission denied) on 11 tenant tables. Public token RPCs were not exercised.
- **Fix:** Run TI-012; review each anon RPC's return columns for minimisation; revoke anon EXECUTE on private.* helpers.
- **Done when:** Anon key alone returns no tenant data except deliberately public minimal data; public flows use token-validating RPCs. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-007-APP: Storage objects are tenant-scoped

- **Requirement:** SEC-002-007 (OWASP ASVS 5.0.0 V8.4.1; OWASP ASVS 5.0.0 V8.2.2; OWASP ASVS 5.0.0 V5.3.2)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** business-documents is private with storage.objects policies keyed on private.storage_object_organization_id(name) membership (delete admin-only). documents.storage_path has CHECK private.is_owned_object_path(storage_path, organization_id, 3). isOwnedObjectPath guards every service-role sign/download (tested). Signed URLs are 60s for most paths, 1h for avatars. public-branding is public by design. Behavioural storage test not run. Run 2 (2026-11-25): as Tenant A, listing and updating B's storage.objects metadata returned 0 rows, deleting was refused, and inserting an object under B's folder was refused by storage RLS. Signed URLs and Storage API downloads were not exercised.
- **Fix:** Run TI-010 (list/overwrite/delete/upload into B prefix as A); set allowed_mime_types on business-documents.
- **Files:** `src/lib/tenant-storage-path.ts:1`
- **Done when:** Tenant buckets private; keys start with server-generated org id; storage policies check membership of path org; short signed URLs after authz. Tests: src/lib/tenant-storage-path.test.ts.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-008-APP: Service-role key is server-only and its use is tenant-scoped in code

- **Requirement:** SEC-002-008 (OWASP ASVS 5.0.0 V13.3.2; OWASP ASVS 5.0.0 V8.3.1; NIST CSF 2.0 PR.AA-05)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** getSupabaseAdmin() reads SUPABASE_SECRET_KEY (not NEXT_PUBLIC) and imports 'server-only'. 83 modules call it (list in scratch admin_callers). Spot checks: webhooks resolve org from verified data (Twilio by receiving number, Stripe by connected account cross-check, intake by hashed key); OAuth callback re-checks membership before admin writes; report export uses currentContext().organizationId. Not every one of 83 callers was traced. SUPABASE_SECRET_KEY is targeted to Production and Preview in Vercel.
- **Fix:** Trace and document each getSupabaseAdmin caller's tenant source (reachable unauthenticated? scoped how?) in docs/security; add an ESLint rule that flags admin-client queries without .eq('organization_id', ...).
- **Files:** `src/lib/supabase/admin.ts:1`, `src/lib/job-prepayment-pay.ts:537`, `src/app/api/integrations/google-drive/callback/route.ts:53`
- **Done when:** Service-role key never public; admin client modules server-only; every admin query filtered by server-derived organization_id. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-009-APP: API routes and server actions prevent object-level authorization bypass (BOLA)

- **Requirement:** SEC-002-009 (OWASP API Security Top 10 2023 API1:2023; OWASP ASVS 5.0.0 V8.2.2; OWASP ASVS 5.0.0 V8.3.3; OWASP Top 10:2025 A01:2025)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Spot-checked handlers scope by context: messages/[messageId]/photos filters organization_id = context.organizationId; recordings/[recordingSid] relies on RLS (any of the user's orgs, not only the active one); proposals decision/reconcile and materials-chat use currentContext. RLS backs user-client queries. Service-role handlers were not exhaustively replayed with foreign IDs.
- **Fix:** Add an HTTP-level two-tenant replay suite on a non-production project; scope the recordings lookup to the active organization.
- **Files:** `src/app/api/messages/[messageId]/photos/[index]/route.ts:11`, `src/app/api/twilio/recordings/[recordingSid]/route.ts:24`
- **Done when:** Every handler taking an ID resolves it within the caller's active organization; replay with B IDs gives 404/403. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-015-APP: Inbound webhooks resolve the tenant from verified data

- **Requirement:** SEC-002-015 (OWASP ASVS 5.0.0 V8.3.3; OWASP ASVS 5.0.0 V8.4.1; OWASP API Security Top 10 2023 API10:2023)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Stripe connected-account events (pay links) cross-check event.account against the business's stored account before acting (job-prepayment-pay.ts:537-545). Platform subscription events trust metadata.organization_id first (stripe-subscription.ts:14) - acceptable only because Volteira creates those objects on its own account. Twilio routes resolve the tenant by receiving number after signature verification. No Resend inbound webhook exists. Risk: stripe_account_id is admin-writable in stripe_connect_accounts (unique, so cannot steal a registered account, but can point at an unregistered one).
- **Fix:** Make stripe_connect_accounts service-role-write only; for subscription events prefer stored stripe_subscription_id/customer mapping over metadata; add a signed-event replay test across two tenants.
- **Files:** `src/lib/job-prepayment-pay.ts:537`, `src/lib/stripe-subscription.ts:14`, `src/app/api/twilio/recording/route.ts:60`
- **Done when:** Stripe by connected account / stored IDs, Twilio by owned number, Resend by stored message ID; metadata org ids cross-checked. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-007-002-APP: Tenant identity is derived server-side and re-checked on every tool call

- **Requirement:** SEC-007-002 (OWASP ASVS 5.0.0 V8.3.2; OWASP ASVS 5.0.0 V8.4.1; OWASP MCP Top 10 2025 (beta) MCP07:2025)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** organizationId comes from the signed token; each business request runs authorizeBusinessMcpConnection (credential row scoped by id AND organization_id, not revoked, not expired, creator still role=owner). The acting user (connectedBy) is taken from the credential row, never from arguments. Unit tests prove the decision function and some per-tool scoping (text history, change orders). No end-to-end two-tenant test across every MCP tool exists. Minor gaps: credential re-reads by id only at src/lib/mcp-business-tools.ts:767 and :1000; booking-scope tokens (voice) have no revocation check (1-hour TTL only).
- **Fix:** Add a two-tenant harness (synthetic Tenant A/B, owner/office/technician each, seeded customers/jobs/invoices/files) that calls every tool in tools/list with Tenant A's session and Tenant B ids/names/numbers and asserts no read or write crosses. Add .eq('organization_id', ...) to the credential lookups at mcp-business-tools.ts:767 and :1000.
- **Files:** `src/app/api/mcp/[token]/route.ts:86`, `src/lib/mcp-business-authorization.ts:32`, `src/lib/mcp-business-tools.ts:767`, `src/lib/mcp-business-tools.ts:1000`
- **Done when:** Organization and acting user come only from the stored connection; each call re-verifies the connection is live and its creator still a member with the needed role; a two-tenant test proves Tenant A's connection cannot touch Tenant B data. Tests: src/lib/mcp-business-authorization.test.ts.
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-SEC-007-004-APP: MCP and AI data access follows least privilege

- **Requirement:** SEC-007-004 (OWASP Top 10 for LLM Applications 2025 LLM06:2025; OWASP MCP Top 10 2025 (beta) MCP02:2025; OWASP ASVS 5.0.0 V8.4.1)
- **Observed:** YELLOW, severity critical, confidence medium
- **Problem:** Every MCP tool runs on the service-role client (getSupabaseAdmin) and relies on hand-written .eq('organization_id', ...) filters. Reads reviewed are scoped; some follow-up writes filter by row id only after an org-scoped read (e.g. supplier_orders updates at src/lib/mcp-supplier-order-tools.ts:136,181,185; contracts updates at src/lib/mcp-business-tools.ts:1152,1184; messages update in src/lib/customer-text.ts). No tool exposes SQL, arbitrary fetch, files or shell. Tests prove org scoping only for some tool families (text history, change orders, supervised).
- **Fix:** Prefer a short-lived JWT for the connecting owner so RLS applies; otherwise add organization_id to every update/delete in MCP handlers (defence in depth) and add a lint/grep check in CI that flags .from(...) chains in src/lib/mcp-*.ts without organization_id. Cover each tool family with a cross-business test.
- **Files:** `src/app/api/mcp/[token]/route.ts:76`, `src/lib/mcp-supplier-order-tools.ts:136`, `src/lib/mcp-supplier-order-tools.ts:181`, `src/lib/mcp-business-tools.ts:1152`, `src/lib/mcp-business-tools.ts:767`
- **Done when:** Tools use RLS-scoped clients or, where the service role is unavoidable, every query is filtered by the connection's organization_id with tests proving it; no generic SQL/HTTP/file/shell tool. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-SEC-007-010-APP ⚖️: Consent and opt-out rules are enforced inside AI and MCP tools

- **Requirement:** SEC-007-010 (OWASP Top 10 for LLM Applications 2025 LLM06:2025; OWASP ASVS 5.0.0 V2.3.2)
- **Observed:** YELLOW, severity critical, confidence high
- **Problem:** STOP is enforced centrally: sendSms reads messaging_consent and refuses via textRefusal before the private postSms; every MCP, assistant, executor and SMS-intake send path goes through sendSms (customer-text.ts, invoice-delivery.ts, sms-intake-runner.ts). The supervised executor additionally defers during quiet hours (tested). Direct MCP sends (send_text, send_invoice, send_estimate, send_contract_for_signature, bill_job) and the assistant's confirmed sends do not check quiet hours. No MCP/AI tool writes messaging_consent opt-ins (update_customer has no consent fields). By design textRefusal treats a missing consent record as allowed (only STOP refuses).
- **Fix:** Apply evaluateQuietHours inside sendCustomerText (or sendSms for non-reply sends) so MCP and assistant sends are deferred or refused in quiet hours like the executor; have counsel confirm whether 'no record = allowed' is acceptable for transactional texts; add a test that an MCP send_text during quiet hours is not sent.
- **Files:** `src/lib/twilio.ts:270`, `src/lib/messaging-rules.ts:101`, `src/lib/customer-text.ts:39`, `src/lib/mcp-business-tools.ts:711`, `src/lib/supervised-executor.ts:63`
- **Done when:** Any tool that messages a customer checks consent, STOP and quiet hours at send time through the same gate as the UI; tools cannot record consent without evidence. Tests: src/lib/sms-consent.test.ts, src/lib/messaging-rules.test.ts.
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-CA-001-004-APP ⚖️: Service provider/contractor contract terms with tenants

- **Requirement:** CA-001-004 (Cal. Civ. Code 1798.100(d), 1798.140(ag)(1), 1798.140(j)(1); 11 CCR 7051)
- **Observed:** RED, severity high, confidence medium
- **Problem:** There is no tenant agreement: signup and onboarding present no terms (no 'terms'/'agree' in src/app/signup or src/app/onboarding), and no DPA exists in the repository.
- **Fix:** Draft tenant terms with a CCPA service-provider addendum and require acceptance at signup.
- **Files:** `src/app/signup`, `src/app/onboarding`
- **Done when:** Tenant agreement/DPA with CCPA service-provider terms. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-001-005-APP ⚖️: Subprocessor flow-down and third-party contracts (Stripe, Twilio, Resend, AI vendors, hosting)

- **Requirement:** CA-001-005 (Cal. Civ. Code 1798.140(ag)(2), 1798.100(d); 11 CCR 7051, 7053)
- **Observed:** RED, severity high, confidence medium
- **Problem:** No subprocessor list exists; the tenant privacy policy names only a carrier and software/hosting/database providers while the code uses Twilio, Stripe, Resend, xAI, Anthropic, Google APIs and Vercel.
- **Fix:** Publish a subprocessor list and file each vendor's DPA (including AI no-training terms).
- **Files:** `src/app/legal/[org]/privacy/page.tsx:82-87`
- **Done when:** Subprocessor list with role and data categories; written flow-down contracts. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-002-001-APP ⚖️ ❔: CalOPPA applicability: Shadam and each tenant website operator

- **Requirement:** CA-002-001 (Cal. Bus. & Prof. Code 22575, 22577)
- **Observed:** RED, severity high, confidence high
- **Problem:** A tenant template exists (/legal/[org]/privacy, filled from tenant_legal_pages). Volteira's own site and app (front page, signup, login, app shell) have no privacy policy at all, though signup collects owner names and emails. There is no footer slot; the tenant policy is linked only inside the SMS checkbox text.
- **Fix:** Publish a Shadam/Volteira privacy policy and link it on the front page, signup and app; add a persistent privacy footer link on every tenant public page.
- **Files:** `src/app/legal/[org]/privacy/page.tsx`, `src/lib/tenant-legal.ts:33-67`, `src/components/front-page.tsx`, `src/app/signup`
- **Done when:** Identify each property's operator; each posts a CalOPPA policy; Volteira supplies a tenant template and an unremovable footer slot. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-002-002-APP ❔: Conspicuously post privacy policy (website and online service/app)

- **Requirement:** CA-002-002 (Cal. Bus. & Prof. Code 22575(a), 22577(b))
- **Observed:** RED, severity high, confidence high
- **Problem:** Volteira's homepage, signup and app have no privacy link. The tenant booking page links the policy only in small text inside the optional SMS consent box (public-booking-flow.tsx:533-538), not as a conspicuous page-level link.
- **Fix:** Add a conspicuous 'Privacy Policy' link to every page footer and at signup/sign-in.
- **Files:** `src/components/public-booking-flow.tsx:533-538`, `src/components/front-page.tsx`
- **Done when:** Policy conspicuously linked from the homepage/first significant page and reasonably accessible in the app. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-003-003-APP ⚖️ ❔: Contracts requiring third parties to maintain reasonable security

- **Requirement:** CA-003-003 (Cal. Civ. Code 1798.81.5(c))
- **Observed:** RED, severity high, confidence medium
- **Problem:** No tenant agreement exists in the product; vendor contracts are not documented in the repository.
- **Fix:** Put security clauses in tenant terms and file vendor DPAs.
- **Files:** `src/app/signup`
- **Done when:** Contracts requiring third parties to maintain reasonable security (tenant agreement and subprocessor contracts). Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-004-008-APP ❔: Incident response plan and breach decision log

- **Requirement:** CA-004-008 (Supports Cal. Civ. Code 1798.82 timing and content duties)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan or incident log exists.
- **Fix:** Write, adopt and test an incident response plan with a decision log.
- **Files:** `docs/security`
- **Done when:** Incident response plan with roles, clocks, templates, annual test, and an incident decision log. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-009-001-APP ⚖️ ❔: Unfair Competition Law: no unlawful, unfair or fraudulent business practices

- **Requirement:** CA-009-001 (Cal. Bus. & Prof. Code 17200, 17204, 17206)
- **Observed:** RED, severity high, confidence medium
- **Problem:** Several register violations identified in this slice are UCL 'unlawful' predicates: payments requestable/collectable ahead of work contrary to B&P 7159.5 (CSLB-004-004, CSLB-005-001), diagnostic credit wording that is unconditional while the MCP invoice path does not apply it (CA-009-004), and missing subscription renewal disclosures/consent (FED-009-001/002).
- **Fix:** Resolve the linked RED findings; treat this finding as closed when they are.
- **Files:** `src/lib/job-prepayment-pay.ts:730`, `src/app/jobs/[jobId]/invoice-actions.ts:168`, `src/lib/mcp-business-tools.ts:618`, `src/app/account/actions.ts:384`
- **Done when:** No unlawful, unfair or fraudulent practices; violations of other register items are potential UCL violations. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-CA-009-004-APP ⚖️ ❔: Representing the diagnostic fee and its credit toward approved work

- **Requirement:** CA-009-004 (Cal. Civ. Code 1770(a)(13), (a)(14), (a)(17), (a)(29); Cal. Bus. & Prof. Code 17500)
- **Observed:** RED, severity high, confidence high
- **Problem:** Credit is applied once and shown as 'Diagnostic fee already paid' (tested). But: (1) the Stripe Checkout line always says 'Diagnostic fee is credited toward approved repair work' and the /booking/[token] page always shows creditedNote, even when the business set credit_diagnostic_to_repair=false (the booking form honours the setting, so the customer sees contradictory terms); (2) no wording states the fee is charged whether or not further work is approved, nor any time window or that the credit is not cash-refundable; (3) the cancellation term says the business 'may retain' a fee, without saying when; (4) the MCP create_invoice tool builds invoices with invoiceTotals({subtotalCents}) and no diagnostic credit, so an invoice created that way omits the promised credit.
- **Fix:** Drive every credit statement (Checkout description, booking page, confirmation) from credit_diagnostic_to_repair and a stated window; add 'This fee is charged whether or not you approve further work' and 'credit is not refundable as cash' beside the price; state the exact cancellation cutoff; make mcp create_invoice call diagnosticCreditLeft like raiseInvoice. Add a test that an MCP-created invoice for a credited job carries the credit.
- **Files:** `src/lib/booking-checkout.ts:150`, `src/lib/booking-page-copy.ts:48`, `src/app/booking/[token]/page.tsx:275`, `src/components/public-booking-flow.tsx:484`, `src/components/public-booking-flow.tsx:505`, `src/lib/mcp-business-tools.ts:618`
- **Done when:** Full fee shown before booking; plain statement it is charged whether or not work is approved; credit conditions (which work, time window, not cash-refundable) stated; credit shown as a separate line and never applied twice. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-CSLB-001-006-APP ❔: Tenant onboarding license verification

- **Requirement:** CSLB-001-006 (Recommended control supporting Cal. Bus. & Prof. Code §§ 7028, 7031, 7030.5)
- **Observed:** RED, severity high, confidence high
- **Problem:** License number is an optional free-text field (max 60 chars, placeholder 'CSLB #1162180') with no format check, no lookup, no status or verification date.
- **Fix:** Add a license verification record (number, legal name, status, classes, expiry, bond, WC, CGL, verified_at, source) captured by an operator or lookup, re-checked monthly and on edit.
- **Files:** `src/app/settings/business/actions.ts:81`, `src/components/business-details-form.tsx:88`
- **Done when:** License verified against CSLB at onboarding and periodically, with status/classifications/expiry/bond/WC and verification date stored; stored number rendered. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-002-002-APP ⚖️: Different contract rules per contract type are applied

- **Requirement:** CSLB-002-002 (Cal. Bus. & Prof. Code §§ 7159, 7159.10-7159.14, 7164; Cal. Civ. Code §§ 1689.5-1689.15)
- **Observed:** RED, severity high, confidence high
- **Problem:** Single rule set and template for all work; no distinction possible.
- **Fix:** Implement per-type templates and rules keyed on the classification from CSLB-002-001.
- **Files:** `src/lib/contract-template.ts:193`, `src/app/jobs/[jobId]/contract-actions.ts:190`
- **Done when:** Distinct rule sets per type (7159 regime, 7159.10-14 service-and-repair, commercial/new-construction, subcontract); commercial template never used for residential work. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-002-003-APP ⚖️: Service and repair contract: definition and qualifying conditions

- **Requirement:** CSLB-002-003 (Cal. Bus. & Prof. Code § 7159.10)
- **Observed:** RED, severity high, confidence high
- **Problem:** No service-and-repair template or customer-initiated flag; small diagnostic-fee jobs get the generic WORK AGREEMENT lacking 7159.10 content.
- **Fix:** Add a service-and-repair template with eligibility checks (price, customer-initiated flag) and automatic conversion to the 7159 template when a condition fails.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/contract-template.ts:143`
- **Done when:** Service-and-repair template offered only when price <= $750, customer-initiated and other conditions met; otherwise 7159 contract. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-002-APP: Writing must be legible and printed forms readable; minimum type sizes

- **Requirement:** CSLB-003-002 (Cal. Bus. & Prof. Code § 7159(c)(1)-(2))
- **Observed:** RED, severity high, confidence high
- **Problem:** Rendered synthetic contract: body 10pt (meets minimum). Headings: only blocks the heuristic recognises are bold (11pt). In the default template each heading sits in the same block as its text (e.g., 'PRICE\nTotal: ...'), so SCOPE OF WORK, PRICE, PAYMENT, ACCESS AND CONDITIONS and PAYMENT SCHEDULE render as 10pt regular; only WORK AGREEMENT is bold. Section labels (CUSTOMER/JOB, SIGNATURES) are 8pt, the footer with the license number is 8pt, the fingerprint 7pt. Arimo is embedded; an unembedded Helvetica resource is also present.
- **Fix:** Render headings as explicit structured elements (not a text heuristic) at >=10pt bold; raise section labels to >=10pt; render statutory notices from a fixed component with their own sizes; remove the stray Helvetica.
- **Files:** `src/lib/contract-layout.ts:21`, `src/lib/pdf/contract-document.tsx:79`, `src/lib/pdf/contract-document.tsx:89`, `src/lib/pdf/letterhead.tsx:80`, `src/lib/pdf/letterhead.tsx:103`
- **Done when:** Body text at least 10pt and headings at least 10pt bold on the printed page; fonts embedded. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-004-APP: First page shows buyer's signing date and contractor's cancellation address with lead-in statement

- **Requirement:** CSLB-003-004 (Cal. Bus. & Prof. Code § 7159(c)(3)(B))
- **Observed:** RED, severity high, confidence high
- **Problem:** Rendered synthetic contract: page 1 shows contract date and the business base address in the letterhead, but the buyer signing date prints only in the signature block, which falls on page 2; there is no 'Notice of Cancellation may be sent to the contractor at the address noted' statement.
- **Fix:** Add a page-1 block (body type size) with buyer signing date (stamped at signing) and the cancellation address with the statutory lead-in.
- **Files:** `src/lib/pdf/contract-document.tsx:79`, `src/lib/pdf/letterhead.tsx:121`, `src/lib/pdf/contract-document.tsx:253`
- **Done when:** Page 1 shows buyer's signing date and the contractor's cancellation mailing address preceded by the statutory lead-in. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-005-APP: Statement that a full unconditional lien release will be furnished after each satisfactory payment

- **Requirement:** CSLB-003-005 (Cal. Bus. & Prof. Code § 7159(c)(4); Cal. Civ. Code §§ 8400, 8404)
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`
- **Done when:** Statement that a full unconditional lien release will be furnished after each satisfactory payment. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-007-APP: Notice of owner's right to require a performance and payment bond

- **Requirement:** CSLB-003-007 (Cal. Bus. & Prof. Code § 7159(c)(6))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; the signature block text is only 'By signing below both parties agree to the work and the price set out above.' (not shown once signed).
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it. Place the bond notice immediately above the signature lines.
- **Files:** `src/lib/contract-layout.ts:94`, `src/lib/contract-template.ts:193`
- **Done when:** In close proximity to the signatures, a notice that the owner or tenant may require a performance and payment bond (B&P 7159(c)(6); no type-size rule). Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-011-APP: 'Home Improvement' heading identifying the contract type

- **Requirement:** CSLB-003-011 (Cal. Bus. & Prof. Code § 7159(d)(3))
- **Observed:** RED, severity high, confidence high
- **Problem:** Rendered document title is 'CONTRACT' and the body heading 'WORK AGREEMENT'; no 'Home Improvement' heading.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/pdf/contract-document.tsx:192`
- **Done when:** 10pt bold heading 'Home Improvement' identifying the contract type. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-012-APP: Statement: entitled to a completely filled-in copy (all blanks filled)

- **Requirement:** CSLB-003-012 (Cal. Bus. & Prof. Code § 7159(d)(4))
- **Observed:** RED, severity high, confidence high
- **Problem:** Statement missing. Partial control: unfilled placeholders block signing (sign_contract_in_app requires cardinality(unfilled)=0, inspected), but fields the default template never asks for (dates, materials, insurance) are not required, and job_date falls back to 'a date to be agreed'.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it. Make all 7159 required fields mandatory before send.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/contract-signing.ts:156`, `src/app/jobs/[jobId]/contract-actions.ts:390`
- **Done when:** 12pt bold 'completely filled in copy' statement; refuse issuance while required fields are blank. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-015-APP: Description of the project and significant materials and equipment

- **Requirement:** CSLB-003-015 (Cal. Bus. & Prof. Code § 7159(d)(7))
- **Observed:** RED, severity high, confidence high
- **Problem:** Heading is 'SCOPE OF WORK'. The scope generators deliberately exclude materials (plainScope: 'materials are never named to the customer'; scopePrompt: 'Do not list part numbers'). Empty scope does leave {{scope}} unfilled, which blocks signing.
- **Fix:** Use the statutory heading and print significant materials/equipment (make/model/amperage) from job lines under it.
- **Files:** `src/lib/contract-template.ts:199`, `src/lib/contract-template.ts:282`, `src/lib/contract-template.ts:231`
- **Done when:** Heading 'Description of the Project and Description of the Significant Materials to be Used and Equipment to be Installed' with scope and significant materials/equipment; empty scope blocks issuance. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-018-APP: Substantial commencement statement and Approximate Start Date

- **Requirement:** CSLB-003-018 (Cal. Bus. & Prof. Code § 7159(d)(10))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; the template only says 'scheduled for {{job_date}}', which falls back to 'a date to be agreed'.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it. Require an approximate start date.
- **Files:** `src/lib/contract-template.ts:193`, `src/app/jobs/[jobId]/contract-actions.ts:400`
- **Done when:** Statement of what constitutes substantial commencement; 'Approximate Start Date' heading and date. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-019-APP: Approximate Completion Date

- **Requirement:** CSLB-003-019 (Cal. Bus. & Prof. Code § 7159(d)(11))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; no completion date field and the scope prompt forbids promising a completion date.
- **Fix:** Add a required approximate completion date and heading.
- **Files:** `src/lib/contract-template.ts:193`, `src/lib/contract-template.ts:240`
- **Done when:** 'Approximate Completion Date' heading and date. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-021-APP: Note about Extra Work and Change Orders

- **Requirement:** CSLB-003-021 (Cal. Bus. & Prof. Code § 7159(d)(13))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; the template only says extra work 'will be quoted separately and will not begin without your approval'.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:209`, `src/lib/contract-template.ts:193`
- **Done when:** 'Note about Extra Work and Change Orders' heading and statutory statement. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-022-APP ⚖️: Commercial General Liability Insurance (CGL) notice

- **Requirement:** CSLB-003-022 (Cal. Bus. & Prof. Code § 7159(e)(1))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; no CGL data is stored.
- **Fix:** Store CGL status/insurer/phone per tenant and render the matching statutory statement.
- **Files:** `src/lib/contract-template.ts:193`, `src/app/settings/business/actions.ts:81`
- **Done when:** 'Commercial General Liability Insurance (CGL)' notice with the correct statement from stored tenant data; never defaults to 'carries insurance'. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-023-APP: Workers' Compensation Insurance notice

- **Requirement:** CSLB-003-023 (Cal. Bus. & Prof. Code § 7159(e)(2))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing; no workers' compensation data is stored.
- **Fix:** Store WC status from verification and render the matching statement.
- **Files:** `src/lib/contract-template.ts:193`, `src/app/settings/business/actions.ts:81`
- **Done when:** 'Workers' Compensation Insurance' notice matching the CSLB record. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-024-APP: Notice about extra/change-order work (buyer's rights)

- **Requirement:** CSLB-003-024 (Cal. Bus. & Prof. Code § 7159(e)(3))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`
- **Done when:** Notice of buyer's rights regarding extra/change-order work. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-026-APP ⚖️: Information about the Contractors State License Board (CSLB) notice

- **Requirement:** CSLB-003-026 (Cal. Bus. & Prof. Code § 7159(e)(5))
- **Observed:** RED, severity high, confidence high
- **Problem:** Missing. The default STARTER_TEMPLATE (WORK AGREEMENT / SCOPE OF WORK / PRICE / PAYMENT / ACCESS AND CONDITIONS) and the rendered synthetic contract contain no such text; the app has no fixed statutory block it appends, so tenant templates are rendered verbatim with nothing added.
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`
- **Done when:** 12pt 'Information about the Contractors State License Board (CSLB)' notice. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-028-APP ⚖️ ❔: Electronic signature and electronic delivery of the contract copy

- **Requirement:** CSLB-003-028 (Cal. Civ. Code §§ 1633.1-1633.17 (Uniform Electronic Transactions Act); Cal. Bus. & Prof. Code § 7159)
- **Observed:** YELLOW, severity high, confidence medium
- **Problem:** Consent checkbox required server-side; audit trail (time, IP, UA, body hash) frozen by trigger but deletable with the contract (RLS ALL, admin deletion functions); no Notice of Cancellation exists to evaluate; consent not stored.
- **Fix:** Store consent; protect signed rows from deletion; obtain the legal opinion once notices exist.
- **Files:** `src/app/contract/[token]/actions.ts:89`, `supabase/migrations/20260927120000_contract_signatures.sql:266`, `supabase/migrations/20260812000000_contracts.sql:78`
- **Done when:** UETA agreement captured before e-signing; legal confirmation of electronic copy and Notice of Cancellation; audit trail retained. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-003-032-APP: Subcontractor-use disclosure checkbox (B&P 7159(c)(7))

- **Requirement:** CSLB-003-032 (Cal. Bus. & Prof. Code § 7159(c)(7))
- **Observed:** RED, severity high, confidence high
- **Problem:** Not present: the default template and the rendered synthetic contract (evidence/contracts-default-contract-synthetic.txt) contain no subcontractor-use checkbox or disclaimer, and change orders carry none.
- **Fix:** Add the 7159(c)(7) checkbox and disclaimer to the locked California home-improvement statutory block and to change orders, wording verbatim after legal sign-off.
- **Files:** `src/lib/contract-layout.ts:94`, `src/lib/contract-template.ts:193`
- **Done when:** Contract and change orders carry the 7159(c)(7) subcontractor-use Yes/No checkbox and disclaimer. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-005-003-APP ❔: Overbilling guard

- **Requirement:** CSLB-005-003 (Recommended control supporting Cal. Bus. & Prof. Code § 7159.5)
- **Observed:** RED, severity high, confidence high
- **Problem:** Pay links are capped at the plan total (payLinkCents) and an invoice payment cannot exceed what is owed (tested), but no guard compares cumulative billing to work completed: typed invoice amounts (raiseInvoice, MCP create_invoice) are unbounded by contract price or line values, and dated installments ignore progress. No test covers an overbilling guard.
- **Fix:** Add a server-side guard (and money-rule test) that refuses or requires owner override with reason when cumulative invoices + prepayments on a job would exceed deposit + completed-phase value or contract price + approved change orders.
- **Files:** `src/app/jobs/[jobId]/invoice-actions.ts:78`, `src/lib/mcp-business-tools.ts:603`, `src/lib/payment-plan.ts:152`
- **Done when:** Cumulative invoiced/collected never exceeds down payment + value of completed phases, and never exceeds contract price + signed change orders; blocked or flagged. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-CSLB-006-002-APP: Change order contents: scope, price change, effect on payments/schedule

- **Requirement:** CSLB-006-002 (Cal. Bus. & Prof. Code § 7159(d)(13), (e)(3))
- **Observed:** RED, severity high, confidence high
- **Problem:** changeOrderDocument prints what is changing, items and price lines with cents and the revised total, then 'Everything else that was agreed stays the same' - it never states the effect on the payment schedule or completion date.
- **Fix:** Add a required 'Effect on schedule of payments and completion date' section computed from the recalculated plan.
- **Files:** `src/lib/change-order-document.ts:51`, `src/lib/change-order-document.ts:100`
- **Done when:** Each change order states scope, amount added/subtracted in dollars and cents, and the effect on progress payments and/or completion date. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-007-006-APP ⚖️ ❔: Cancellation right continues until compliant notice is given

- **Requirement:** CSLB-007-006 (Cal. Civ. Code §§ 1689.6, 1689.7 (verify))
- **Observed:** RED, severity high, confidence high
- **Problem:** No notion of cancellability; contracts without notices are presented as final.
- **Fix:** Flag every signed residential contract lacking the notice as 'cancellation right open' on the job.
- **Files:** `src/app/jobs/[jobId]/contract-actions.ts:190`
- **Done when:** Contracts missing a compliant notice treated as cancellable and surfaced to the tenant. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-008-006-APP: Lien release statement in home improvement contracts

- **Requirement:** CSLB-008-006 (Cal. Bus. & Prof. Code § 7159(c)(4))
- **Observed:** RED, severity high, confidence high
- **Problem:** Absent (see CSLB-003-005).
- **Fix:** Add a non-removable, versioned California home-improvement statutory block (rendered by ContractDocument, not part of the editable template) that is selected by contract type, with text taken verbatim from the official code after legal sign-off; refuse to issue a home-improvement contract whose template would omit it.
- **Files:** `src/lib/contract-template.ts:193`
- **Done when:** Lien release statement in home-improvement contracts. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-009-001-APP: License number on all contracts, bids and advertising

- **Requirement:** CSLB-009-001 (Cal. Bus. & Prof. Code § 7030.5)
- **Observed:** YELLOW, severity high, confidence medium
- **Problem:** Contracts and change orders (same ContractDocument) and invoices print it in the letterhead and footer when set (rendered synthetic contract shows 'Lic. 0000000' twice). It is optional and omitted silently when empty; estimates, booking pages and outbound marketing were not verified in this slice.
- **Fix:** Make license number mandatory and render it on estimates, booking pages, website footer and marketing templates; add a check that every outbound template includes it.
- **Files:** `src/lib/pdf/letterhead.tsx:121`, `src/lib/pdf/letterhead.tsx:222`
- **Done when:** License number on estimates, contracts, change orders, websites, booking pages and marketing messages. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-009-002-APP: Unlicensed persons may not advertise contracting services

- **Requirement:** CSLB-009-002 (Cal. Bus. & Prof. Code § 7027.1)
- **Observed:** RED, severity high, confidence medium
- **Problem:** No verification exists (CSLB-001-006), so publication cannot depend on it.
- **Fix:** Gate public booking/website publication on a current verification.
- **Files:** `src/app/settings/business/actions.ts:81`
- **Done when:** No public booking/website page published for a tenant whose license is not verified. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-012-006-APP: Keep contract and transaction records for at least five years

- **Requirement:** CSLB-012-006 (Cal. Bus. & Prof. Code § 7111)
- **Observed:** RED, severity high, confidence high
- **Problem:** Signed contracts and their documents can be deleted by any org member through RLS (contracts_member_write FOR ALL) and by admin_delete_record / delete_job_records / wipe_organization_data with no retention check (inspected live); documents cascade on contract and organization deletion.
- **Fix:** Add a retention policy: refuse deletion of signed contracts, change orders and payment records within five years of job completion (DB trigger), and route data-removal requests through a retention check.
- **Files:** `supabase/migrations/20260812000000_contracts.sql:78`, `supabase/migrations/20261105010000_admin_data_removal.sql:119`, `supabase/migrations/20261105010000_admin_data_removal.sql:212`
- **Done when:** Executed contracts, change orders, notices, audit trails, invoices, payments, refunds retained >= 5 years after completion and producible. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CSLB-012-009-APP ❔: Immutable executed contract PDFs

- **Requirement:** CSLB-012-009 (Recommended control supporting Cal. Bus. & Prof. Code §§ 7159, 7111)
- **Observed:** RED, severity high, confidence high
- **Problem:** Body, signature fields and total/deposit are frozen by triggers (inspected live). Not frozen: payment_schedule column; the signed PDF, which rebuildContractPdf (no signed check) re-renders with current letterhead/customer/job data and files as the new current version; the documents row (members may update, admins delete); and the contract row itself (deletable).
- **Fix:** Freeze payment_schedule; snapshot all printed data at signing; store the signed PDF hash and make that document row immutable; refuse re-render/delete of signed contracts.
- **Files:** `src/app/jobs/[jobId]/contract-actions.ts:556`, `src/lib/pdf/contract-data.ts:99`, `src/lib/pdf/contract-data.ts:25`, `supabase/migrations/20260927120000_contract_signatures.sql:130`, `supabase/migrations/20260812000000_contracts.sql:78`
- **Done when:** Executed PDF and hash stored immutably; later edits do not alter the executed document; amendments only via signed change orders. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-001-002-APP: Obtain consumer's affirmative consent to electronic records before using them to satisfy a writing requirement

- **Requirement:** FED-001-002 (15 U.S.C. 7001(c)(1)(A))
- **Observed:** YELLOW, severity high, confidence high
- **Problem:** Checkbox starts unchecked (useState(false)) and the server action refuses without consent=on, so an affirmative act is required. The consent is not stored as its own event: no version, no timestamp distinct from signed_at, no withdrawal state anywhere in the schema.
- **Fix:** Create an esign_consents record (customer, organization, version, timestamp, IP/UA, scope, withdrawn_at) written in the same transaction as the signature; check withdrawn_at before sending any e-record.
- **Files:** `src/components/signature-pad.tsx:91`, `src/components/signature-pad.tsx:64`, `src/app/contract/[token]/actions.ts:89`
- **Done when:** Unchecked consent checkbox the consumer must tick; consent event stored with disclosure version and timestamp; withdrawn consent honored. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-001-010-APP: Retained electronic records must accurately reflect the information and remain accessible for the required retention period

- **Requirement:** FED-001-010 (15 U.S.C. 7001(d)(1)-(3))
- **Observed:** RED, severity high, confidence high
- **Problem:** Body and signature fields are frozen by keep_signed_contract_text and figures by keep_signed_contract_figures (inspected live). But: (1) contracts_member_write is FOR ALL, so any org member can DELETE a signed contract through the API; (2) admin_delete_record, delete_job_records and wipe_organization_data delete signed contracts and their documents with no retention check, and documents cascade on contract delete; (3) payment_schedule is not covered by any freeze trigger; (4) rebuildContractPdf re-renders a signed contract with the current letterhead (name, address, license, phone are looked up fresh) and files it as the new current version; documents rows are updatable by members.
- **Fix:** Add a BEFORE DELETE trigger on contracts refusing rows with signed_at (and their documents) unless a retention-expiry/legal-approved path is used; extend keep_signed_contract_figures to payment_schedule; snapshot the letterhead/customer/job blocks into the contract at signing and render signed copies only from that snapshot; refuse rebuildContractPdf for signed contracts (or render the frozen copy); make the signed PDF document row immutable.
- **Files:** `supabase/migrations/20260812000000_contracts.sql:78`, `supabase/migrations/20261105010000_admin_data_removal.sql:119`, `supabase/migrations/20261105010000_admin_data_removal.sql:212`, `src/lib/pdf/contract-data.ts:99`, `src/app/jobs/[jobId]/contract-actions.ts:556`, `supabase/migrations/20260927120000_contract_signatures.sql:130`, `src/lib/pdf/contract-data.ts:25`
- **Done when:** Signed records retained accurately, accessible and protected from alteration for the full retention period. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-002-014-APP ❔: A2P 10DLC brand and campaign registration (carrier requirement)

- **Requirement:** FED-002-014 (US wireless carrier A2P 10DLC program via The Campaign Registry; Twilio Messaging Policy / Acceptable Use Policy)
- **Observed:** RED, severity high, confidence high
- **Problem:** Production messaging_settings shows a campaign id and brand but a2p_registered_at is NULL, and 4 outbound texts exist. a2p_registered_at only drives a settings-page banner (settings/notifications/page.tsx:58); sendSms/sendCustomerText never check it. The filed campaign describes one opt-in path (booking checkbox) and no embedded links (docs/a2p-10dlc-campaign-resubmission.md:30-38), but the app also texts on owner-entered ('admin'), inbound-text and verbal consent, and sends links (invoice pay links invoice-messages.ts:93-95, signing links, estimate links).
- **Fix:** Block customer sends in sendSms until the tenant's campaign is approved (a2p_registered_at set); update the campaign to describe every opt-in path and the embedded-link content, or remove those paths.
- **Files:** `src/app/settings/notifications/page.tsx:41-58`, `src/lib/twilio.ts:259-277`, `src/lib/invoice-messages.ts:88-101`, `docs/a2p-10dlc-campaign-resubmission.md:30-38`, `src/lib/manual-sms-consent.ts:278-326`
- **Done when:** Each tenant brand and campaign registered and approved before sending, with traffic consistent with the registered use case. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-004-001-APP ⚖️: Privacy, security and AI representations must be truthful and substantiated (FTC Act section 5 deception)

- **Requirement:** FED-004-001 (15 U.S.C. 45(a))
- **Observed:** RED, severity high, confidence high
- **Problem:** The tenant privacy policy states 'We text you only if you asked us to, by ticking the optional... box' and 'Booking by phone does not sign you up for text messages' (privacy/page.tsx:62-73), but the app records consent automatically when staff enter a number ('admin'), when a phone caller asks for a link ('verbal', booking-notifications.ts:287), and texts customers with no consent record at all (messaging-rules.ts:101). It says the only recipients are the messaging carrier and software/hosting/database providers acting under contract (82-87), omitting Stripe, Resend, xAI (live call audio), Anthropic, and Google APIs. The AI receptionist presents as 'Maya' and discloses it is virtual only if sincerely asked (grok-voice.ts:197; sms-intake.ts:689).
- **Fix:** Rewrite the policy to describe every consent path and every vendor category actually used, or change the code to match the policy; add an automated check that the policy's vendor list matches the configured integrations.
- **Files:** `src/app/legal/[org]/privacy/page.tsx:62-73`, `src/app/legal/[org]/privacy/page.tsx:82-87`, `src/lib/manual-sms-consent.ts:278-326`, `src/lib/booking-notifications.ts:287`, `src/lib/messaging-rules.ts:101-108`, `src/lib/grok-voice.ts:197`
- **Done when:** Every privacy, security and AI statement matches actual practice. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-006-002-APP: Retain tax records as long as material; use IRS period-of-limitations guidance by record type (not a universal 7-year rule)

- **Requirement:** FED-006-002 (26 CFR 1.6001-1(e); 26 U.S.C. 6501, 6511; IRS 'How long should I keep records?')
- **Observed:** RED, severity high, confidence high
- **Problem:** No retention rule protects financial records. Row Level Security lets any billing member delete any invoice (sent or paid) directly through the Supabase API, cascading its payments, refunds and revisions; any org member can delete a job, cascading its job_prepayments (money received); an owner can delete the organization, cascading all invoices. The app's delete action refuses only invoices with money against them (src/app/invoices/actions.ts:381); sent unpaid invoices are deletable in-app. No documented retention policy or export-before-closure flow found.
- **Fix:** Replace the invoices DELETE policy with one limited to status='draft' with no payments; add a BEFORE DELETE trigger refusing deletion of sent/paid/void invoices and of jobs with invoices or prepayments; change invoice_payments/invoice_refunds/job_prepayments FKs to ON DELETE RESTRICT; restrict job DELETE to billing editors; replace organization hard delete with a closure flow that exports records and retains them for the documented period. Add a money-rule test for the delete guard.
- **Files:** `src/app/invoices/actions.ts:381`, `src/app/invoices/actions.ts:407`, `supabase/migrations/20261112010000_invoice_refunds.sql`, `supabase/migrations/20261119140000_job_payment_plans.sql`
- **Done when:** Financial records are not auto-deleted or deletable before the applicable IRS period; retention is documented and export is offered before deletion. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-FED-007-003-APP ❔: Never collect or store card numbers outside Stripe (AI chats, SMS, email, MCP, voice AI, notes)

- **Requirement:** FED-007-003 (PCI DSS v4.0.1 Requirements 3 and 4 (protect stored account data; protect cardholder data in transmission))
- **Observed:** YELLOW, severity high, confidence medium
- **Problem:** Voice AI and SMS intake prompts say never ask for card details, and MCP logs mask card numbers (tested). No PAN detection/redaction exists for inbound SMS bodies, job notes, call transcripts or text passed to the model before it is sent to the AI vendor.
- **Fix:** Add a shared Luhn-checked PAN detector; mask matches in inbound SMS before storage and before model calls, in notes and voice transcripts; reply asking the customer to use the pay link. Add a test for the masker.
- **Files:** `src/lib/grok-voice.ts:243`, `src/lib/sms-intake.ts:763`, `src/lib/mcp-log-redaction.ts:15`
- **Done when:** AI and voice assistants never request card numbers; PAN-like strings are redacted in inbound SMS, notes, transcripts and AI logs and not sent to AI vendors. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-FED-007-008-APP ⚖️: TILA/Reg Z: tenant becomes a 'creditor' if it regularly offers consumer credit with a finance charge or payable in more than four installments

- **Requirement:** FED-007-008 (15 U.S.C. 1602(g); 12 CFR 1026.2(a)(17); 12 CFR 1026.17-1026.18)
- **Observed:** RED, severity high, confidence high
- **Problem:** planAmounts accepts any number of deposit/installment items with no limit; nothing caps a plan at four installments (excluding down payment) and nothing flags a tenant who offers more. No finance charge or late fee exists (good). A tenant can therefore create consumer plans 'payable by written agreement in more than four installments' with no TILA disclosures.
- **Fix:** Refuse plans with more than four payments after the down payment (count installment + final) for residential customers unless TILA disclosures are implemented; add a money-rule test.
- **Files:** `src/lib/payment-plan.ts:63`, `src/lib/payment-plan-server.ts:126`, `src/app/jobs/[jobId]/payment-plan-actions.ts:57`
- **Done when:** Installment plans are capped at four installments with no finance charge, or TILA closed-end disclosures are given; tenants crossing TILA triggers are flagged. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-FED-011-002-APP ⚖️: Cooling-Off Rule applicability to in-home contractor sales

- **Requirement:** FED-011-002 (16 CFR 429.0 (definitions); 16 CFR 429.3 (exemptions))
- **Observed:** RED, severity high, confidence high
- **Problem:** Estimates, change orders and contracts can be presented and signed in person at the customer's home on the job page (contract-send.ts:54), but there is no in-home-sale flag, no determination, and no cancellation workflow. The e-sign consent even refers to 'any notice of your right to cancel' (esign-consent.ts:28) that the product never generates.
- **Fix:** Get counsel's determination; add an 'sold at the residence' flag that inserts the cancellation statement and Notice of Cancellation and holds work/payment until the period ends.
- **Files:** `src/lib/contract-send.ts:54`, `src/lib/esign-consent.ts:28`, `src/lib/contract-template.ts:1-40`
- **Done when:** Determine which sales are door-to-door; support a flag for in-home sales that triggers cancellation-notice workflows. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-011-003-APP ⚖️: Cooling-Off Rule: contract/receipt must state the buyer's right to cancel within three business days

- **Requirement:** FED-011-003 (16 CFR 429.1(a))
- **Observed:** RED, severity high, confidence high
- **Problem:** No contract or estimate generated by Volteira contains the cancellation statement; only payment terms and the down-payment notice are added.
- **Fix:** Insert the prescribed statement on in-home sales (FED-011-002) and test its presence and placement.
- **Files:** `src/lib/payment-plan.ts:56-57`, `src/lib/payment-plan.ts:250-256`, `src/lib/contract-template.ts`
- **Done when:** Contract/receipt states the buyer's right to cancel within three business days, near the signature, in 10-point bold. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-011-004-APP ⚖️: Cooling-Off Rule: Notice of Cancellation form in duplicate, oral notice, and timely refunds

- **Requirement:** FED-011-004 (16 CFR 429.1(b)-(g))
- **Observed:** RED, severity high, confidence high
- **Problem:** No Notice of Cancellation form, oral-notice prompt or cancellation-refund workflow exists; refunds are manual (invoice-refund.ts) and not tied to a cancellation deadline.
- **Fix:** Generate a completed Notice of Cancellation with the transaction date and deadline, prompt the technician to give oral notice, and track cancellation refunds against the 10-business-day deadline.
- **Files:** `src/lib/invoice-refund.ts`, `src/lib/contract-signing.ts`
- **Done when:** Notice of Cancellation form in duplicate, oral notice, and refunds within 10 business days of a valid cancellation. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-FED-011-006-APP ❔: No general federal data breach notification law; record sector-specific triggers

- **Requirement:** FED-011-006 (No general federal statute; sector rules include 16 CFR 314.4(j) (Safeguards, if applicable) and card brand/Stripe contractual incident reporting)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan or breach procedure exists in docs/ or docs/security/ (searched for breach/incident).
- **Fix:** Write and test an incident response plan with the CA-004 clocks, tenant notice commitments and vendor contacts.
- **Files:** `docs/security/REMEDIATION.md`, `docs/security/MULTI-TENANT-READINESS.md`
- **Done when:** Incident response plan mapping state breach laws, FTC Safeguards (if applicable), Stripe/PCI reporting and tenant notice timelines. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-SEC-001-001-APP: Multi-factor authentication is available to every user

- **Requirement:** SEC-001-001 (OWASP ASVS 5.0.0 V6.3.3; NIST CSF 2.0 PR.AA-03)
- **Observed:** RED, severity high, confidence high
- **Problem:** No MFA anywhere in the application: no enroll/challenge/verify calls, no aal checks (grep mfa\|totp\|aal over src returns no auth usage). Production auth.mfa_factors has 0 rows. Local supabase/config.toml has [auth.mfa.totp] enroll_enabled = false.
- **Fix:** Enable TOTP (and WebAuthn when available) in Supabase Auth; add an Account > Security enrollment flow using supabase.auth.mfa.enroll/challenge/verify; read the aal claim server-side in currentContext(); nudge enrollment on sign-up and the account page.
- **Files:** `src/app/account/page.tsx:384`, `src/lib/request-context.ts:52`, `supabase/config.toml:317`
- **Done when:** Every user can enroll a TOTP/WebAuthn factor from account settings; AAL checked server-side; MFA encouraged. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-002-019-APP: Automated two-tenant isolation tests run before release

- **Requirement:** SEC-002-019 (OWASP ASVS 5.0.0 V8.4.1; NIST CSF 2.0 ID.IM-02)
- **Observed:** YELLOW, severity high, confidence high
- **Problem:** No such test runs automatically: there is no CI (.github absent) and npm test covers pure functions only. scripts/security/tenant-isolation-test.sql (prior audit) and the new compliance/tests/tenant-isolation/two-tenant-rollback.sql exist but neither has been run in this audit or on a schedule. A repeatable two-tenant test now exists (compliance/tests/tenant-isolation/two-tenant-rollback.sql) and was run on 2026-11-25 (72 passed, 1 failed). It covers 17 tables, the roster RPC and storage as owner and anon, but it is manual, not run before each migration release, and does not cover every table, view, RPC or role.
- **Fix:** Run compliance/tests/tenant-isolation/two-tenant-rollback.sql on a Supabase branch before each release that changes migrations, fail the release on any passed=false row, and keep the output as evidence.
- **Files:** `scripts/security/tenant-isolation-test.sql:1`, `compliance/tests/tenant-isolation/two-tenant-rollback.sql:1`
- **Done when:** Repeatable two-tenant test over every table/view/RPC/bucket as A, B and anon, run before each migration release. Tests: compliance/tests/tenant-isolation/two-tenant-rollback.sql.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-003-012-APP: Mass assignment is prevented

- **Requirement:** SEC-003-012 (OWASP ASVS 5.0.0 V15.3.3; OWASP API Security Top 10 2023 API3:2023)
- **Observed:** YELLOW, severity high, confidence medium
- **Problem:** Reviewed actions copy explicit fields. inviteTeammate takes organizationId from the form but RLS/can_manage_members enforces it. Because authenticated holds UPDATE on all columns, a client calling PostgREST directly can set status/plan on organization_subscriptions and charges_enabled on stripe_connect_accounts (see SEC-002-010).
- **Fix:** Use column-level UPDATE grants or guard triggers for status/total/paid columns on tenant tables.
- **Files:** `src/app/settings/team/actions.ts:41`
- **Done when:** Explicit field copying; organization_id, role, status, totals, paid flags never from client unless authorized. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-003-016-APP: Public and costly endpoints are rate limited

- **Requirement:** SEC-003-016 (OWASP ASVS 5.0.0 V2.4.1; OWASP API Security Top 10 2023 API4:2023; OWASP API Security Top 10 2023 API6:2023)
- **Observed:** RED, severity high, confidence high
- **Problem:** Only AI has a server-side monthly allowance (ai-allowance.ts, 429 in materials-chat). No per-IP or per-token limiter exists for public booking intake, booking holds, website intake, MCP token route, invoice/contract token pages or SMS sends; no alerting when limits hit. The AI allowance itself can be bypassed by an admin flipping organization_subscriptions.status (SEC-002-010).
- **Fix:** Add a shared limiter (e.g. Vercel Firewall rate-limit rules or Upstash/DB token bucket) for public POSTs, token routes, MCP and SMS sends, with alerts; close the subscription-status bypass.
- **Files:** `src/app/api/jobs/[jobNumber]/materials-chat/route.ts:62`, `src/app/api/intake/website/route.ts:38`, `src/app/api/mcp/[token]/route.ts:1`
- **Done when:** Per-IP/tenant/token limits on intake, booking, holds, SMS, AI, Twilio callbacks and MCP; money/message limits enforced and alerting. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-004-001-APP: Production, preview and development environments are separated

- **Requirement:** SEC-004-001 (NIST CSF 2.0 PR.IR-01; OWASP ASVS 5.0.0 V15.2.3)
- **Observed:** RED, severity high, confidence high
- **Problem:** Vercel env names show SUPABASE_SECRET_KEY, TWILIO_AUTH_TOKEN, TWILIO_ACCOUNT_SID, ANTHROPIC_API_KEY, RESEND_API_KEY, MCP_SESSION_SECRET, DOCUMENT_SYNC_ENCRYPTION_KEY and GOOGLE_MAPS_SERVER_KEY targeted to both Production and Preview; only one Supabase project is in use (wyyzptlciccewyxxjkyx), so preview deployments run against production data with the service-role key. Stripe has separate preview keys (integration-managed). Deployment Protection status not inspected.
- **Fix:** Create a non-production Supabase project/branch for Preview, re-scope production-only secrets to Production, use Twilio test credentials in Preview, and confirm Vercel Deployment Protection on previews.
- **Done when:** Preview/dev use non-production Supabase, Stripe test keys and non-production Twilio; production secrets scoped to Production; previews protected. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-004-010-APP: Security monitoring and alerting is in place

- **Requirement:** SEC-004-010 (NIST CSF 2.0 DE.CM-09; NIST CSF 2.0 DE.CM-06; NIST CSF 2.0 DE.AE-02; OWASP ASVS 5.0.0 V16.4.3)
- **Observed:** RED, severity high, confidence medium
- **Problem:** No alerting configuration or log drain is evidenced in the repository; webhook signature failures return 403 without counting/alerting; no documented owner. (Vercel drains not inspected.)
- **Fix:** Configure a Vercel log drain and alerts (signature failures, 5xx spikes, SMS/AI spend), and schedule Supabase advisor review.
- **Done when:** Alerts for runtime errors, auth anomalies, webhook signature failures, SMS/AI spend and advisors to a named person; logs shipped off-platform. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-005-001-APP: Audit events carry actor, tenant, time, resource, action and outcome

- **Requirement:** SEC-005-001 (OWASP ASVS 5.0.0 V16.2.1; OWASP ASVS 5.0.0 V16.2.2; NIST CSF 2.0 PR.PS-04)
- **Observed:** RED, severity high, confidence high
- **Problem:** activity_events has organization_id, actor_user_id, event_type, entity_type/entity_id, created_at, but no actor type, outcome or request id; members can INSERT arbitrary rows (any actor_user_id). supervised_action_audit is the strongest (actor_id, actor_kind, via, from/to status, content_hash). platform_admin_audit lacks outcome. mcp_call_log has is_error/http_status but no actor.
- **Fix:** Define one audit schema (actor_id, actor_type, organization_id, resource, action, outcome, request_id); write it server-side only (revoke INSERT from authenticated, set actor from auth.uid()).
- **Done when:** Audit records carry actor id and type, org, UTC time, resource type/id, action, outcome and correlation id; human and agent both recorded. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-005-005-APP ⚖️: Messaging consent grants and withdrawals are logged immutably

- **Requirement:** SEC-005-005 (OWASP ASVS 5.0.0 V16.3.3; OWASP ASVS 5.0.0 V16.4.2)
- **Observed:** RED, severity high, confidence high
- **Problem:** messaging_consent has customer, channel, scope, opted_in/out timestamps, source, proof_text, captured_by, but no disclosure version, and it is mutable: RLS grants any member UPDATE and DELETE ('Organization members can update/delete messaging_consent') and there is no immutability trigger (only updated_at). sms-consent.test.ts passes for the rule logic only.
- **Fix:** Make consent append-only: drop UPDATE/DELETE policies, add a consent_events table with disclosure version, record withdrawals as new rows.
- **Done when:** Consent records capture customer, tenant, channel, disclosure version, source, time, withdrawal keyword; append-only. Tests: src/lib/sms-consent.test.ts.
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-005-013-APP: Audit logs are tamper-resistant, access-controlled and retained

- **Requirement:** SEC-005-013 (OWASP ASVS 5.0.0 V16.4.2; OWASP ASVS 5.0.0 V16.4.3; NIST CSF 2.0 PR.PS-04)
- **Observed:** YELLOW, severity high, confidence high
- **Problem:** RLS has no UPDATE/DELETE policies on activity_events, mcp_call_log, platform_admin_audit, invoice_revisions, so those are effectively append-only for authenticated (table grants exist but RLS blocks); supervised_action_audit also has a refuse_audit_update trigger. But members can INSERT forged activity_events, messaging_consent is fully mutable, TRUNCATE is granted to authenticated (TRUNCATE is not subject to RLS but needs the privilege - granted), and retention is documented only for mcp_call_log.
- **Fix:** Revoke TRUNCATE/UPDATE/DELETE (and INSERT where server-written) on audit tables from authenticated; document retention for each.
- **Done when:** App roles cannot UPDATE/DELETE audit rows; tenants read only their own; retention documented. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-001-APP: A documented incident response plan exists and is maintained

- **Requirement:** SEC-006-001 (NIST CSF 2.0 ID.IM-04; NIST CSF 2.0 RS.MA-01)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing).
- **Fix:** Write docs/security/incident-response.md naming the incident lead and backup, contacts (counsel, insurer, vendors), severity levels and runbooks.
- **Done when:** Written IR plan with lead/backup, contacts, severities, runbooks; reviewed annually. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-002-APP: Incidents are detected, triaged and declared against criteria

- **Requirement:** SEC-006-002 (NIST CSF 2.0 DE.AE-02; NIST CSF 2.0 DE.AE-08; NIST CSF 2.0 RS.MA-02)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). No security.txt intake and no alerting.
- **Fix:** Define one intake (security@ address + alerts) and written declaration criteria with triage time targets.
- **Done when:** Single intake for alerts and reports; time-bound triage; declaration criteria. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-003-APP ⚖️: Incidents are classified, including personal-information breaches

- **Requirement:** SEC-006-003 (NIST CSF 2.0 RS.MA-03; NIST CSF 2.0 RS.AN-08)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing).
- **Fix:** Add a classification matrix including Cal. Civ. Code 1798.82(h) data elements and encryption-key exposure.
- **Done when:** Classification by severity, tenants, data types (1798.82(h) PI, payment, credentials), encryption state. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-005-APP: Evidence is preserved with integrity

- **Requirement:** SEC-006-005 (NIST CSF 2.0 RS.AN-03; NIST CSF 2.0 RS.AN-06; NIST CSF 2.0 RS.AN-07)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). Log retention is not documented and no drain exists.
- **Fix:** Add an evidence-preservation runbook (Vercel/Supabase log export, PITR timestamp, action log).
- **Done when:** Runbooks preserve logs, PITR point and investigator actions before changes; retention adequate. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-006-APP: Containment and eradication runbooks exist for key scenarios

- **Requirement:** SEC-006-006 (NIST CSF 2.0 RS.MI-01; NIST CSF 2.0 RS.MI-02)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). Partial building blocks exist (MCP credential revocation, AI kill-switch env flags such as VOLTEIRA_PHASE2_* ), but no runbooks.
- **Fix:** Write the five containment runbooks referencing existing kill switches and revocation paths.
- **Done when:** Runbooks for leaked secret, compromised account, cross-tenant exposure, MCP/AI misuse, webhook abuse. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-008-APP ⚖️: Affected contractor tenants are notified promptly

- **Requirement:** SEC-006-008 (NIST CSF 2.0 RS.CO-02; NIST CSF 2.0 RS.CO-03; NIST CSF 2.0 GV.SC-08)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). Tenant terms were not found to state the notice duty.
- **Fix:** Add tenant-notification steps and a service-provider breach-notice clause (1798.82(b)) to tenant terms.
- **Done when:** Immediate notice to affected contractor tenants; duty reflected in tenant terms. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-006-010-APP: Recovery uses verified backups and confirmed restoration criteria

- **Requirement:** SEC-006-010 (NIST CSF 2.0 RC.RP-01; NIST CSF 2.0 RC.RP-02; NIST CSF 2.0 RC.RP-03; NIST CSF 2.0 RC.RP-05; NIST CSF 2.0 RC.RP-06)
- **Observed:** RED, severity high, confidence high
- **Problem:** No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). No restore test record (see SEC-004-009).
- **Fix:** Add recovery steps and criteria; perform a restore drill.
- **Files:** `docs/security/MIGRATION-RUNBOOK.md:9`
- **Done when:** Recovery verifies backup integrity, confirms clean restore, declares end with documentation. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/security.json`

### F-SEC-007-001-APP: MCP requests are authenticated with tokens issued for this server

- **Requirement:** SEC-007-001 (MCP Specification 2026-07-28 Access Token Privilege Restriction; Token Audience Binding and Validation; MCP Security Best Practices 2026-07-28 Token Passthrough; OWASP ASVS 5.0.0 V10.3.1; OWASP MCP Top 10 2025 (beta) MCP07:2025)
- **Observed:** YELLOW, severity high, confidence high
- **Problem:** Every request must carry an HMAC-SHA256 signed session token in the URL path (/api/mcp/<token>); signature and expiry are verified (readMcpSessionToken) and business tokens are re-checked against mcp_business_credentials. Tokens are minted by Volteira only and never passed to upstream APIs. However the Authorization bearer is only an optional second lock: bearerAccepted() returns true when MCP_BEARER_TOKEN is unset, so the path secret alone authenticates. No OAuth 2.1 / protected-resource metadata, no audience claim in the token, and no documented migration plan were found. Log rows store a SHA-256 of the token, but the full URL still appears in platform request logs.
- **Fix:** Implement MCP authorization per spec 2026-07-28: OAuth 2.1 with PKCE, RFC 9728 protected-resource metadata, tokens carrying an audience of the Volteira MCP resource and validated on every call, sent in the Authorization header. Until then document the path-token as legacy, add an `aud`/`iss` claim to the signed payload and verify it, and write the migration plan with a date.
- **Files:** `src/app/api/mcp/[token]/route.ts:69`, `src/app/api/mcp/[token]/route.ts:70`, `src/app/api/mcp/[token]/route.ts:73`, `src/lib/mcp-session.ts:48`, `src/lib/mcp-session.ts:50`, `src/lib/mcp-session-token.ts:107`
- **Done when:** Every MCP request authenticated with a token validated for this server; bearer in Authorization header preferred; a URL-path secret only as a compensating legacy mechanism with redaction, rotation and an OAuth 2.1 migration plan. Tests: src/lib/mcp-session-token.test.ts, src/lib/mcp-protocol.test.ts.
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-SEC-007-003-APP: Tools are permissioned individually with scope minimization

- **Requirement:** SEC-007-003 (MCP Security Best Practices 2026-07-28 Scope Minimization; OWASP MCP Top 10 2025 (beta) MCP02:2025; OWASP Top 10 for LLM Applications 2025 LLM06:2025; OWASP ASVS 5.0.0 V10.4.11)
- **Observed:** RED, severity high, confidence high
- **Problem:** There is a single all-or-nothing 'business' scope. Every business connection receives the full tool list (workday, business, paid-invoice, change-order, customer, text-history, supplier-order, release, booking, plus supervised when the flag is on), including send_text, send_invoice, send_estimate, send_contract_for_signature, mark_invoice_paid, set_invoice_discount, submit_supplier_order and update_customer. mcp_business_credentials has no grants/scopes column (schema inspected). Many write tools also lack MCP annotations (readOnlyHint/destructiveHint), so clients cannot even distinguish them.
- **Fix:** Add a grants column (e.g. text[] of tool groups: read, schedule_write, billing_write, customer_messaging, contracts, supplier_orders) to mcp_business_credentials, default ['read']; let the owner tick groups on the Use in ChatGPT page; filter tools/list and refuse tools/call outside the grants; require a new credential (re-consent) to widen. Add annotations to every write/send tool. Add a unit test asserting tools/list per grant set.
- **Files:** `src/app/api/mcp/[token]/route.ts:137`, `src/lib/mcp-session-token.ts:57`, `src/app/settings/chatgpt/chatgpt-actions.ts:19`
- **Done when:** Connections granted named tool groups, read-only by default; write/send tools need explicit owner opt-in; tools/list matches grants; scope expansion needs re-consent. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-SEC-007-005-APP: Authorization does not depend on prompts (direct prompt injection)

- **Requirement:** SEC-007-005 (OWASP Top 10 for LLM Applications 2025 LLM01:2025; OWASP Top 10 for LLM Applications 2025 LLM07:2025)
- **Observed:** YELLOW, severity high, confidence medium
- **Problem:** Tenant (signed token + credential check), role (owner-only connection, DB function role checks in decide_supervised_proposal), and STOP consent (sendSms -> textRefusal, the only path to Twilio) are enforced in code. No secrets found in system prompts. But the human-approval step for MCP write/send tools is a model-supplied boolean (`confirmed: true`) whose only safeguard is description text telling the model to ask first, i.e. prompt-dependent. No prompt-injection/red-team test log exists; ai-operations-policy.test.ts only checks who may review AI activity.
- **Fix:** Move approval out of the prompt (see SEC-007-009). Run and record a red-team session with synthetic data (ignore-previous-instructions, role-play, base64/Unicode tricks) against the in-app assistant, the SMS intake bot and a test MCP connection, and keep the log under compliance/application-audits.
- **Files:** `src/lib/mcp-business-tools.ts:41`, `src/lib/mcp-business-tools.ts:337`, `src/lib/twilio.ts:259`
- **Done when:** Permission, tenant and consent decisions enforced in code; system prompts hold no secrets and are not a security boundary; red-team prompts cannot cause unauthorized tool execution. Tests: src/lib/ai-operations-policy.test.ts.
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-SEC-007-012-APP ⚖️: Data sent to external AI providers is inventoried and governed

- **Requirement:** SEC-007-012 (OWASP Top 10 for LLM Applications 2025 LLM02:2025; OWASP ASVS 5.0.0 V14.2.3; NIST CSF 2.0 GV.SC-05; NIST CSF 2.0 ID.AM-03)
- **Observed:** RED, severity high, confidence medium
- **Problem:** No AI data-flow inventory was found (docs/security lists Anthropic and xAI only as integrations). Data observed flowing: job/invoice/customer snapshot and memories to Anthropic (src/lib/claude.ts, assistant brief); inbound customer SMS history to Anthropic (sms-intake-runner); caller profile, earlier texts/calls and live audio to xAI (xai voice route, grok-voice); anything ChatGPT/Claude requests over MCP to the tenant's own OpenAI/Anthropic account. The tenant-facing privacy page (src/app/legal/[org]/privacy/page.tsx) does not mention AI processing or providers. The Use in ChatGPT card says 'It runs on your own ChatGPT or Claude account' but does not say business and customer data will be sent to and retained by that provider.
- **Fix:** Write an AI data-flow inventory (provider, feature, data categories, retention, training terms, region) in compliance/ or docs/security; add AI providers to the privacy policy and subprocessor list; add a pre-connect notice on the Use in ChatGPT page stating that data returned to ChatGPT/Claude is governed by that provider's terms and the owner's account settings, with an acknowledgement checkbox before the link is shown.
- **Files:** `src/app/legal/[org]/privacy/page.tsx:1`, `src/app/settings/chatgpt/chatgpt-connection-card.tsx:86`, `src/lib/claude.ts:24`, `src/lib/xai-text.ts:61`, `src/app/api/xai/voice/route.ts:122`
- **Done when:** An inventory of which data goes to which AI provider under which terms (no training, retention) and how tenants are told; tenants informed before connecting ChatGPT that data leaves Volteira's control. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/ai-mcp.json`

### F-CA-002-003-APP ❔: Policy identifies categories of PII collected and categories of third parties shared with

- **Requirement:** CA-002-003 (Cal. Bus. & Prof. Code 22575(b)(1))
- **Observed:** RED, severity medium, confidence high
- **Problem:** The policy lists contact, service, message and consent records (privacy/page.tsx:45-51) but omits call recordings and transcripts (recorded record-from-answer-dual, twilio-sip.ts:63) and payment data, and names only a messaging carrier and software/hosting/database providers (82-87), omitting the payment processor, email provider and AI providers.
- **Fix:** Add call recordings/transcripts and payment information to categories; list payment, email, AI voice/text, mapping and hosting providers as third-party categories.
- **Files:** `src/app/legal/[org]/privacy/page.tsx:45-51`, `src/app/legal/[org]/privacy/page.tsx:82-87`, `src/lib/twilio-sip.ts:63`
- **Done when:** Policy lists categories of PII (including payment info, call recordings/transcripts) and categories of third parties (payment processor, messaging, AI providers, hosting). Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-002-009-APP ❔: Comply with posted policy

- **Requirement:** CA-002-009 (Cal. Bus. & Prof. Code 22576)
- **Observed:** RED, severity medium, confidence high
- **Problem:** Practice contradicts the policy: texts are sent on owner-entered, verbal (phone) and inbound-text consent and with no record at all, while the policy says texts are only sent to people who ticked the booking box and that phone booking does not sign anyone up (privacy/page.tsx:62-73); undisclosed recipients (xAI, Anthropic, Stripe, Resend, Google) receive data.
- **Fix:** Align policy and practice (see FED-004-001) and add a release check that reconciles them.
- **Files:** `src/app/legal/[org]/privacy/page.tsx:62-73`, `src/lib/booking-notifications.ts:287`, `src/lib/manual-sms-consent.ts:278-326`, `src/lib/messaging-rules.ts:101-108`
- **Done when:** Operate in accordance with the posted policy. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-005-005-APP ❔: Retention of electronic records

- **Requirement:** CA-005-005 (Cal. Civ. Code 1633.12)
- **Observed:** RED, severity medium, confidence high
- **Problem:** Same gaps as FED-001-010: signed contracts deletable by members (RLS ALL) and admin/job/org deletion functions; signed PDFs re-renderable with current letterhead; payment_schedule not frozen; report CSV export has no contracts.
- **Fix:** See FED-001-010 remediation; add a contract/document export bundle per tenant.
- **Files:** `supabase/migrations/20260812000000_contracts.sql:78`, `supabase/migrations/20261105010000_admin_data_removal.sql:119`, `src/app/jobs/[jobId]/contract-actions.ts:556`, `src/app/reports/export/route.ts:17`
- **Done when:** Retained records accurately reflect the final form, remain accessible, immutable with integrity checks, retained for the longest period, exportable. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-CA-006-011-APP ⚖️ ❔: Bot disclosure for online communications intended to incentivize a sale

- **Requirement:** CA-006-011 (Cal. Bus. & Prof. Code 17940-17943)
- **Observed:** RED, severity medium, confidence high
- **Problem:** The SMS assistant opens 'Hi Jane, this is Maya from Pacific Plains Electric' and offers a paid diagnostic visit (website-intake.test.ts:94-107); it admits being a virtual assistant only if the customer 'sincerely asks' (sms-intake.ts:689; voice: grok-voice.ts:197). The messaging_settings.ai_disclosure_text column ('You are chatting with an automated assistant.') is never used by any code.
- **Fix:** Disclose in the first AI text (and voice greeting) that it is an automated assistant, using ai_disclosure_text; test it.
- **Files:** `src/lib/sms-intake.ts:689`, `src/lib/grok-voice.ts:197`, `src/lib/voice-intake.ts:44-61`, `src/lib/website-intake.ts`
- **Done when:** AI assistants communicating online to incentivize a purchase clearly and conspicuously disclose they are bots. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/communications-privacy.json`

### F-CA-010-005-APP ❔: Sales and use tax record retention: at least four years

- **Requirement:** CA-010-005 (Cal. Rev. & Tax. Code 7053, 7054; Cal. Code Regs., tit. 18, sec. 1698(i))
- **Observed:** RED, severity medium, confidence high
- **Problem:** Same deletion paths as FED-006-002: RLS allows deleting any invoice (cascading payments/refunds/revisions) and any job (cascading prepayments); organization delete cascades invoices; no retention period is defined.
- **Fix:** Apply the FED-006-002 remediation with a minimum four-year retention for invoices, contracts, payments and supplier receipts.
- **Files:** `src/app/invoices/actions.ts:407`
- **Done when:** Invoices, contracts, purchase and payment records retained at least four years. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-CSLB-001-007-APP ❔: Block contract generation and payment collection when license is not active

- **Requirement:** CSLB-001-007 (Recommended control supporting Cal. Bus. & Prof. Code §§ 7028, 7031)
- **Observed:** RED, severity medium, confidence high
- **Problem:** generateContract and generateChangeOrder never consult any license data; a contract is generated even with no license number at all (the letterhead simply omits it).
- **Fix:** Gate generateContract/generateChangeOrder/sendSigningLink on a current Active verification.
- **Files:** `src/app/jobs/[jobId]/contract-actions.ts:190`, `src/app/jobs/[jobId]/contract-actions.ts:492`, `src/lib/pdf/letterhead.tsx:149`
- **Done when:** Contract and change-order generation blocked when license is not Active or verification stale. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/contracts-esign.json`

### F-FED-009-001-APP ⚖️: Disclose all material terms clearly and conspicuously before obtaining billing information

- **Requirement:** FED-009-001 (15 U.S.C. 8403(1))
- **Observed:** RED, severity medium, confidence high
- **Problem:** The only pre-checkout disclosure is the button label 'Start Premium · <price>'; Volteira's page does not state that the plan renews automatically, the renewal interval, or how to cancel before redirecting to Stripe Checkout. Stripe's hosted page shows the recurring price, but cancellation terms are not configured (no custom_text / consent_collection). The paid plan is live only when STRIPE_PREMIUM_PRICE_ID is set; production currently has 0 organization_subscriptions rows.
- **Fix:** Next to the Start Premium button, show: price per month, 'renews automatically each month until you cancel', and 'cancel any time in Account > Plan > Manage billing'; repeat via Checkout custom_text.submit.
- **Files:** `src/app/account/actions.ts:348`, `src/app/account/actions.ts:384`, `src/app/account/page.tsx:280`
- **Done when:** Before Stripe Checkout for the subscription, show price, billing frequency, automatic renewal, trial terms and how to cancel. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

### F-FED-009-002-APP: Obtain express informed consent before charging

- **Requirement:** FED-009-002 (15 U.S.C. 8403(2))
- **Observed:** RED, severity medium, confidence high
- **Problem:** No consent checkbox or consent record exists; startPremiumCheckout redirects straight to Stripe and no consent_collection.terms_of_service or local consent row is stored.
- **Fix:** Add an unchecked 'I agree to be charged <price> monthly until I cancel' box required before startPremiumCheckout, store user id, time, price id and terms version; also set consent_collection.terms_of_service='required'.
- **Files:** `src/app/account/actions.ts:348`, `src/app/account/actions.ts:384`, `src/app/account/page.tsx:280`
- **Done when:** An affirmative, specific consent to the recurring charge is captured and stored with the terms version. Add a regression test if it touches money, security, consent or signatures (AGENTS.md).
- **Source:** `application-audits/2026-11-24/findings/payments-invoices.json`

## P2

| Finding | Requirement | Observed | Severity | Problem | Fix | Files |
|---|---|---|---|---|---|---|
| F-CSLB-004-001-APP | CSLB-004-001 Down payment may not exceed $1,000 or 10% of contract price… | YELLOW | critical | planAmounts enforces the cap on deposits and anything due on signing, for fixed and percent amounts, on save and again on every load, so a plan inserted directly through the API that breaks the cap yields no pay links (… | Base the cap on the signed contract price (contracts figures) when one exists; make recordPrepayment refuse (or require an explicit 'payment for work performed' reason) amounts that would take total pre-work money above… | src/lib/payment-plan.ts:51, src/lib/payment-plan.ts:83, src/lib/payment-plan-server.ts:45 |
| F-CSLB-004-004-APP | CSLB-004-004 No payment in advance of work except the down payment | YELLOW | critical | Installments are scheduled by calendar date ('on_date') or on signing, never by phase completion, and only 'deposit'/'on_signing' items count toward the cap, so a plan of $1,000 deposit + $8,999 installment dated tomorr… | Tie each non-deposit payment to a phase that must be marked complete (optionally with photos) before it can be requested, linked or paid; block pay links and invoices whose cumulative amount exceeds deposit + value of c… | src/lib/payment-plan.ts:83, src/lib/payment-plan.ts:152, src/lib/payment-plan.ts:169 |
| F-CSLB-005-001-APP | CSLB-005-001 Progress payments may not exceed value of work performed or… | YELLOW | critical | There is no concept of phase completion: installments are due on a date or on signing; auto and by-hand requests and the pay page do not check job progress; invoices can be raised for typed amounts at any job stage. The… | Add PlanDue 'on_phase' tied to a job phase/milestone with completion (who, when, photos); allow requests and pay links only after completion; migrate on_date installments to require completion confirmation. | src/lib/payment-plan.ts:14, src/lib/payment-plan.ts:169, src/lib/payment-plan.ts:254 |
| F-FED-002-002-APP | FED-002-002 Prior express written consent for telemarketing/advertising… | YELLOW | critical | No marketing send feature exists: the schema has a 'marketing' scope but no code writes or reads it; templates and automatic messages are transactional; the MCP proposal tool says 'Customer messages are transactional on… | Tag every outbound message with a purpose (transactional vs marketing); refuse marketing-tagged sends without a 'marketing' scope opt-in that carries written-consent evidence; add owner guidance and an AI-side classifie… | src/lib/mcp-supervised-tools.ts:56, src/lib/customer-text.ts:55-80, src/app/messages/actions.ts:30-60 |
| F-SEC-003-001-APP | SEC-003-001 Database access uses parameterized queries | YELLOW | critical | Application data access uses supabase-js builders. guard_tenant_references uses pg_catalog.format for dynamic SQL. .or()/.filter() call sites embedding user search text were not exhaustively reviewed. | Grep every .or(/.filter( call and escape user input (or switch to ilike with bound values); add a lint rule. | src/lib/supabase/flexible.ts:1 |
| F-SEC-003-017-APP | SEC-003-017 Stripe webhooks verify signatures with a replay window | YELLOW | critical | Webhook reads request.text() and verifies with stripe.webhooks.constructEvent (default 300s tolerance), trying platform then Connect secret; 400 on missing/invalid signature. Connected events cross-check event.account. … | Record event.id in stripe_webhook_events (insert ... on conflict do nothing) before processing; add a signature-verification unit test. | src/app/api/stripe/webhook/route.ts:27, src/app/api/stripe/webhook/route.ts:41 |
| F-SEC-003-018-APP | SEC-003-018 Twilio webhooks verify X-Twilio-Signature | YELLOW | critical | All nine Twilio webhook routes (inbound, voice, status, recording, transfer, xai, website-callback, /amd, /status) call verifyTwilioSignature (HMAC-SHA1, timingSafeEqual, candidate URLs) and return 403 before acting; re… | Add a test of verifyTwilioSignature against Twilio's published signing example (valid, tampered and missing signature) and a route-level test that an unsigned request gets 403 with no side effects. | src/lib/twilio.ts:493, src/app/api/twilio/inbound/route.ts:36 |
| F-SEC-003-021-APP | SEC-003-021 Money flows enforce sequence, atomicity and locking | YELLOW | critical | Settlement RPCs are service-only SECURITY DEFINER functions; refund/payment/plan/change-order rules are unit-tested (invoice-refund, invoice-payment, payment-plan, change-order-apply all pass). Concurrency (double submi… | Add a DB concurrency test (two sessions settling the same refund/payment) on a branch. | src/lib/invoice-refund-server.ts:1 |
| F-SEC-007-006-APP | SEC-007-006 Indirect prompt injection from untrusted content is contain… | YELLOW | critical | Delimiting exists: the in-app assistant brief says snapshot text is data (src/lib/assistant-brief.ts:132), MCP text history and proposals are labelled 'data, not instructions' (tested in mcp-text-history.test.ts). But o… | Make MCP send/financial tools create supervised proposals (propose_action) instead of executing, or require a Volteira-side approval token (owner taps in Volteira; tool accepts the one-time approval id). Add a synthetic… | src/lib/mcp-text-history.ts:51, src/lib/mcp-business-tools.ts:711, src/lib/mcp-business-tools.ts:337 |
| F-SEC-007-008-APP | SEC-007-008 No unauthorized or excessive autonomous execution | YELLOW | critical | The in-app assistant follows this (confirm:true tools only produce proposals; tested in assistant-tools.test.ts) and the supervised executor runs only approved proposals of types named in VOLTEIRA_PHASE2_EXECUTE, never … | Produce a tool inventory with impact rating (read / internal write / customer-visible / financial / binding). Convert customer-visible, financial and binding MCP tools to proposals in task_proposals (reuse propose_actio… | src/lib/mcp-business-tools.ts:543, src/lib/mcp-business-tools.ts:665, src/lib/mcp-business-tools.ts:711 |
| F-SEC-007-009-APP | SEC-007-009 Human approval gates sending and financial actions | YELLOW | critical | Supervised path is sound: decide_supervised_proposal (DB, inspected) checks actor role, self-approval, pending status, content hash and expiry with row lock; the executor re-checks recipient number, invoice state, quiet… | Route every MCP send/financial/binding action through create_supervised_proposal and require approval in Volteira (or an approve_proposal call bound to a fingerprint the owner saw in Volteira), with decided_by recorded;… | src/lib/mcp-business-tools.ts:337, src/lib/mcp-business-tools.ts:711, src/lib/mcp-business-tools.ts:665 |
| F-SEC-007-013-APP | SEC-007-013 No cross-tenant leakage through AI context, memory or caches | YELLOW | critical | assistant_memories has organization_id with RLS enabled and member-scoped policies (inspected); assistant-memory.ts filters by organization_id; the assistant brief is built per request from the signed-in member's RLS cl… | Run and log the two-tenant AI test (synthetic Tenant A/B; ask A's assistant, SMS bot and MCP connection about B's customers). Restrict assistant_memories writes to owner/admin or mark memories with author and show them … | src/lib/assistant-memory.ts:32, src/app/assistant/agent-actions.ts:79, src/lib/claude.ts:61 |
| F-CA-001-002-APP ⚖️ | CA-001-002 Role determination: Volteira as service provider/contractor… | RED | high | No data-flow role documentation exists. Customer data flows to xAI (live call audio), Anthropic (assistant), Google (geocoding, calendar, drive), Twilio, Resend and Stripe, with no recorded role or purpose limitation. | Write the data-flow role map and commit Volteira to service-provider-only processing. | src/lib/grok-voice.ts, src/lib/claude.ts, src/lib/geocoding.ts |
| F-CA-004-001-APP ❔ | CA-004-001 Breach notification scope: personal information definition … | RED | high | No written definition or incident classification exists. | Add the definition to an incident response plan. | docs/security |
| F-CA-004-003-APP ❔ | CA-004-003 Breach notice content, headings and format | RED | high | No 'Notice of Data Breach' template exists. | Add the statutory-format template. | docs/security |
| F-CA-004-005-APP ❔ | CA-004-005 Submit sample notice to the Attorney General for breaches o… | RED | high | No AG submission step exists. | Add the AG submission step and deadline. | docs/security |
| F-CA-005-001-APP ⚖️ ❔ | CA-005-001 UETA scope and exclusions | YELLOW | high | No mapping exists in code or docs; the app has no separate-initials capability, so any notice that must be separately signed/initialed (e.g., arbitration, cancellation acknowledgement) cannot be captured. | Produce the document inventory with counsel; add a separate-initials capture for any notice that needs it. | src/app/contract/[token]/actions.ts:89, src/lib/esign-consent.ts:1 |
| F-CA-005-002-APP ⚖️ ❔ | CA-005-002 Agreement to transact electronically; right to refuse; no c… | YELLOW | high | Agreement is a separate optional checkbox in an electronic record (the signing page), refused server-side without it, and the text offers paper signing. The agreement itself is not recorded (implied only by the signatur… | Record the UETA/ESIGN agreement as its own event (see FED-001-002) and give staff a 'customer chose paper' path that prints the same document for wet signature. | src/components/signature-pad.tsx:91, src/app/contract/[token]/actions.ts:89 |
| F-CA-005-003-APP ❔ | CA-005-003 Legal effect and attribution of electronic signatures | YELLOW | high | Timestamp, IP, UA, typed/drawn method and DB-computed body hash are stored and frozen by trigger (inspected); change orders are separate contracts rows signed separately. Identity verification is possession of a UUID li… | Record link delivery channel/address and verification method with the signature, store consent record, and hash the signed PDF. | supabase/migrations/20260927120000_contract_signatures.sql:266, src/app/contract/[token]/actions.ts:89, src/app/jobs/[jobId]/contract-actions.ts:635 |
| F-CA-005-004-APP ❔ | CA-005-004 Information required to be in writing: retainable by the re… | YELLOW | high | Retainable PDF is delivered (rendered synthetic PDF; email attachment after signing). The underlying law's format rules are not met: the rendered contract has body and every notice at 10pt regular, headings largely unbo… | Keep PDF delivery; fix type sizes and statutory notices per CSLB-003 findings. | src/lib/contract-copy.ts:44, src/lib/pdf/contract-document.tsx:79 |
| F-CA-006-003-APP ❔ | CA-006-003 Text message advertisements to California mobile numbers | YELLOW | high | No marketing text feature exists, but free-form inbox, MCP send_text and AI-proposed texts are not classified, so advertising content is not prevented (see FED-002-002). | Classify and block or gate advertising texts. | src/lib/customer-text.ts:55-80, src/lib/mcp-supervised-tools.ts:56 |
| F-CA-007-005-APP | CA-007-005 WCAG 2.1 AA conformance for public sites and customer flows | RED | high | No accessibility statement or contact method exists anywhere (demonstrably missing); conformance is untested. | Publish an accessibility statement with a contact and triage SLA; add axe checks and a manual audit. | src/app/legal/[org]/layout.tsx, src/components/public-booking-flow.tsx, e2e/navigation.spec.ts |
| F-CA-009-007-APP ⚖️ ❔ | CA-009-007 Installment pay links: retail installment and lending law a… | YELLOW | high | Plans have no finance or service charge, and the contract's PAYMENT SCHEDULE block shows each payment in dollars and when due (tested). No legal determination of Unruh Act applicability is recorded, and plans with many … | Obtain counsel's Unruh/CFL determination for interest-free schedules; limit installment count pending that determination. | src/lib/payment-plan.ts:244, src/lib/payment-plan.ts:214 |
| F-CA-010-001-APP ⚖️ ❔ | CA-010-001 Construction contractors: consumers of materials, retailers… | YELLOW | high | Volteira applies no rate at all: tax is a single dollar amount the user types per invoice (tax_cents), defaulting to 0, added after the credit. This avoids a wrong default rate, but there is no line-level taxable classi… | Add a per-line tax class (labor, materials-consumed, fixture-resale, diagnostic, exempt) and compute tax only on classes the tenant marks taxable; keep the manual override. | src/app/jobs/[jobId]/invoice-actions.ts:83, src/lib/invoice-math.ts:40, src/components/invoice-adjustments.tsx:185 |
| F-CSLB-001-003-APP ⚖️ | CSLB-001-003 C-10 Electrical classification scope | RED | high | No classification field exists for organizations; no scope check. | Add classifications (from the CSLB lookup) to the organization license record and warn when a job's work type is outside C-10 or other held classes. | src/app/settings/business/actions.ts:81 |
| F-CSLB-001-005-APP | CSLB-001-005 Business name on contracts and advertising matches the lice… | YELLOW | high | One organizations.name is printed on every PDF (rendered synthetic contract shows it in letterhead, signature block and footer), but it is free text never compared to the CSLB record. | Store the license-record legal name/DBA from verification and print that on contracts; warn when organizations.name differs. | src/lib/pdf/store.ts:69, src/lib/pdf/letterhead.tsx:121 |
| F-CSLB-002-004-APP ⚖️ | CSLB-002-004 Service and repair contract: operational conditions (one se… | YELLOW | high | Booking copy names a 'Diagnostic fee' and the booking flow shows its amount; whether every advertisement states a service charge applies was not checked here; there is no 'offer replaced parts' step and nothing limits j… | Add 'service charge applies' to all booking/advert surfaces, a replaced-parts offer checkbox on service-and-repair completion, and a single-service-charge rule. | src/lib/booking-page-copy.ts:29 |
| F-CSLB-002-005-APP ⚖️ ❔ | CSLB-002-005 Emergency work and home solicitation cancellation waiver pa… | YELLOW | high | No emergency flag exists, so no suppression path exists; but there are also no cancellation notices to suppress and no waiver path (see CSLB-007-008). | When notices are added, make any emergency path conditional on a captured handwritten waiver. | src/lib/contract-template.ts:193 |
| F-CSLB-003-006-APP | CSLB-003-006 Change-order form incorporated into the contract | RED | high | No change-order form is included in or attached to the contract; change orders exist only as separate documents generated later. | Attach a blank change-order form (or the statutory incorporation language plus form) to every home-improvement contract. | src/lib/contract-template.ts:193, src/lib/change-order-document.ts:51 |
| F-CSLB-003-008-APP | CSLB-003-008 Required items appear in the statutory order | RED | high | Rendered order is WORK AGREEMENT, SCOPE OF WORK, PRICE, PAYMENT, ACCESS AND CONDITIONS, PAYMENT SCHEDULE (appended at the end when the template has no {{payment_terms}}), signatures; most required items are absent. | Generate the 7159(d) items from a structured, locked template so none can be omitted. | src/lib/contract-template.ts:193, src/lib/payment-plan.ts:271 |
| F-CSLB-003-010-APP | CSLB-003-010 Home improvement salesperson name and registration number, … | RED | high | No salesperson attribution or HIS registration field exists. | Capture the selling user per job and HIS number per user; print when the seller is not the qualifier/owner. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-CSLB-003-031-APP ⚖️ ❔ | CSLB-003-031 Statutory notices may not be waived; contract may not inclu… | YELLOW | high | Default template contains no waiver. Tenant templates are free text saved without any content check. | Lint tenant templates for waiver/contradicting language and keep statutory notices outside the editable template. | src/app/settings/contract/actions.ts:39, src/lib/contract-template.ts:193 |
| F-CSLB-004-002-APP ⚖️ | CSLB-004-002 Booking-time deposits taken before a signed contract count … | YELLOW | high | The booking diagnostic fee is collected at booking and credited toward approved repair work (diagnostic-credit.ts), but planAmounts/maxDownPaymentCents never consider it. Example: a $15,000 repair booked from a $150 dia… | Pass the diagnostic credit still to be applied into planAmounts and count it in the down payment; refuse by-hand deposit requests until the contract with the schedule is signed (or legal review approves pre-contract col… | src/lib/payment-plan.ts:83, src/lib/diagnostic-credit.ts:20, src/lib/booking-checkout.ts:150 |
| F-CSLB-005-002-APP | CSLB-005-002 Installment invoices reference the phase of work in the sch… | YELLOW | high | Pay links and requests name the payment ('Deposit', 'Payment 2', 'Balance') and job number, and automatic requests go only when they match the signed schedule (tested). There are no phase descriptions in the schedule, p… | Add a phase description to each plan item, show it on the contract schedule, pay links and invoices, and reference the contract number. | src/lib/payment-plan.ts:214, src/lib/payment-plan.ts:229, src/lib/job-prepayment-pay.ts:450 |
| F-CSLB-005-004-APP ⚖️ | CSLB-005-004 Furnish lien release after payment (on request) | RED | high | No lien release / waiver generation exists anywhere in the application (grep for lien, waiver, 8134 found nothing relevant). | Add a 'Lien release' document for each received payment using the statutory Civ 8134/8138 forms, available only after the payment has cleared. |  |
| F-CSLB-006-004-APP | CSLB-006-004 Payment schedule recalculation after change orders stays wi… | YELLOW | high | planAmounts enforces the cap against the current total (tested) and matchesSignedSchedule stops automatic requests for a plan that differs from the signed one; whether the plan is re-validated when a change order lowers… | Re-run planAmounts on every applied change order and refuse plans whose paid-ahead amount exceeds completed work. | src/lib/payment-plan.ts:51, src/lib/payment-plan.ts:188 |
| F-CSLB-007-008-APP ⚖️ ❔ | CSLB-007-008 Emergency waiver of cancellation period | RED | high | No waiver capture path exists. | Add an emergency waiver upload tied to the contract and require it before early work on a home-solicitation contract. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-FED-001-003-APP | FED-001-003 Pre-consent disclosure: right to paper, right to withdraw c… | YELLOW | high | Disclosure text covers paper copies at no charge, signing on paper instead, withdrawal by phone/text/email and that later documents go on paper (unit test asserts the wording). It is shown in a collapsed <details> eleme… | Show the consent sections expanded (or require opening them) above the checkbox; legal review of the wording. | src/lib/esign-consent.ts:24, src/components/signature-pad.tsx:91 |
| F-FED-001-008-APP | FED-001-008 Consent given electronically in a manner that reasonably de… | YELLOW | high | Consent is given on the same web page that displays the contract text and offers the PDF, which supports reasonable demonstration, but nothing confirms the consumer opened the PDF form actually delivered (no 'I could op… | Have the consent step link to the PDF and record that it was opened (or ask the consumer to confirm they can open it) before the checkbox enables. | src/components/signature-pad.tsx:91, src/app/contract/[token]/contract-pdf.tsx:1 |
| F-FED-001-011-APP | FED-001-011 Electronic records required to be provided must be capable … | YELLOW | high | A real PDF is produced (rendered synthetic contract: 2-page Letter PDF with embedded Arimo subsets); after signing, sendSignedContractCopy emails it as an attachment when an email is on file and texts a link otherwise; … | Persist the delivery result (channel, time, message id) on the contract; surface 'copy not delivered' to the business with a hand-over/print fallback. | src/lib/contract-copy.ts:44, src/app/contract/[token]/actions.ts:174, src/app/contract/[token]/contract-pdf.tsx:1 |
| F-FED-002-003-APP | FED-002-003 Artificial or prerecorded voice calls to residential lines … | YELLOW | high | The only outbound AI call is the website callback, placed only when the website request's contact method is 'phone' (websiteCallDecision, website-intake.ts:206-215; placeCall in website-intake-runner.ts:224). The gate i… | Store the callback consent (form wording, time, source) in messaging_consent with channel 'voice' or an equivalent ledger and refuse placeCall without it; publish required form wording for tenant websites. | src/lib/website-intake.ts:206-215, src/lib/website-intake-runner.ts:200-240, src/lib/twilio.ts:390-443 |
| F-FED-002-004-APP ⚖️ ❔ | FED-002-004 AI-generated voices are 'artificial' voices under the TCPA | YELLOW | high | Outbound AI calls and AI voicemails happen only for website callbacks the customer requested (tested). The voicemail identifies the business and callback number (websiteCallbackVoicemail, website-intake.ts:218-231) but … | Record callback consent explicitly as consent to an automated/AI-voice call; add a spoken opt-out ('say stop calling') that writes a voice opt-out honoured by placeCall; add a test for voicemail identification. | src/lib/website-intake.ts:206-231, src/lib/voice-intake.ts:55-61, src/app/api/twilio/website-callback/route.ts:85-110 |
| F-FED-002-015-APP ❔ | FED-002-015 CTIA Messaging Principles and Best Practices: opt-in, STOP/… | YELLOW | high | The booking-page disclosure carries the required elements (CT-SMS-001 passes), is optional and unchecked, and links Terms and Privacy (public-booking-flow.tsx:517-541). The first AI text carries 'Reply STOP to opt out' … | Record Twilio HELP/STOP auto-reply configuration as evidence; send a disclosure/confirmation text when consent is captured outside the booking form. | src/lib/sms-consent.ts:16-26, src/components/public-booking-flow.tsx:511-541, src/app/api/twilio/inbound/route.ts:18-24 |
| F-FED-003-001-APP | FED-003-001 Classify each email as commercial vs transactional/relation… | YELLOW | high | All built-in emails (booking confirmations, estimates, invoices, receipts, contracts, refunds, invitations) are transactional by content, but nothing tags them, and the AI-proposed send_customer_email accepts a free-for… | Add a purpose tag to sendEmail; for free-form owner/AI emails, either refuse promotional content or treat as commercial (unsubscribe, postal address, ad identification). | src/lib/email.ts:27-37, src/lib/mcp-supervised-tools.ts:56-64, src/lib/mcp-supervised-tools.ts:207-242 |
| F-FED-007-002-APP ❔ | FED-007-002 SAQ A eligibility: fully outsourced, hosted Stripe Checkout… | YELLOW | high | Every checkout is created server-side with ui_mode 'hosted_page' and the browser is redirected to session.url; a nonce-based CSP is enforced and tested. Eligibility attestation is not documented. The booking page displa… | Record the SAQ A eligibility determination (hosted redirect, CSP evidence); change 'Secure test payment' to 'Secure payment' on the booking form. | src/lib/booking-checkout.ts:120, src/lib/job-prepayment-pay.ts:454, src/lib/csp.ts:1 |
| F-FED-010-003-APP | FED-010-003 AI-drafted customer communications must not deceive; mainta… | YELLOW | high | Supervised proposals record decided_by/decided_via and re-check STOP and quiet hours (tested); the in-app assistant requires the signed-in user's tap. But MCP send_text, send_invoice, send_estimate, send_contract_for_si… | Route MCP customer messages through supervised proposals with approver logging (SEC-007-009); store approved_by on messages; apply quiet hours on all AI sends; consider disclosing at the start of AI calls that the calle… | src/lib/mcp-business-tools.ts:711, src/lib/customer-text.ts:131, src/lib/voice-intake.ts:44 |
| F-SEC-001-005-APP | SEC-001-005 Sensitive account changes require re-authentication | YELLOW | high | Password change sends current_password to supabase.auth.updateUser (account/actions.ts:462). Email change calls updateUser({ email }) with no re-authentication (account/actions.ts:89; relies on Supabase double-confirmat… | Require re-authentication (supabase.auth.reauthenticate nonce or password re-entry within N minutes) before email change, payout onboarding, ownership transfer and future MFA factor changes; enable secure email change i… | src/app/account/actions.ts:89, src/app/account/actions.ts:462, src/app/settings/payments/start/route.ts:25 |
| F-SEC-001-008-APP | SEC-001-008 Password reset is secure and does not bypass MFA | YELLOW | high | Reset completes only for a session whose amr includes 'recovery' within one hour (password-reset.ts mayResetPassword, tested); callback uses getSafeNextPath. No hints/questions. Because MFA does not exist, 'reset does n… | When MFA ships, require aal2 (or a factor challenge) after recovery before updateUser({password}) for users with factors; document the Supabase OTP expiry setting. | src/lib/password-reset.ts:26, src/app/reset-password/actions.ts:30, src/app/auth/callback/route.ts:16 |
| F-SEC-001-012-APP | SEC-001-012 Sessions are verified server-side and revoked on sign-out | YELLOW | high | currentUser() and the proxy use supabase.auth.getClaims() (signature-verified JWT) and API routes such as recordings use getUser(). signOut() calls supabase.auth.signOut() whose default scope is global (revokes refresh … | Add a test or documented manual check that a refresh token is rejected after sign-out; keep access-token lifetime short; consider getUser() (server round-trip) on high-risk actions. | src/lib/request-context.ts:52, src/lib/supabase/proxy.ts:323, src/app/account/actions.ts:472 |
| F-SEC-001-013-APP | SEC-001-013 Removing or disabling a user ends their sessions everywhere | YELLOW | high | Membership is re-read on every request (currentContext queries organization_members; RLS helpers check membership per query), so removal takes effect immediately even with a valid JWT (active-business.test.ts covers the… | Add 'sign out everywhere' (signOut({scope:'others'})) on Account > Security and after password change; add a platform-admin action using auth.admin.signOut for a user; pending rolled-back two-tenant test TI-001..TI-012 … | src/lib/request-context.ts:83, src/lib/active-business.ts:1 |
| F-SEC-001-015-APP | SEC-001-015 All authentication pathways are inventoried | YELLOW | high | docs/security/source-inventory.md and public-paths.ts (tested) enumerate public routes, and each pathway was found in code: password, email OTP/recovery, invitation tokens, capability links (invoice/estimate/contract/bo… | Write docs/security/auth-pathways.md listing each pathway, credential type, entropy, lifetime, revocation and rate limit; keep public-paths.test.ts in sync. | src/lib/public-paths.ts:57, docs/security/source-inventory.md:1 |
| F-SEC-001-017-APP | SEC-001-017 Customer-facing capability links are unguessable, scoped an… | YELLOW | high | Tokens are gen_random_uuid() UUIDv4 (122 random bits, CSPRNG) in uuid columns: contracts.public_token, booking_requests.public_token, job_payment_plan_items.pay_token, invoices/estimates.preview_token, invitations.token… | Move to 256-bit random tokens (encode(gen_random_bytes(32),'base64url') in text columns) for new links; add revoke/rotate and expiry after purpose ends; remove the token from the booking pay log line. | next.config.ts:200, src/app/booking/[token]/pay/route.ts:104 |
| F-SEC-002-010-APP | SEC-002-010 Role-based function-level authorization is enforced server-… | YELLOW | high | Billing role rule is enforced in DB (can_edit_billing) and tested; owner-only invites guarded by triggers; exports gated by canExportReports. But organization_subscriptions lets any owner/admin INSERT/UPDATE/DELETE thei… | Drop the INSERT/UPDATE/DELETE policies on organization_subscriptions and revoke insert/update/delete from authenticated (only the Stripe webhook via service role writes it); likewise restrict stripe_connect_accounts wri… | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:189, supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:229, src/lib/ai-allowance.ts:18 |
| F-SEC-002-012-APP | SEC-002-012 Least privilege for roles and database grants | YELLOW | high | authenticated has full INSERT/UPDATE/DELETE/TRUNCATE table grants on every public table (default ACL from postgres grants arwdDxtm), so least privilege rests entirely on RLS. Where policies are broad this is exploitable… | Revoke TRUNCATE and write privileges from authenticated on service-owned tables (organization_subscriptions, stripe_connect_accounts, stripe_webhook_events, audit tables); alter default privileges to stop granting EXECU… | supabase/migrations/20260804144538_user_profiles_preferences_billing_square.sql:229 |
| F-SEC-002-013-APP | SEC-002-013 Invitations are single-use, expiring and cannot escalate pr… | YELLOW | high | accept_organization_invitation requires signed-in user, matching confirmed email, not revoked/accepted/expired, with FOR UPDATE; invitations expire (14 days); guard_owner_invitation/guard_owner_membership stop non-owner… | Add a database test for invite acceptance (wrong email, expired, revoked, technician creating owner invite); use 256-bit tokens. | src/app/settings/team/actions.ts:37, supabase/migrations/20260810040000_organization_invitations.sql:121 |
| F-SEC-002-014-APP | SEC-002-014 Active-business switching re-validates membership on every … | YELLOW | high | BUSINESS_COOKIE is validated as a UUID and only honoured when chooseMembership finds a current membership (tested); RLS checks membership on every query; impersonation read from DB, not cookie. DB-level removed-member s… | Run compliance/tests/tenant-isolation/two-tenant-rollback.sql with a removed-member variant (delete A's membership, keep JWT) and record the result. | src/lib/request-context.ts:96, src/lib/request-context.ts:121, src/lib/active-business.ts:1 |
| F-SEC-002-016-APP | SEC-002-016 Public tenant pages expose only that tenant's public data | YELLOW | high | Custom hosts resolved via bookingHostFor (string match) then get_booking_page_by_host / get_verified_host_for_slug (verified domain mapping); tenant-domain.test.ts passes (18 tests). Public RPC outputs not field-reviewe… | Add a DB test that calls create_public_booking_intake with A's slug and B's identifiers and expects refusal; review returned columns. | src/proxy.ts:51, src/lib/tenant-domain.ts:1 |
| F-SEC-002-017-APP | SEC-002-017 Reports, search and exports are tenant-filtered | YELLOW | high | reports/export uses currentContext().organizationId passed into buildReportExport (service role) and gates on canExportReports(role). Search and dashboards use the RLS client. Not exercised with two tenants. | Add an export test with two seeded tenants asserting zero foreign rows. | src/app/reports/export/route.ts:18, src/app/reports/export/route.ts:31 |
| F-SEC-002-018-APP ⚖️ | SEC-002-018 Tenant offboarding and deletion is complete and isolated | RED | high | No offboarding/deletion procedure exists in docs. The organizations DELETE policy is broken (never matches), so owners cannot delete via the app; platform admin data actions exist (admin/organizations/[id]/data-actions.… | Write a tenant offboarding runbook (export, delete rows/objects, revoke MCP and OAuth credentials, disconnect Stripe/Twilio numbers, retained records and legal holds, backup retention) and fix the delete policy. | src/app/admin/organizations/[id]/data-actions.ts:1 |
| F-SEC-003-002-APP | SEC-003-002 Output is encoded for its context (XSS) | YELLOW | high | No innerHTML/document.write found; only dangerouslySetInnerHTML is JSON-LD. Email HTML templates and PDFs (react-pdf) were not audited for escaping of customer values. | Review email HTML builders (invitationEmail, invoice emails) for HTML-escaping of customer-supplied strings and add a test for one template. | src/components/journal-structured-data.tsx:96 |
| F-SEC-003-005-APP | SEC-003-005 Server actions and cookie-authenticated routes are protecte… | YELLOW | high | experimental.serverActions.allowedOrigins is not set (default same-origin check). Invoice and plan pay routes are POST. But /booking/[token]/pay is a GET that starts a Stripe checkout session (state change on GET, token… | Make booking pay a POST (form button) and add an Origin check helper for cookie-authenticated route handlers that change state. | next.config.ts:164, src/app/booking/[token]/pay/route.ts:34, src/app/settings/payments/start/route.ts:21 |
| F-SEC-003-006-APP | SEC-003-006 Server-side URL fetching is protected against SSRF | YELLOW | high | Twilio recording and message media fetch helpers restrict to Twilio hosts (twilio-recording, message-media tests pass). Other outbound fetches (geocoding, Google APIs, HIBP) use fixed hosts. Website intake / AI web tool… | Inventory every fetch() whose URL contains request/AI data and route them through one allowlisting helper with redirect: 'manual'. | src/lib/twilio.ts:1, src/lib/message-media.ts:1 |
| F-SEC-003-009-APP | SEC-003-009 Uploads are validated for type, size and content | YELLOW | high | business-documents bucket has a 50MB limit but allowed_mime_types = null; public-branding allows image/svg+xml (public bucket, SVG not sanitized at bucket level). site-videos and attachment-kinds tests pass for those up… | Set allowed_mime_types on business-documents; remove image/svg+xml from public-branding or sanitize SVG server-side; document limits per upload. | next.config.ts:180 |
| F-SEC-003-020-APP | SEC-003-020 Webhook processing is idempotent and rejects replays | YELLOW | high | Payment recording is keyed on checkout/refund IDs (comments and RPC design: 'a retry never records a payment twice'); stripe_webhook_events (unique event id) is unused by code. Twilio status updates are not keyed on an … | Use stripe_webhook_events for event-level dedupe; add a replay test for paid->refunded->paid ordering. | src/lib/job-prepayment-pay.ts:521, src/app/api/stripe/webhook/route.ts:56 |
| F-SEC-004-002-APP | SEC-004-002 Secrets are inventoried and held in a secrets manager | YELLOW | high | Secrets live in Vercel (mostly 'sensitive' type) and Supabase Vault (4 secrets). No inventory document with owner and rotation interval. BLOB_READ_WRITE_TOKEN is stored as non-sensitive 'encrypted' type across all envir… | Write docs/security/secrets-inventory.md (name, purpose, owner, store, environments, rotation interval); convert BLOB_READ_WRITE_TOKEN to Sensitive. |  |
| F-SEC-004-005-APP | SEC-004-005 Repository and CI prevent secret commits | YELLOW | high | .gitignore excludes .env*; .claude/settings.json runs .claude/never-secret/hooks/run.sh on every PostToolUse. GitHub secret scanning/push protection status not visible (no gh access used). | Confirm GitHub secret scanning and push protection are on for the repository. | .gitignore:34, .claude/settings.json:1 |
| F-SEC-004-011-APP | SEC-004-011 Dependencies are scanned and patched within defined timefra… | YELLOW | high | npm audit --omit=dev: 0 vulnerabilities (2026-11-25). package-lock.json committed. No CI or Dependabot (.github absent) and no documented remediation timeframes. | Add Dependabot/CI audit with documented SLAs (critical 7d, high 30d). | package-lock.json:1 |
| F-SEC-004-013-APP | SEC-004-013 Agent tooling (Claude Code hooks, skills, MCP servers) is r… | YELLOW | high | .claude/settings.json runs a vendored never-secret hook on every tool use; .claude/COMMANDS.md inventories skills. Agent sessions have Supabase MCP connected to the production project with apply_migration/execute_sql av… | Restrict the Supabase MCP connection to read-only (or a branch) by default; record review of the never-secret hook version. | .claude/settings.json:1, .claude/never-secret/hooks/run.sh:1 |
| F-SEC-005-004-APP | SEC-005-004 Admin and permission changes are logged | YELLOW | high | Platform admin actions, unmasking and impersonation are written to platform_admin_audit / impersonation_sessions with reason (admin-trace test passes). Tenant-side invites, removals and role changes were not found writi… | Write activity_events (server-side) for invitation create/revoke/accept, member removal and role change. | src/app/settings/team/actions.ts:37 |
| F-SEC-005-007-APP ⚖️ | SEC-005-007 Contract signature events are logged with integrity evidence | YELLOW | high | Contracts store signed_body_hash; triggers keep_signed_contract_text/figures/keep_contractor_signature block edits after signing; contract signing captures client IP (contract/[token]/actions.ts:57-62). Tests pass. cont… | Confirm view/send events are recorded; restrict contract_signers updates after signature. | src/app/contract/[token]/actions.ts:57 |
| F-SEC-005-008-APP | SEC-005-008 Financial changes are logged with before and after values | YELLOW | high | invoice_revisions stores previous/next, subtotal_delta_cents, credit_due_cents and created_by; activity timeline and refund tests pass. Payment records and discount edits were not all confirmed to log before/after. invo… | Extend revision logging to manual payments, discounts and deposit applications. |  |
| F-SEC-005-011-APP | SEC-005-011 Every MCP tool call is logged | YELLOW | high | mcp_call_log has organization_id, method, tool_name, redacted arguments, is_error/http_status, duration_ms, session_key; owners/admins can read; retention cron. No explicit connection/credential id column. mcp-log-redac… | Add the credential/connection id to each row (details in SEC-007 findings). | src/lib/mcp-log.ts:1 |
| F-SEC-005-012-APP | SEC-005-012 Logs contain no secrets and minimal personal information | RED | high | src/app/booking/[token]/pay/route.ts:104 logs the booking capability token via console.error (Vercel runtime logs). Capability and MCP tokens are in URL paths, so Vercel request logs contain them; no retention/access st… | Remove the token from that log line; document Vercel log retention/access; move tokens out of paths (fragment or POST) where practical. | src/app/booking/[token]/pay/route.ts:104 |
| F-SEC-007-007-APP | SEC-007-007 Tool arguments are validated server-side | YELLOW | high | The protocol layer passes arguments straight to handlers without validating against inputSchema (src/lib/mcp-protocol.ts:162-171); additionalProperties:false is declared but not enforced, so unknown fields are silently … | Validate every tools/call against the tool's inputSchema in handleOne (e.g. Ajv in strict mode, or zod schemas generated per tool), rejecting unknown fields and out-of-range values with isError before the handler runs; … | src/lib/mcp-protocol.ts:162, src/lib/mcp-protocol.ts:208, src/lib/mcp-business-tools.ts:711 |
| F-SEC-007-011-APP | SEC-007-011 AI and MCP outputs do not disclose sensitive information | RED | high | No grant model exists (SEC-007-003), so every business connection can read full customer text conversations (list_text_conversations / get_text_conversation), customer details, invoices and proposal provider receipts. C… | Put text history and any recording/transcript access behind a separate opt-in grant; trim tool responses to the fields needed (e.g. omit email/phone from search results unless asked); add response-shape tests for the te… | src/lib/mcp-text-history.ts:36, src/lib/mcp-text-history.ts:51, src/lib/mcp-customer-tools.ts:36 |
| F-SEC-007-016-APP | SEC-007-016 AI-produced financial figures are computed deterministically | YELLOW | high | Totals are computed in code in cents: add_job_lines parses lines and totals them (mcp-job-lines tested), bill_job and create_invoice use invoiceTotals, change orders and discounts recompute via tested math, the assistan… | Make create_invoice/set_invoice_amount derive totals from priced lines (or require the human to type the figure in Volteira); keep the model's role to proposing lines, not totals. | src/lib/mcp-business-tools.ts:601, src/lib/assistant-confirmed.ts:354, src/lib/mcp-job-lines.ts:1 |
| F-SEC-007-017-APP | SEC-007-017 MCP connection tokens are revocable, hashed and short-lived… | YELLOW | high | Tokens are stateless HMAC-SHA256 signed payloads (256-bit MAC; strength depends on MCP_SESSION_SECRET, not inspected); the credential table stores no secret at all (schema inspected), the URL is returned once by createC… | Shorten business credential life (e.g. 30-90 days with renewal prompt) or move to OAuth refresh tokens; move the secret out of the URL path into the Authorization header; check MCP_SESSION_SECRET is >=32 random bytes; a… | src/lib/mcp-session-token.ts:78, src/lib/mcp-session-token.ts:103, src/app/settings/chatgpt/chatgpt-actions.ts:18 |
| F-CA-001-019-APP | CA-001-019 Consent and choice architecture: no dark patterns; symmetry… | YELLOW | medium | The SMS box is separate, optional and unchecked (public-booking-flow.tsx:511-541). But consent is also inferred without any choice when staff enter a number (manual-sms-consent.ts:278-326), and the required booking agre… | Offer the customer an explicit choice on every consent path; separate contact consent from the fee agreement. | src/components/public-booking-flow.tsx:505-541, src/lib/manual-sms-consent.ts:278-326 |
| F-CA-002-007-APP ❔ | CA-002-007 Do Not Track disclosure | RED | medium | No DNT disclosure in the tenant policy, and Volteira has no policy. | Add a DNT statement (e.g., no cross-site tracking, so DNT changes nothing). | src/app/legal/[org]/privacy/page.tsx:34-117 |
| F-CA-002-008-APP ❔ | CA-002-008 Third-party tracking disclosure | RED | medium | No third-party tracking disclosure in the policy (neither that none occurs nor that Stripe checkout/others may collect). Source shows no analytics trackers, but the disclosure is required either way. | Add a third-party tracking statement and verify it against a network scan. | src/app/legal/[org]/privacy/page.tsx:34-117, src/lib/csp.ts:21 |
| F-CA-003-001-APP ❔ | CA-003-001 Secure disposal of customer records | RED | medium | No disposal capability: 'delete' only sets archived_at and only for pending-review contacts (customers/actions.ts:13-53); there is no purge job, no deletion of Twilio recordings, storage objects or vendor copies. | Implement retention-driven hard deletion across database, storage, Twilio recordings and vendor copies, with a deletion log. | src/app/customers/actions.ts:13-53, src/app/api/twilio/recordings/[recordingSid]/route.ts |
| F-CA-003-004-APP ❔ | CA-003-004 AG guidance: CIS Critical Security Controls as minimum leve… | RED | medium | No CIS mapping exists in docs/security; no MFA enforcement found for owner or admin accounts. | Create a CIS Controls mapping and enforce MFA. | docs/security |
| F-CA-009-008-APP ⚖️ ❔ | CA-009-008 Online seller disclosures: legal name, address, refund poli… | RED | medium | The booking form shows the business display name and a vague cancellation line; the pay-link and booking pages show business name and phone only. No legal business name, street address or refund policy is shown before C… | Show legal name, street address and a refund/cancellation policy link on the booking form, booking page and /pay/[token] before the Pay button; pull from organization settings. | src/components/public-booking-flow.tsx:505, src/lib/booking-page-copy.ts:54, src/lib/job-prepayment-pay.ts:466 |
| F-CA-010-003-APP ❔ | CA-010-003 Separately stated tax reimbursement must not exceed tax due… | RED | medium | Tax is a free-typed amount with no rate, no taxable base and no per-line computation; the customer invoice shows only 'Tax $X'. Nothing prevents collecting more than is due (e.g., tax typed on non-taxable labor), and no… | Compute tax from a configured rate and the taxable lines in integer cents (documented half-up rounding), show 'Tax (rate% on $base)', and warn when a manual tax exceeds rate x taxable base. | src/app/jobs/[jobId]/invoice-actions.ts:83, src/app/invoice/[token]/page.tsx:214, src/lib/invoice-adjustments-server.ts:197 |
| F-CSLB-002-007-APP ⚖️ | CSLB-002-007 Commercial and new-construction contracts | YELLOW | medium | No commercial template exists; the generic contract prints name and license in the letterhead and footer when license_number is set (rendered synthetic contract), but omits it silently when empty. | Add commercial and new-construction templates; require the license number on every contract type. | src/lib/pdf/letterhead.tsx:121, src/lib/pdf/letterhead.tsx:149 |
| F-CSLB-002-008-APP ❔ | CSLB-002-008 Platform contract-type selector produces the correct templa… | RED | medium | None of these facts or a rule-set version are recorded. | Add the fields and a rule_set_version column on contracts set at generation. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-CSLB-003-020-APP | CSLB-003-020 List of Documents to be Incorporated into the Contract | RED | medium | Missing; no way to list incorporated documents (estimate, drawings, permit). | Add the heading and a list built from documents the tenant marks as incorporated. | src/lib/contract-template.ts:193 |
| F-CSLB-003-029-APP ⚖️ ❔ | CSLB-003-029 Contract language matches the language of negotiation | RED | medium | Contracts are English-only; customer-language.ts records a preferred language but it is not used by contract generation, and no translated statutory text exists. | Use the customer's language to select a counsel-approved translated template and notices (Spanish first). | src/lib/customer-language.ts:1, src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-CSLB-004-006-APP ⚖️ | CSLB-004-006 Down payment cap after change orders | RED | medium | The cap is recomputed from the job's current line total, which includes approved change-order lines; after a change order raises the total, the plan can be re-saved with a larger deposit (up to the new cap) and requeste… | Freeze the down-payment cap at the signed contract's price; refuse plan edits that raise the deposit after signing pending legal review. | src/lib/payment-plan-server.ts:45, src/lib/payment-plan-server.ts:126, src/lib/job-prepayment-pay.ts:730 |
| F-CSLB-006-003-APP ❔ | CSLB-006-003 Change order references the original contract and shows rev… | RED | medium | References the job and contract signing date, prior amount, net change and revised total; no contract identifier and no revised payment schedule. | Add the base contract reference and revised schedule block. | src/lib/change-order-document.ts:51 |
| F-CSLB-006-005-APP ⚖️ | CSLB-006-005 Change order that converts a service-and-repair job above $… | RED | medium | No service-and-repair type exists, so no conversion is possible. | Implement with CSLB-002-003. | src/lib/change-order-document.ts:51 |
| F-CSLB-007-005-APP ⚖️ ❔ | CSLB-007-005 Cancellation notice in the language of the oral sales prese… | RED | medium | No notice in any language; contracts English-only. | Provide translated notices (see CSLB-003-029). | src/lib/contract-template.ts:193 |
| F-CSLB-007-012-APP ⚖️ | CSLB-007-012 Federal Cooling-Off Rule cross-reference (door-to-door sale… | RED | medium | No cancellation notice of any kind. | Use a combined notice satisfying both 16 CFR 429 and Civ. 1689.7 after legal review. | src/lib/contract-template.ts:193 |
| F-CSLB-009-003-APP ⚖️ | CSLB-009-003 No false or misleading representations ('licensed, bonded a… | YELLOW | medium | No such badge is generated from data; the AI writing tool accepts free-text claims (journal-manager placeholder suggests 'say we are licensed and insured') with no verification. | Block or require verification before AI/marketing text claims licensed/bonded/insured. | src/components/journal-manager.tsx:179 |
| F-CSLB-009-004-APP | CSLB-009-004 Service charge disclosure in advertising (service and repai… | YELLOW | medium | Booking copy shows a 'Diagnostic fee' and its amount on the booking flow; other advertising surfaces and phone scripts not verified in this slice. | Add explicit 'a service charge applies' wording to all advertising surfaces and the voice script. | src/lib/booking-page-copy.ts:29 |
| F-CSLB-009-005-APP ❔ | CSLB-009-005 Platform rendering of license number on all tenant-facing o… | YELLOW | medium | organizations.license_number via businessLetterhead feeds both invoice and contract PDFs; no test asserts presence and estimates/booking pages use other paths. | Add a shared licenseLine source for all outbound surfaces and a test that each renders it. | src/lib/pdf/store.ts:69, src/lib/pdf/letterhead.tsx:121 |
| F-CSLB-009-006-APP | CSLB-009-006 Advertised business name matches license | YELLOW | medium | Same as CSLB-001-005: single free-text name, never compared with the license record. | See CSLB-001-005. | src/lib/pdf/store.ts:69 |
| F-CSLB-010-005-APP ⚖️ | CSLB-010-005 Home improvement salesperson registration | RED | medium | No HIS field or salesperson attribution exists. | Add HIS number per member and salesperson per job with a warning when missing. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-CSLB-012-005-APP | CSLB-012-005 CGL disclosure accuracy | RED | medium | No CGL statement or insurance data exists. | Store CGL policy/expiry and prompt re-confirmation (see CSLB-003-022). | src/app/settings/business/actions.ts:81 |
| F-CSLB-012-007-APP ❔ | CSLB-012-007 Legal holds suspend deletion | RED | medium | No legal-hold concept in src or migrations. | Add legal_hold flags checked by every deletion function. | supabase/migrations/20261105010000_admin_data_removal.sql:119 |
| F-CSLB-012-008-APP ❔ | CSLB-012-008 Tenant export and offboarding preserves five-year records | RED | medium | The reports CSV export covers report datasets only (no contracts or signed PDFs); wipe_organization_data deletes contracts and documents without an export/custody step. | Add a full tenant archive export (contracts, signed PDFs, audit trail, change orders, payments) and require it or retention before organization wipe. | src/app/reports/export/route.ts:17, supabase/migrations/20261105010000_admin_data_removal.sql:119 |
| F-FED-001-001-APP | FED-001-001 Electronic signatures and records may not be denied legal e… | YELLOW | medium | Customer adopts a typed or drawn signature after ticking a consent box; sign_contract_in_app stores method, name, image, signed_at, IP, user agent and a SHA-256 of contracts.body computed in the database; keep_signed_co… | Pass and store esign_consent_version and consent_at with the signature (new columns written only inside sign_contract_in_app and protected by keep_signed_contract_text); hash the stored signed PDF bytes as well as the b… | src/app/contract/[token]/actions.ts:89, src/app/contract/[token]/actions.ts:103, src/lib/esign-consent.ts:20 |
| F-FED-001-005-APP | FED-001-005 Pre-consent disclosure: procedures to withdraw consent and … | RED | medium | Procedure is described (tell the business by phone, text or email). There is no mechanism to record a withdrawal: no column, table or UI; sendSigningLink and sendSignedContractCopy send electronic records regardless. | Add an e-records withdrawal flag on the customer (settable by staff and from the customer's link), block electronic sending of contracts/change orders/notices when set, and log the event. | src/lib/esign-consent.ts:24, src/app/jobs/[jobId]/contract-actions.ts:635, src/lib/contract-copy.ts:44 |
| F-FED-002-013-APP ⚖️ ❔ | FED-002-013 Effect of McLaughlin Chiropractic v. McKesson on FCC TCPA i… | YELLOW | medium | The send gate relies on a permissive reading that a number given for service is consent (no record needed; messaging-rules.ts:94-100 comment), and on inbound first texts as opt-in. These are FCC-interpretation-dependent… | Have counsel confirm the consent theories; implement the stricter default (explicit recorded consent) per FED-002-001. | src/lib/messaging-rules.ts:90-108, src/lib/manual-sms-consent.ts:232-240 |
| F-FED-005-002-APP ⚖️ | FED-005-002 Effective communication and auxiliary aids, including alter… | YELLOW | medium | Alternatives exist (online booking page, SMS intake, transfer to a person via twilio-transfer). The voice prompt tells the AI to end calls with 'a recording or robocall' without asking (grok-voice.ts:217) and has no ins… | Add explicit relay-call handling (never classify as robocall, transfer or continue patiently) and test it. | src/lib/grok-voice.ts:197, src/lib/grok-voice.ts:217, src/lib/twilio-transfer.ts |
| F-FED-005-003-APP | FED-005-003 DOJ web accessibility guidance for public accommodations (n… | RED | medium | Some practices exist in code (labels, aria, tokens), but there is no accessibility statement or accessibility feedback channel anywhere in the app or tenant pages. | Publish an accessibility statement with a contact method on Volteira and tenant pages. | src/app/legal/[org]/layout.tsx, src/components/public-booking-flow.tsx |
| F-FED-006-001-APP | FED-006-001 Keep books and records sufficient to establish income, dedu… | YELLOW | medium | Payments/invoices/jobs/customers/activity CSV exports exist, but the payments export reads only invoice_payments and booking payments: pay-link and cash prepayments held in job_prepayments before an invoice is sent, inv… | Add refunds (invoice_refunds, booking refunds), unapplied job_prepayments and per-payment application/processing fees to the payments export (or a new 'ledger' export); add a supplier-receipt/expense export; document ea… | src/lib/report-exports.ts:19, src/lib/report-exports.ts:110, src/lib/report-exports.ts:115 |
| F-FED-006-003-APP ❔ | FED-006-003 Electronic storage systems and machine-sensible records req… | YELLOW | medium | Integer-cent storage, invoice PDFs (/invoice/[token]/pdf), invoice_revisions with unique (invoice_id, revision_number), and tenant-reference guard triggers exist. However sent invoices remain UPDATE-able by billing memb… | Add a trigger that freezes subtotal/tax/credit/total on non-draft invoices except via the revision RPC that writes invoice_revisions; document CSV column definitions and the PDF as the legible hardcopy. | src/lib/invoice-revision-server.ts:1, src/lib/invoice-pdf-file.ts:1, src/lib/report-exports.ts:19 |
| F-FED-007-004-APP ⚖️ ❔ | FED-007-004 Determine Volteira's PCI role as a Stripe Connect platform … | YELLOW | medium | Webhook verifies signatures with constructEvent against two secrets and rejects unsigned/invalid requests; pay-link and invoice handlers only believe events from the business's own connected account. No documented QSA/S… | Obtain written Stripe/QSA guidance on the platform's validation level and file it; add a unit test that the webhook route rejects a bad signature. | src/app/api/stripe/webhook/route.ts:27, src/app/api/stripe/webhook/route.ts:48, src/lib/job-prepayment-pay.ts:542 |
| F-FED-007-013-APP ❔ | FED-007-013 Stripe Connect platform obligations: KYC onboarding, refund… | YELLOW | medium | Onboarding uses Stripe-hosted account links (Stripe presents its agreement); settings payments page states Volteira's 1% comes out of each payment; losses set to 'stripe' with direct charges; refunds via Stripe with ref… | State in Volteira's Terms of Service the 1% fee and the refund/chargeback/negative-balance allocation; document Stripe restricted-business screening at onboarding. | src/lib/stripe-connect.ts:138, src/app/settings/payments/page.tsx:84, src/lib/invoice-refund-server.ts:184 |
| F-FED-009-003-APP | FED-009-003 Provide simple mechanisms to stop recurring charges | YELLOW | medium | 'Manage billing' opens the Stripe Billing Portal for owners/admins, and cancel_at_period_end is synced and shown as 'Access ends <date>'. Whether the portal configuration allows cancellation is a Stripe dashboard settin… | Enable cancellation in the Billing Portal configuration (or pass a configuration id with subscription_cancel enabled) and add an in-app 'Cancel plan' link that opens the portal cancel flow directly. | src/app/account/actions.ts:415, src/app/account/actions.ts:435, src/app/account/page.tsx:266 |
| F-FED-010-002-APP ❔ | FED-010-002 AI capability and performance claims must be truthful and s… | YELLOW | medium | In-app copy on the Use in ChatGPT page states 'It always asks you before it changes anything or messages a customer.' That depends on the model honoring the confirmed flag; Volteira does not enforce it server-side (SEC-… | Either enforce approval in Volteira (SEC-007-009) or reword to 'ChatGPT or Claude is instructed to ask you before...'; review volteira.com marketing copy for AI claims. | src/app/settings/chatgpt/chatgpt-connection-card.tsx:86 |
| F-FED-010-005-APP ⚖️ ❔ | FED-010-005 AI vendor terms and data-use limits (Anthropic, OpenAI, xAI) | RED | medium | Vendor agreements and provider-side retention/training settings are not visible from the repository (BLUE portion). What is observable is missing: the tenant-facing privacy policy names no AI providers or AI processing;… | Obtain and file the Anthropic, xAI (and OpenAI, if used) commercial terms and record no-training/retention settings (zero data retention where available); list AI subprocessors in the privacy policy; tell owners connect… | src/app/legal/[org]/privacy/page.tsx:1, src/lib/sms-intake-runner.ts:53, src/app/api/xai/voice/route.ts:135 |
| F-SEC-001-003-APP | SEC-001-003 Password policy follows modern length-based rules | YELLOW | medium | App enforces 10 characters on password change and reset (server-side: src/lib/password-reset.ts MIN_NEW_PASSWORD_LENGTH=10, account/actions.ts:449) but sign-up enforces 8 only in the browser (auth-form.tsx minLength=8) … | Set Supabase Auth minimum password length to at least 10 (matching change/reset) in the production dashboard and in config.toml; document the policy; optionally move sign-up to a server action so length and breach check… | src/components/auth-form.tsx:37, src/lib/password-reset.ts:21, src/app/account/actions.ts:449 |
| F-SEC-001-004-APP | SEC-001-004 New passwords are checked against breached-password lists | YELLOW | medium | HIBP k-anonymity check (src/lib/pwned-password.ts) runs server-side on reset and change, but at sign-up only in the browser (bypassable by calling Supabase Auth directly). It fails open silently: catch returns false wit… | Enable Supabase leaked-password protection (or move sign-up to a server action that runs passwordIsBreached); log (without the password or hash) when the HIBP lookup fails or times out. | src/lib/pwned-password.ts:46, src/components/auth-form.tsx:43, src/app/reset-password/actions.ts:27 |
| F-SEC-001-009-APP | SEC-001-009 Lost MFA factor recovery requires identity proofing | RED | medium | No MFA, no factor management UI, and no documented recovery procedure in docs/security. | Write a lost-factor recovery runbook (identity proofing at least as strong as enrollment, performed by platform staff, logged to platform_admin_audit) and ship self-service factor revocation with MFA. | src/app/account/page.tsx:384 |
| F-SEC-004-003-APP | SEC-004-003 Secrets are rotated on schedule and on personnel or inciden… | RED | medium | No rotation procedure or record exists in the repository. | Document zero-downtime rotation steps per secret (Stripe webhook roll, Supabase key rotation, Twilio secondary token) and log each rotation. |  |
| F-SEC-005-003-APP | SEC-005-003 Authorization failures and cross-tenant attempts are logged | RED | medium | Webhook signature failures return 403 without logging (e.g. twilio/inbound route.ts:36-44); RLS denials and invalid capability tokens are not logged; a few console.error lines exist for mismatched Stripe accounts only. | Log (rate-limited) authorization failures and invalid signatures with route, tenant and reason. | src/app/api/twilio/inbound/route.ts:36, src/lib/job-prepayment-pay.ts:544 |
| F-SEC-005-006-APP | SEC-005-006 Access to and export of personal information is logged | RED | medium | reports/export and twilio/recordings serve data without writing any audit event; admin views log through platform_admin_audit. | Write an audit event for each export (report, range, row count) and each recording playback. | src/app/reports/export/route.ts:17, src/app/api/twilio/recordings/[recordingSid]/route.ts:9 |
| F-SEC-005-009-APP ⚖️ | SEC-005-009 Deletions are logged | RED | medium | Members can DELETE customers (policy) and no deletion audit event was found. | Add delete triggers that write a PI-free audit row (table, id, actor, time). |  |
| F-SEC-006-004-APP | SEC-006-004 Escalation paths are defined | RED | medium | No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). | Document escalation thresholds and contacts. |  |
| F-SEC-006-009-APP | SEC-006-009 Vendors are coordinated in incident response | RED | medium | No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). | Record vendor security contacts and subscribe to status/security feeds. |  |
| F-SEC-006-012-APP | SEC-006-012 Incident response is exercised and improved | RED | medium | No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). | Schedule a tabletop (cross-tenant exposure, leaked service-role key) within 90 days. |  |
| F-SEC-006-013-APP ❔ | SEC-006-013 Incident response plan covers payment-related incidents (PC… | RED | medium | No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). | Add a payment-incident runbook covering Stripe Checkout redirect integrity and Stripe notification. |  |
| F-SEC-007-015-APP | SEC-007-015 AI usage is bounded per tenant | RED | medium | A monthly per-tenant allowance (takeAiUse) guards the in-app assistant, materials chat, contract scope, journal and receipts (rules tested), and Anthropic calls set max_tokens. But AI paths triggered from outside are no… | Count SMS-intake and voice sessions against the tenant allowance (with a per-number/per-conversation rate limit so a flood of inbound texts cannot spend a tenant's AI budget); add per-credential rate limiting and a batc… | src/lib/sms-intake-runner.ts:158, src/app/api/xai/voice/route.ts:29, src/app/api/mcp/[token]/route.ts:68 |
| F-CA-008-002-APP ❔ | CA-008-002 Clear and conspicuous automatic renewal terms before the su… | RED | low | Same gap as FED-009-001: no renewal terms or cancellation policy shown before Stripe Checkout. | Implement the FED-009-001 disclosure block adjacent to the consent checkbox. | src/app/account/actions.ts:348, src/app/account/actions.ts:384, src/app/account/page.tsx:280 |
| F-CA-008-003-APP ❔ | CA-008-003 Express affirmative consent to renewal terms and consent re… | RED | low | No consent capture or record (see FED-009-002). | Implement the FED-009-002 consent checkbox and retain records for at least three years or one year after termination, whichever is longer. | src/app/account/actions.ts:348, src/app/account/actions.ts:384, src/app/account/page.tsx:280 |

## P3

| Finding | Requirement | Observed | Severity | Problem | Fix | Files |
|---|---|---|---|---|---|---|
| F-CA-001-015-APP | CA-001-015 Right to opt out of sale/sharing and 'Do Not Sell or Share'… | YELLOW | high | No analytics, ad pixels or tag managers appear in source (no gtag, posthog, @vercel/analytics, fbq, GTM); the tenant policy states no sale or sharing. Not verified by a network scan, and the CSP allows scripts from any … | Capture a network observation of public pages; tighten script-src to known origins. | src/lib/csp.ts:21, src/app/legal/[org]/privacy/page.tsx:75-87 |
| F-CA-006-008-APP ⚖️ ❔ | CA-006-008 Chat widgets and session replay on websites (wiretap theory) | YELLOW | high | No chat widget, session replay or keystroke-capture script was found in source or package.json; not confirmed by a network scan, and CSP script-src allows any https origin (csp.ts:21). | Record a network observation of public pages; restrict script-src. | src/lib/csp.ts:21 |
| F-CA-006-009-APP ⚖️ ❔ | CA-006-009 Pen register / trap-and-trace theory for website trackers | YELLOW | high | No pixels or analytics found in source (see CA-001-015); Google Maps JS loads only on internal staff pages (job-map.tsx, route-builder.tsx). Not confirmed by network scan. | Confirm with a network scan of tenant and Volteira public pages. | src/components/job-map.tsx:116, src/lib/csp.ts:21 |
| F-FED-003-002-APP | FED-003-002 No false or misleading header information (applies to comme… | YELLOW | high | emailSender builds 'Business Name <configured address>' and strips characters that could forge a header (booking-confirmation.ts:698-708), tested; reply_to routes to the business. Domain authentication (SPF/DKIM/DMARC) … | Capture Resend domain verification and DNS SPF/DKIM/DMARC records as evidence. | src/lib/booking-confirmation.ts:698-708, src/lib/email.ts:91-106 |
| F-FED-008-001-APP | FED-008-001 No fake or false consumer reviews or testimonials, includin… | YELLOW | high | No review solicitation, display or testimonial feature exists in the app or front page. The AI assistants (in-app, ChatGPT/Claude MCP, journal writer) have no instruction refusing to write reviews or testimonials in a c… | Add a system-prompt rule to every assistant refusing to compose reviews/testimonials for a customer or employee, and a test. | src/lib/assistant-brief.ts, src/lib/journal-writer.ts, src/lib/grok-voice.ts |
| F-FED-008-007-APP ⚖️ | FED-008-007 Consumer Review Fairness Act: form contracts may not restri… | YELLOW | high | Volteira fills the tenant's own contract document and adds only payment terms and the down-payment notice (contract-template.ts:1-16; payment-plan.ts:57, 255); the SMS terms page has no review clause. Tenant-uploaded co… | Warn on or refuse contract templates containing non-disparagement/review-penalty language; keep any future Volteira terms free of them. | src/lib/contract-template.ts:1-16, src/lib/payment-plan.ts:250-256, src/app/legal/[org]/terms/page.tsx |
| F-SEC-001-018-APP | SEC-001-018 OAuth integration flows (Google Drive/Calendar) are protect… | YELLOW | high | Google Drive and Calendar flows create a signed state containing organization and user (createDocumentOAuthState), store it in an httpOnly cookie, compare on callback and re-check the signed-in user and owner/admin memb… | Add PKCE (code_challenge S256) to both Google flows; document the scopes and why each is needed. | src/app/api/integrations/google-drive/callback/route.ts:44, src/app/api/integrations/google-calendar/callback/route.ts:17, src/app/api/integrations/google-calendar/connect/route.ts:16 |
| F-SEC-003-004-APP | SEC-003-004 Markdown and chat rendering is safe for untrusted and AI co… | YELLOW | high | The chat-markdown parser (src/lib/chat-markdown.ts) recognises only bold, inline code and bullet lines and returns plain text segments, so model text has no link or HTML path by design (source review). Its 10 passing te… | Add tests that feed raw HTML, javascript:/data: links and markdown images through parseChatMarkdown and the renderer and assert they come out as inert text. | src/lib/chat-markdown.ts:1 |
| F-SEC-003-011-APP | SEC-003-011 Input is validated at a trusted layer | YELLOW | high | Money rules are integer cents and tested (money-input, invoice-math, invoice-refund); DB constraints such as invoice_payments.amount_cents > 0 exist. Validation is hand-written per action (no schema library); not unifor… | Adopt a schema validator (zod is already an override dependency) for server action inputs. | src/lib/money-input.ts:1, src/lib/invoice-math.ts:1 |
| F-SEC-003-019-APP | SEC-003-019 Resend and other inbound webhooks verify signatures | YELLOW | high | xAI voice webhook verifies webhook-id/timestamp/signature (xai-webhook.test.ts passes). Operations worker compares VOLTEIRA_SUPERVISED_WORKER_TOKEN with timingSafeEqual. Website intake uses hashed bearer keys. No Resend… | Set XAI_WEBHOOK_SECRET in Production (or remove the route); return a generic 403 body. | src/app/api/xai/voice/route.ts:33, src/app/api/operations/worker/route.ts:23 |
| F-SEC-004-006-APP | SEC-004-006 All traffic is encrypted in transit with certificate valida… | YELLOW | high | No rejectUnauthorized:false or NODE_TLS_REJECT_UNAUTHORIZED in src/scripts; HSTS set; all providers called over https. DB tooling SSL mode not documented. | Document sslmode=require for direct DB connections (scripts/security). | next.config.ts:204 |
| F-SEC-007-019-APP | SEC-007-019 AI output is handled as untrusted before rendering or use | YELLOW | high | Model output is rendered as React text (auto-escaped); the only dangerouslySetInnerHTML uses safeJsonLd for journal JSON-LD, which escapes <, >, & and line separators; model-proposed store product URLs pass storeProduct… | Document the review; add a unit test for safeJsonLd with a </script> payload and for storeProductUrl rejecting javascript:/lookalike hosts; add a lint rule forbidding dangerouslySetInnerHTML outside json-ld. | src/components/journal-structured-data.tsx:96, src/lib/json-ld.ts:24, src/lib/store-price-rules.ts:75 |
| F-CA-004-004-APP ❔ | CA-004-004 Alternate notice for breaches of online account credentials | RED | medium | No procedure for account-credential breaches (owner/staff passwords via Supabase auth). | Add the credential-breach notice procedure (no notice to the compromised email). | docs/security |
| F-CA-005-006-APP ❔ | CA-005-006 Errors in automated transactions | YELLOW | medium | Signing page shows the full contract text and a summary of the stored figures above it; unsigned contracts with blanks cannot be signed. Not exercised in a browser in this audit. | Verify in browser; add an explicit 'review totals, deposit and schedule' step before the sign button. | src/app/contract/[token]/page.tsx:1, src/lib/contract-signing.ts:141 |
| F-CA-006-001-APP ❔ | CA-006-001 Commercial email: no falsified headers, unauthorized third-… | YELLOW | medium | Same as FED-003-002: From header names the business and is sanitized (tested); subjects are factual transactional subjects; domain authentication not verified. No commercial email is sent. | Capture SPF/DKIM/DMARC evidence for the sending domain. | src/lib/booking-confirmation.ts:698-708, src/lib/email.ts:91-106 |
| F-CA-009-003-APP ⚖️ ❔ | CA-009-003 Drip pricing: advertised price must include all mandatory f… | YELLOW | medium | The booking fee shown in the form is the same amount sent to Checkout (unit_amount = feeCents); Volteira's 1% and Stripe fees are deducted from the business, not added; the admin fee is built into line prices (tested); … | Add a test that the checkout line item amount equals the displayed booking fee for standard and emergency outcomes. | src/components/public-booking-flow.tsx:143, src/lib/booking-checkout.ts:145, src/lib/invoice-math.ts:80 |
| F-CSLB-001-004-APP ⚖️ | CSLB-001-004 C-7 Low Voltage Systems classification scope | RED | medium | No classification data, so a C-7-only tenant is not distinguished from a C-10 tenant. | Same classification record as CSLB-001-003 with a C-7 scope warning. | src/app/settings/business/actions.ts:81 |
| F-CSLB-003-014-APP ⚖️ | CSLB-003-014 Finance Charge heading, if financed | YELLOW | medium | No financing feature; the app has an admin/card fee feature whose treatment as a finance charge is undetermined. No Finance Charge heading support. | Legal review of whether admin/card fees are finance charges; add the heading when applicable. | src/lib/admin-fee.ts:1 |
| F-CSLB-003-027-APP ⚖️ | CSLB-003-027 Delay and commencement: failure to substantially commence o… | YELLOW | medium | No dedicated reschedule-reason capture found in src/lib; activity history may record reschedules without reasons. Statutory delay statement not present. | Capture a reason when an approximate start/completion date changes; legal confirmation of any required statement. | src/lib/activity.ts:1 |
| F-CSLB-003-030-APP ⚖️ | CSLB-003-030 Arbitration clause formatting and initials (if included) | YELLOW | medium | The default template has no arbitration clause. Tenant-pasted templates may include one, and the app can neither format it as required nor capture separate initials. | Detect arbitration language in tenant templates and refuse it unless rendered via a compliant arbitration component with separate initials. | src/lib/contract-template.ts:193, src/lib/contract-layout.ts:21 |
| F-CSLB-007-009-APP ⚖️ ❔ | CSLB-007-009 Service and repair contract: work may start on delivery of … | YELLOW | medium | Not modeled: no service-and-repair type and no start gating, so the software neither supports nor misapplies this permission. | Implement with CSLB-002-003 (allow start after delivered_at for compliant S&R contracts). | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-CSLB-007-010-APP ⚖️ | CSLB-007-010 Seven-Day Right to Cancel for disaster-related repair contr… | RED | medium | No disaster flag or seven-day notice. | Add a disaster-repair flag that switches to the seven-day notice after legal confirmation. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-FED-001-012-APP ⚖️ | FED-001-012 Oral communications and recordings do not qualify as electr… | YELLOW | medium | No code path in the contract or change-order flows treats a call or voice-AI conversation as delivery; contracts and change orders are delivered only as web page/PDF. Not exhaustively verified across the voice intake an… | Add an explicit rule in the voice/assistant tools that required notices (contracts, cancellation rights, deposit terms) are always followed by a written record, and document it. | src/lib/grok-voice.ts:1, src/app/contract/[token]/actions.ts:89 |
| F-FED-001-013-APP ⚖️ | FED-001-013 Exclusions from ESIGN and state UETA interplay | YELLOW | medium | The app e-signs only contracts and change orders (contracts.kind check), none of which is an ESIGN 7003 excluded type; there is no explicit exclusion list or flag, and UETA-specific handling (CA-005) is absent. | Document the electronic-record inventory against 15 USC 7003 and Civ. Code 1633.3 and add a guard if new document types are added (e.g., cancellation or lien notices). | src/lib/pdf/contract-document.tsx:41 |
| F-FED-002-011-APP | FED-002-011 Calling-time restriction: telephone solicitations only betw… | YELLOW | medium | Quiet hours (default 21:00-08:00) are evaluated in the business's timezone, not the recipient's (messaging-rules.ts:134-160); the inbox can override them (messages/actions.ts:34-49) and the supervised executor defers du… | Evaluate quiet hours in the recipient's timezone (from service address or area code) inside sendSms for all non-urgent automated texts, including MCP send_text. | src/lib/messaging-rules.ts:134-160, src/app/messages/actions.ts:34-49, src/lib/supervised-executor.ts:64-117 |
| F-FED-002-012-APP | FED-002-012 Identification in artificial/prerecorded messages and calle… | YELLOW | medium | The AI greeting names the business first (tested in both the Gather and xAI paths). Outbound callbacks use the organization's own phone as caller ID (website-intake-runner.ts:206-229). The AI voicemail names the busines… | Add a test asserting the voicemail starts with the business name and contains the business number. | src/lib/voice-intake.ts:44-61, src/lib/website-intake.ts:218-231, src/lib/website-intake-runner.ts:206-229 |
| F-FED-008-008-APP | FED-008-008 Guides Against Deceptive Pricing: former price, comparable … | YELLOW | medium | No former-price or sale claims found. The booking page shows the diagnostic fee and the late-cancellation fee next to the agreement (public-booking-flow.tsx:505-507). Evidence is code-read only. | Verify on the rendered booking and pay pages that total charges are shown before payment. | src/components/public-booking-flow.tsx:505-507 |
| F-FED-008-009-APP | FED-008-009 Use of the word 'Free' (e.g., 'free estimate', 'free trial') | YELLOW | medium | The front page advertises 'Create free account' (front-page.tsx:274, 372) while account/page.tsx:98 notes membership is free only until a monthly price is set in Stripe; no terms of the free offer appear near the claim.… | State next to 'free' what is free and when charges would begin; require notice before any conversion to paid. | src/components/front-page.tsx:274, src/components/front-page.tsx:372, src/app/account/page.tsx:98 |
| F-SEC-001-007-APP | SEC-001-007 Sign-in, sign-up and reset do not reveal which accounts exi… | YELLOW | medium | Sign-in maps 'invalid login' to a generic message, but other Supabase error messages are shown verbatim (auth-form.tsx:73), so a sign-up error such as 'User already registered' would be displayed when email confirmation… | Map every sign-up/sign-in auth error to fixed generic text; keep email confirmation on in production (verify in dashboard) so signUp returns an obfuscated user for existing emails. | src/components/auth-form.tsx:73, src/components/forgot-password-form.tsx:42 |
| F-SEC-001-014-APP | SEC-001-014 Authentication cookies use secure attributes | YELLOW | medium | Supabase auth cookies are set by @supabase/ssr defaults (script-readable by design, SameSite=Lax, path /); the app passes the library options through unchanged (supabase/proxy.ts:316). Tenant custom domains are rewritte… | Document the @supabase/ssr cookie attributes and the CSP compensating control; verify in a browser that production cookies carry Secure; set cookieOptions { secure: true, sameSite: 'lax' } explicitly. | src/lib/supabase/proxy.ts:316, src/proxy.ts:62, src/app/api/integrations/google-calendar/connect/route.ts:15 |
| F-SEC-002-011-APP | SEC-002-011 Field-level access and response minimization | YELLOW | medium | Many loaders use explicit column lists, but technicians are allowed to see all billing ('Technicians can still see it all', billing-permission.ts:4) and RLS SELECT policies are member-wide. No role-based field minimisat… | Define which fields technicians need (costs, margins, payout data) and restrict them in loaders/RLS (column-level grants or views with security_invoker). | src/lib/billing-permission.ts:4 |
| F-SEC-003-008-APP | SEC-003-008 Redirects only go to allowlisted destinations | YELLOW | medium | getSafeNextPath resolves against a fixed base and rejects other origins (used by login and auth/callback). Google redirect_uri is built from configured origin. No unit test covers getSafeNextPath ('//evil' etc.). | Confirm Supabase Auth redirect allowlist and Google OAuth redirect URIs are exact-match in their consoles. | src/lib/auth-redirect.ts:1, src/app/auth/callback/route.ts:16 |
| F-SEC-003-010-APP | SEC-003-010 Untrusted files are served safely and scanned where risk wa… | YELLOW | medium | Documents are served through Supabase signed URLs (storage origin); app sets X-Content-Type-Options nosniff globally. No documented antivirus decision. | Record an AV-scanning decision with compensating controls; use download disposition for non-image signed URLs. | next.config.ts:201 |
| F-SEC-003-013-APP | SEC-003-013 Errors are generic to clients and fail closed | YELLOW | medium | src/app/error.tsx exists; actions return fixed messages. Fail-open choices: passwordIsBreached returns false on error; AI allowance allows use when count fails (ai-allowance.ts comment). xAI route returns 'XAI_WEBHOOK_S… | Log fail-open events; return a generic 403 body from webhooks. | src/app/error.tsx:1, src/lib/pwned-password.ts:58, src/app/api/xai/voice/route.ts:51 |
| F-SEC-003-015-APP | SEC-003-015 CORS is restrictive | YELLOW | medium | No route sets Access-Control-Allow-* (grep over src returns nothing), so browsers enforce same-origin. Live headers not captured. | Capture response headers from representative /api routes (including preflight OPTIONS) and confirm no Access-Control-Allow-* header is returned. |  |
| F-SEC-003-023-APP | SEC-003-023 Email/SMS composition resists header and template injection… | YELLOW | medium | Email goes through Resend API JSON (no raw headers); invite email validates address with a simple anchored regex. Not exhaustively reviewed for regex backtracking or object merges. | Run a ReDoS linter (eslint-plugin-regexp) and review spreads of request JSON into objects. | src/app/settings/team/actions.ts:50, src/lib/email.ts:1 |
| F-SEC-004-012-APP | SEC-004-012 Build supply chain is pinned and verified | YELLOW | medium | Lockfile committed; most runtime deps pinned exactly, but @anthropic-ai/sdk, @react-pdf/renderer and pdfjs-dist use caret ranges. No CI to pin. Vercel installs from lockfile. | Pin remaining caret ranges; document dependency review for new packages. | package.json:12 |
| F-SEC-004-016-APP | SEC-004-016 Production build exposes no debug features or source metada… | YELLOW | medium | productionBrowserSourceMaps not set (default off); no debug routes found; public/ has only icons. Live probing of /.git and /.env not performed. | Run a quick external check of production for /.env, /.git/config and source maps. | next.config.ts:140 |
| F-SEC-007-014-APP | SEC-007-014 MCP server tool definitions are integrity-controlled | YELLOW | medium | All MCP tool definitions are static arrays in src/lib/mcp-*.ts and booking-tool-rules.ts; no tenant data is interpolated into tool names or descriptions (tenant data goes into the voice session instructions, not tool de… | Add a unit test that hashes the combined tools/list (names, descriptions, schemas) and fails unless a stored hash and SERVER_VERSION are updated together; keep tool descriptions free of runtime data. | src/app/api/mcp/[token]/route.ts:22, src/lib/mcp-protocol.ts:140 |
| F-CA-002-004-APP ❔ | CA-002-004 Describe process to review and request changes to PII (if o… | YELLOW | low | 'Your choices' says customers can ask to correct details or get a copy by contacting the business (privacy/page.tsx:102-106). Code-read only; no rendered check. | Describe how requests are made and handled. | src/app/legal/[org]/privacy/page.tsx:102-106 |
| F-CA-002-005-APP ❔ | CA-002-005 Describe how users are notified of material policy changes | RED | low | The policy has no statement about notification of changes. | Add a change-notification section and follow it. | src/app/legal/[org]/privacy/page.tsx:34-117 |
| F-CA-002-006-APP ❔ | CA-002-006 Policy effective date | YELLOW | low | Shows 'Last updated' from tenant_legal_pages.updated_at (privacy/page.tsx:36), which changes whenever a tenant edits any field and not when the policy text in code changes, so it is not a reliable effective date. | Version the policy text with a fixed effective date constant bumped when wording changes. | src/app/legal/[org]/privacy/page.tsx:36 |
| F-CA-004-007-APP ❔ | CA-004-007 Substitute notice conditions | RED | low | No substitute-notice procedure exists. | Add substitute-notice conditions and steps to the plan. | docs/security |
| F-CA-008-005-APP ❔ | CA-008-005 Easy online cancellation in the same medium; restrictions o… | YELLOW | low | Owners/admins can open the Stripe Billing Portal from Account > Plan; cancellation availability depends on portal configuration; no retention-offer flow exists in code. | Label a direct 'Cancel plan' link and confirm the portal cancel option is enabled. | src/app/account/actions.ts:415, src/app/account/page.tsx:274 |
| F-CA-010-004-APP ⚖️ ❔ | CA-010-004 Seller's permit when making retail sales (e.g., fixtures, r… | YELLOW | low | No seller's permit field or prompt exists; tax can be added to any invoice without one. | Add an optional seller's permit number in business settings and prompt for it the first time tax is entered. | src/components/invoice-adjustments.tsx:185 |
| F-CSLB-001-008-APP ⚖️ | CSLB-001-008 Minor work exemption threshold (B&P 7048) must not be used … | YELLOW | low | Nothing requires a license number before generating or sending contracts, so an unlicensed tenant could issue contracts. B&P 7048's minor-work exemption (under $1,000, no permit, not advertised as a contractor) would no… | Require a verified license for California tenants before contracts can be generated (shared with CSLB-001-007). | src/app/jobs/[jobId]/contract-actions.ts:190, src/app/settings/business/actions.ts:81 |
| F-CSLB-010-006-APP ❔ | CSLB-010-006 Technician roster tracks certification and blocks uncertifi… | RED | low | Only a generic 'certification' document type exists; no roster fields or dispatch check. | Add certification number/type/expiry per technician and a dispatch warning. | src/lib/crew-week.ts:1 |
| F-CSLB-011-003-APP ❔ | CSLB-011-003 Final inspection before final payment (recommended) | RED | low | No final-inspection field or hold found (no final_inspection/inspection_result in src or migrations). | Add an inspection sign-off on the job and an optional final-invoice hold. | src/app/jobs/[jobId]/contract-actions.ts:190 |
| F-FED-001-009-APP | FED-001-009 Notify and allow fee-free withdrawal when hardware/software… | YELLOW | low | ESIGN_CONSENT_VERSION exists and each new signing shows the current text, but the version accepted is never stored, so there is no way to tell who consented to an older statement or to notify them. | Store the consent version with each consent; on a version bump, require re-consent before the next electronic record is sent. | src/lib/esign-consent.ts:20 |
| F-FED-006-005-APP | FED-006-005 Report cash receipts over $10,000 in one transaction or rel… | YELLOW | low | Cash and check can be recorded as prepayments (recordPrepayment) and as paid-in-hand invoices (record_invoice_paid_in_hand RPC), but there is no flag or notice when cash received in one or related transactions exceeds $… | When cash/cashier's-check payments recorded for one customer within 12 months exceed $10,000, show a non-blocking Form 8300 reminder to the owner and log it. | src/lib/payment-plan-server.ts:201, src/lib/invoice-paid-in-hand.ts:82 |
| F-FED-011-001-APP ⚖️ | FED-011-001 COPPA applicability: services not directed to children unde… | YELLOW | low | The product is a B2B tool and booking for property owners; nothing is directed to children. No terms or policy state the service is for adults, and there is no process for deleting a child's data. | Add an adults-only statement to the policies and terms. | src/app/legal/[org]/privacy/page.tsx:39-60, src/app/legal/[org]/terms/page.tsx |
| F-SEC-004-017-APP | SEC-004-017 A vulnerability disclosure process exists | RED | low | No public/.well-known/security.txt and no disclosure policy page. | Publish /.well-known/security.txt with a contact and a short disclosure policy. |  |
| F-SEC-005-014-APP | SEC-005-014 Log entries are encoded and logging is inventoried | RED | low | No logging inventory document; console logging uses structured objects in places. | Write a logging inventory (Vercel, Supabase, app tables, providers) with retention. |  |
| F-SEC-006-011-APP | SEC-006-011 Recovery progress is communicated | RED | low | No incident response plan exists in the repository (grep for incident response/tabletop/breach notification in docs, README and compliance returns nothing). | Define status communication channels and templates. |  |
| F-CSLB-011-004-APP ❔ | CSLB-011-004 Permit tracking on jobs | RED | informational | Only a 'permit' document type exists for uploads; no structured permit fields, and the template comments treat {{permit_number}} as something 'this app does not track'. | Add structured permit fields and a {{permit_number}} placeholder. | src/lib/contract-template.ts:82 |
