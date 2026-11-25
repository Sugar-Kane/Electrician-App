# Source verification report: 2026-11-25

Branch `claude/compliance-source-verification-2`. Each requirement in the nine registers in `compliance/registry/` was checked against its official source. Every changed requirement got a `Source verification 2026-11-25: …` line in `notes` saying what was read, what changed, or why it could not be confirmed. `node compliance/scripts/validate-requirements.mjs` passed after every register.

The counts below come from the per-requirement decisions applied to the registers. Where they differ from earlier commit messages on this branch, these counts are correct. Two commit messages were off: california-contractors said "17 corrected" but the number is 13, and website-contractors said "15 verified / 6 unverified" but the numbers are 14 and 7.

## Summary

| Register | Total | Verified | Corrected | Unverified | Not re-verified (2026-11-24 status left unchanged) |
|---|---:|---:|---:|---:|---:|
| federal | 90 | 68 | 2 | 20 | 0 |
| california | 98 | 24 | 3 | 71 | 0 |
| california-contractors | 107 | 56 | 13 | 38 | 0 |
| website-federal | 33 | 30 | 0 | 3 | 0 |
| website-california | 36 | 10 | 1 | 25 | 0 |
| website-contractors | 21 | 14 | 0 | 7 | 0 |
| website-accessibility | 55 | 55 | 0 | 0 | 0 |
| website-security | 35 | 0 | 0 | 2 | 33 |
| application-security | 123 | 1 | 0 | 1 | 121 |
| **Total** | **598** | **258** | **19** | **167** | **154** |

How to read the columns:

- **Verified**: the citation was read on an approved official host and supports the required behavior. `source_verified: true`, `last_verified: "2026-11-25"`. In 167 of the verified and corrected items, the URL was changed (and noted) to the official page that was actually read. Usually that was because the original host was blocked (law.cornell.edu, leginfo) or not on the approved list (consumerfinance.gov, federalregister.gov). In some cases it was a broken uscode.house.gov `view.xhtml` link. The citation itself was right.
- **Corrected**: the citation was wrong or incomplete. It was fixed, then verified.
- **Unverified**: could not be confirmed. `source_verified: false`, with the reason in notes.
- **Not re-verified**: these items were already marked verified on 2026-11-24 from github.com sources. github.com is not on this pass's approved host list, and the projects' own sites were refused by the proxy, so they could not be re-read. Their earlier `source_verified`/`last_verified` values were left unchanged, not reconfirmed, and annotated. Treat them as unconfirmed by this pass. If only approved-host verification should count, set them to unverified.

## Sources actually read

| Source | Host | Used for |
|---|---|---|
| United States Code, OLRC section pages (`/us/usc/tNN/sNNNN/`) | uscode.house.gov | ESIGN, TCPA statute, CAN-SPAM, FTC Act, ROSCA, CRFA, EFTA, TILA, GLBA, COPPA, ADA, IRC |
| eCFR API, point-in-time 2026-11-23 (`/api/versioner/v1/full/…`) | ecfr.gov | 47 CFR 64.1200/64.1601, 16 CFR 233/251/255/310/312/314/316/425/429/433/444/464/465/702, 12 CFR 1005/1016/1026, 28 CFR 35/36, 26 CFR 1.6001-1/1.6050W-1 |
| DOJ web accessibility guidance | ada.gov | ADA web items |
| IRS record-keeping and Form 8300 pages | irs.gov | tax record items |
| CCPA statute, CCPA regulations (11 CCR 7000 et seq.), Delete Act, all effective 2026-01-01 | cppa.ca.gov | CCPA/CPRA items |
| California Contractors License Law & Reference Book, 2026 Edition (official State publication; B&P Code, 16 CCR Div. 8) | cslb.ca.gov | Contractors License Law and CSLB regulations |
| WCAG 2.1, WCAG 2.2 (12 Dec 2024 edition) and 55 Understanding pages | w3.org | accessibility items |
| OWASP MCP Top 10 project page | owasp.org | SEC-007-014 and partial checks |

## Unverified items by reason

| Reason | federal | california | ca-contractors | web-federal | web-california | web-contractors | web-security | app-security | Total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| leginfo.legislature.ca.gov unreadable: curl gets a Cloudflare challenge (HTTP 403), WebFetch got HTTP 403, and no other approved host carries Civil, Labor, Penal, Revenue & Taxation or non-contractor B&P text | 0 | 63 | 22 | 0 | 25 | 5 | 0 | 0 | 115 |
| No `official_source_url` (recommended controls, private standards, sources with no link) | 5 | 3 | 13 | 1 | 0 | 0 | 0 | 0 | 22 |
| Source host not on the approved list (supremecourt.gov, nacha.org, stripe.com, support.google.com, vendor terms, CTIA/carrier programs) | 9 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 9 |
| PCI DSS: document library needs JavaScript, standard is licence-gated, blog host unreachable | 3 | 0 | 0 | 0 | 0 | 0 | 2 | 1 | 6 |
| Host refused by egress proxy: cdtfa.ca.gov | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 0 | 5 |
| Host refused by egress proxy: docs.fcc.gov / fcc.gov | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 2 |
| ftc.gov returned a bot-block page | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 2 |
| Source read, but the current text does not support the claim as written | 0 | 0 | 3 | 1 | 0 | 2 | 0 | 0 | 6 |
| **Total** | **20** | **71** | **38** | **3** | **25** | **7** | **2** | **1** | **167** |

### Claims the official text does not support (fix required_behavior)

- **CSLB-001-008** (B&P 7048): the current threshold is $1,000 for work that needs no permit, and the exemption is lost by anyone who advertises as a contractor or employs others. The section has no "disclose it is not licensed" duty; that is likely B&P 7027.2, which was not checked.
- **CSLB-003-007** (citation narrowed to B&P 7159(c)(6)): the bond notice must be "in close proximity to the signatures". There is no 10-point bold or all-caps requirement.
- **CSLB-003-008** and **WEB-CSLB-009** (B&P 7159(d)): the current text requires the items to be included, but not "in the order set forth".
- **WEB-CSLB-006** (B&P 7161): the current section (operative 2021-07-01) has no provision on "free" goods, prizes or discounts as inducements.
- **WEB-FED-033** (citation corrected to 12 CFR 1026.24(a)-(c)): 1026.24 has no "same as cash"/"0%" condition rule.

## Corrected citations

| ID | Was | Now |
|---|---|---|
| FED-005-004 | WCAG 2.2 … (W3C Recommendation, Oct. 2023) | adds "current edition dated 12 December 2024" |
| FED-011-004 | 16 CFR 429.1(b)-(h) (paragraph assignments to confirm) | 16 CFR 429.1(b)-(g) |
| CA-001-021 | Civ. 1798.185(a)(15)(A); 11 CCR 7120 et seq. (verify) | Civ. 1798.185(a)(14)(A); 11 CCR 7120-7124 |
| CA-001-022 | 11 CCR 7150 et seq. (verify); Civ. 1798.185(a)(15)(B) | 11 CCR 7150-7157; Civ. 1798.185(a)(14)(B) |
| CA-001-023 | 11 CCR 7200 et seq. (verify); Civ. 1798.185(a)(16) | 11 CCR 7200-7222; Civ. 1798.185(a)(15) |
| WEB-CA-019 | 11 CCR Article 11, section numbers to be confirmed | 11 CCR Article 11, sections 7200-7222 |
| CSLB-003-001 | B&P 7159 (verify subdivision) | B&P 7159(d) |
| CSLB-003-002 | B&P 7159(c) (verify paragraph) | B&P 7159(c)(1)-(2) |
| CSLB-003-003 | B&P 7159(c) (verify paragraph) | B&P 7159(c)(3)(A) |
| CSLB-003-004 | B&P 7159(c) (verify paragraph) | B&P 7159(c)(3)(B) |
| CSLB-003-005 | B&P 7159(c) (verify paragraph); Civ. 8400, 8404 | B&P 7159(c)(4); Civ. 8400, 8404 |
| CSLB-003-006 | B&P 7159(c) (verify paragraph) | B&P 7159(c)(5) |
| CSLB-004-001 | B&P 7159.5(a) (verify paragraph) | B&P 7159.5(a)(3) |
| CSLB-004-003 | B&P 7159.5 (exception subdivision; verify) | B&P 7159.5(a)(8) |
| CSLB-004-004 | B&P 7159.5(a) (verify paragraph) | B&P 7159.5(a)(5) |
| CSLB-005-001 | B&P 7159.5(a) (verify paragraph) | B&P 7159.5(a)(5) |
| CSLB-005-004 | B&P 7159.5(a) (verify paragraph); 7159(c) | B&P 7159.5(a)(6); 7159(c)(4) |
| CSLB-007-010 | B&P 7159(e) (Seven-Day; verify); Civ. 1689.6 | B&P 7159(e)(7); Civ. 1689.6 |
| CSLB-008-006 | B&P 7159(c) (verify) | B&P 7159(c)(4) |

Another 26 verified items had only a "(verify)" flag removed or a paragraph range narrowed where the number was already right, e.g., CSLB-003-009 to -021 (7159(d)(1)-(13)) and CSLB-003-022 to -026 (7159(e)(1)-(5)). These count as verified, not corrected.

## Findings for whoever maintains the registers

- **CSLB-003-004 gap**: B&P 7159(c)(3)(B) (as amended by AB 1327, effective 2026-01-01) now also requires the contractor's **email address** for the Notice of Cancellation and, in (iii), a **telephone number** to help the buyer fill it out. required_behavior lists only name and address.
- **New B&P 7159(c)(7)**: a subcontractor-use Yes/No checkbox plus a fixed disclaimer, repeated on change orders. No register item covers it.
- **B&P 7125** is headed "[Repealed effective January 1, 2028]" in the 2026 Law Book (CSLB-012-003).
- **16 CCR 832.10 (C-10)** now lists battery energy storage and photovoltaic systems, but the Law Book marks this amendment's effective date as stayed at printing (CSLB-001-003).
- **11 CCR 7001(ddd)** includes **installment payment plans** under "financial or lending services". ADMT used to approve installment plans would be a significant decision (CA-001-023).
- **47 CFR 64.1200(a)(10)**: eCFR flags a pending amendment at 91 FR 67219 (Oct. 26, 2026). The register cites 91 FR 67214 (FED-002-007), and the amended text was not readable from here.

## What would unblock the rest

- **California statutes (115 items)**: leginfo.legislature.ca.gov needs to be readable, through a browser session or an allowlist entry that gets past its Cloudflare challenge, or another official copy of the Civil, Labor, Penal, R&T and B&P 17200/17500/17600/22575 text is needed.
- **ASVS, NIST CSF, OWASP and MCP projects (154 not re-verified)**: either add github.com, asvs.owasp.org, top10.owasp.org, api-security.owasp.org, genai.owasp.org, csrc.nist.gov or nvlpubs.nist.gov to the approved list and the egress allowlist, or accept the 2026-11-24 verification.
- **PCI DSS (6)**: a licensed copy of PCI DSS v4.0.1 and SAQ A must be reviewed by hand.
- **cdtfa.ca.gov, fcc.gov/docs.fcc.gov, ftc.gov (9)**: allow these hosts in the egress policy.
