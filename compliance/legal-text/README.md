# California home-improvement contract text (2026)

> **Not legal advice.** A California attorney must confirm this text before it is used in any contract, form or app screen.

`ca-home-improvement-2026.json` holds the exact wording of the California home-improvement contract notices, copied from the official **California Contractors License Law & Reference Book, 2026 Edition**:
<https://www.cslb.ca.gov/Resources/GuidesAndPublications/2026/2026_CSLB_Law_Book.pdf> (603-page PDF, retrieved 2026-11-26).

## How the text was taken

- Extracted with `pdftotext` from the official PDF. Nothing was retyped or filled in from memory.
- Words that the book splits across lines were rejoined. "Three-Day" is the only one that keeps its hyphen.
- Paragraphs are separated by blank lines. In the Notice of Cancellation forms, each blank and caption (such as `/name of seller/` or `(Date)`) is on its own line. The book's horizontal layout isn't reproduced.
- A script compared every paragraph with the raw PDF text, ignoring only spaces, line breaks and hyphens. Every paragraph matched.
- `page` is the page number printed in the book. `pdf_page` is the page in the PDF file (printed page + 23).
- The outer quotation marks around notices are the statute quoting them. They are kept exactly as printed, so decide with counsel whether to show them.
- Odd printing is kept as it appears, for example ".REMEMBER" in the Mechanics Lien Warning and the unclosed "(Buyer's signature" in the cancellation form.

## Found (B&P text from the 2026 book)

| Item | Citation | Book page |
|---|---|---|
| Mechanics Lien Warning (full) | B&P 7159(e)(4) | 379–380 |
| Information about the Contractors State License Board (CSLB), at least 12-point | B&P 7159(e)(5) | 380 |
| Commercial General Liability Insurance (CGL) notice | B&P 7159(e)(1) | 378 |
| Workers' Compensation Insurance notice | B&P 7159(e)(2) | 378–379 |
| Extra / change-order work notice (described, not fixed wording) | B&P 7159(e)(3) | 379 |
| Three-Day Right to Cancel, at least 12-point bold | B&P 7159(e)(6)(B)(i) | 381 |
| Five-Day Right to Cancel for seniors (a rule to change "three"/"third" to "five"/"fifth"; no separate text is printed) | B&P 7159(e)(6)(B)(ii), (f) | 381, 385 |
| Format rules and attachment checkbox statements | B&P 7159(e)(6)(C)(i)–(v) | 381–382 |
| Notice of Cancellation form (three/five-day) | B&P 7159(e)(6)(C)(vi) | 382–383 |
| Seven-Day Right to Cancel (declared emergencies) and its form | B&P 7159(e)(7) | 383–384 |
| Minimum type size (10-point; 10-point bold headings) | B&P 7159(c)(2) | 375 |
| First-page Notice of Cancellation statements, including the AB 1327 email and phone items | B&P 7159(c)(3) | 375 |
| Performance and payment bond notice (described, not fixed wording) | B&P 7159(c)(6) | 376 |
| Subcontractor-use Yes/No checkbox and disclaimer | B&P 7159(c)(7) | 376 |
| Contract contents: "Home Improvement", "Contract Price", "Downpayment" and its notice, "Schedule of Progress Payments" and its notice, start and completion dates, "Note About Extra Work and Change Orders", with the type-size rules | B&P 7159(d)(1)–(13) | 376–378 |
| Downpayment limit, progress payments, bond exemption | B&P 7159.5(a)(1)–(8) | 387–388 |

Notes:

- 7159(c)(7) in the 2026 book is about whether a **subcontractor** will be used. There is no "subscription" checkbox.
- 7159.5(a)(3) and (a)(5) contain no required notice text. The matching notice is the downpayment statement in 7159(d)(8)(C).
- The Notice of Cancellation form as printed still says "mail or deliver … or send a telegram" and doesn't mention email. The email items are in 7159(c)(3)(B)(ii) and in the right-to-cancel notices ("emailing, mailing, faxing, or delivering").

## Not found

| Item | Why |
|---|---|
| Civil Code 1689.6 (when the right to cancel applies) | Not printed in the 2026 book, which only refers to Civil Code 1689.5–1689.14. leginfo.legislature.ca.gov returned HTTP 403 from this environment, and no other official .ca.gov copy was read. |
| Civil Code 1689.7(a)–(c) (home solicitation cancellation forms, including the senior five-day version) | Same as above. |
| Civil Code 1689.10 (refund within 10 days) | Same as above. |
| A separate statement about delivering the Notice of Cancellation electronically | None in the B&P sections in the book. The related email text found is listed above. |

The Civil Code sections need to be added from an official source, such as leginfo opened in a normal browser, and checked by counsel.
