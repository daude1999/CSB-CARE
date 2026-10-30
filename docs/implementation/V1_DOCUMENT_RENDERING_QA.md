# Version 1 document rendering QA

Phase 1 (Policy Library PDF preview) and phase 5 (document and export QA) of the V1 readiness brief.

## The PDF preview defect

**What the owner saw:** in the Policy Library preview on Windows, headings and body text were distorted, with mixed-case letters squashed together ("WORKING TIme, ReSTBReaks").

**Root cause (proven, not guessed).** The PDFs were written with pdfkit's standard Helvetica, which is *named* in the file but not embedded. A PDF viewer must then supply its own Helvetica. PDF.js, which draws the in-app preview, uses fonts installed on the device by default (`useSystemFonts`), so each computer drew the text with whatever font it had under that name, using the wrong glyph widths. The defect was reproduced in this environment by installing a different font under the name "Helvetica": the preview showed the same squashed, overlapping text. Screenshots: `/mnt/project-files/csb-v1-readiness/pdf-before-reproduced-local-helvetica.png` and `pdf-after-inspector-1440.png`.

**Fix.**
- Every generated PDF (policy documents, printable rota, MAR chart) embeds Liberation Sans 2.1.5 (regular, bold, italic, bold italic; SIL Open Font Licence, `src/server/documents/fonts/OFL.txt`). Text outside the font's coverage is replaced safely (✓ becomes "Yes", ✗ becomes "No"; control characters dropped) by `pdfText()`, using a coverage table generated from the font files.
- Both in-app viewers (Policy Library and the HR Hub preview) set `useSystemFonts: false`.
- The production build traces the font files (`outputFileTracingIncludes` in `next.config.ts`; checked that `.next/standalone` contains them).

## Policy document layout fixes

| Check | Result |
|---|---|
| Readable type, headers and footers | Embedded fonts; header title truncated with an ellipsis if too long; long titles drop to 22 pt on the cover |
| Page numbering | "Page n of N", cover counted as page 1 (matches the viewer's counter) |
| Tables | Header rows never left alone at a page foot; rows sized to their wrapped text |
| Metadata | Cover and document-control tables include an explicit **Approval** row; starter content reads "Not yet approved (starter content)" |
| Approval status accuracy | Only "Approved" when an approval decision exists; tested in PDF and Word |
| Headings | Never stranded at the foot of a page (keep-with-next) |

## The viewer

The 306 px fixed panel is replaced by a responsive viewer (`clamp(440px, 100vh − 230px, 980px)`) with continuous pages fitted to the width, a page counter that follows scrolling, a section outline, PageUp/PageDown, and a **full-screen reader** (Escape closes it). Download keeps the original file. Print renders each page to an image and prints from the page itself, because the site's security headers rightly block framing the PDF.

## Automated checks

`tests/unit/document-rendering.test.ts` (22 tests) generates three fixtures (short; very long title; 14 sections, 34 requirements, 9 history entries and unusual characters) and reads each PDF back with PDF.js:

- fonts embedded, no standard Helvetica left;
- no text drawn over other text, nothing outside the printable area, on every page;
- page numbering correct; approval wording correct;
- no heading or table header alone at a page foot;
- unusual characters (accents, Polish, Greek and Cyrillic letters, curly quotes, dashes, €, ≥, ✓ and an emoji) survive or are replaced safely;
- **page-image comparison** against 19 baseline images in `tests/visual/documents/` (fails if more than 0.2% of pixels differ; `UPDATE_DOC_BASELINES=1` refreshes them after an intended change);
- the Word file contains the expected text and heading styles;
- the checks themselves fail on a deliberately broken PDF.

`tests/integration/document-qa.test.ts` applies the same read-back checks to the **printable rota** (carers and a person, with and without surnames) and the **MAR chart** (two medicines, one with a long name). It found defect D18 (a long medicine name overlapping the dose line), now fixed.

`tests/e2e/library.spec.ts` opens the full-screen reader at 100% zoom and compares page 2 on screen with a separate render of the downloaded file (difference under 2%), checks the download has no Helvetica, that Escape closes the reader, and that print produces one image per page.

**Two renderers.** The same PDFs were rendered with PDF.js (in Node, via `@napi-rs/canvas`) and with Poppler (`pdftoppm`). The images differ only by anti-aliasing (about 1–2% of pixels), with identical layout. Example: `/mnt/project-files/csb-v1-readiness/pdf-two-renderers-long-title.png`.

## Formats

| Format | Where | Status |
|---|---|---|
| PDF | Policy documents (board-paper style), printable rota, MAR chart | Fonts embedded, read-back tests, visual baselines for policy documents |
| DOCX | Policy documents | Structure test (text, Heading 1, approval row, footer status) |
| HTML | Policy view in the app | Covered by the e2e Policy Library tests and the QA walk |

## CSV exports

All platform CSVs now go through one writer, `src/lib/csv.ts`: RFC 4180 quoting, CRLF line ends, a UTF-8 byte-order mark (so Excel shows "Zoë" correctly), and formula protection (text starting `= + - @`, tab or CR gets a leading apostrophe), while plain numbers, including negative amounts, stay numbers (defect D11). `tests/unit/csv.test.ts`.

| Export | Permission checked on the server | Audited |
|---|---|---|
| Staff sign-off | sign-off view, branch-scoped rows | Yes (`signoff.exported`) |
| Readiness evidence | `readiness.evidence` | Yes (`readiness.evidence.exported`) |
| Analytics measures | `report.export` | Yes |
| Rota reports | `report.export` | Yes |
| Compliance reports | `report.export` | Yes (`report.exported`) |
| Pay and invoice runs | `finance.view`, approved runs only | Yes (`finance.payrun.exported` / `finance.invoicerun.exported`) |
| Audit log | `org.manage` | Yes (`admin.audit.exported`) |
| HR people (HR Hub) | HR editor | Yes (HR Hub log); BOM and charset added |

Reconciliation: rota report totals equal the visit records (`rota-reports.test.ts`), analytics measures are worked out from the records with definitions (`kpis.test.ts`), sign-off counts, rows and export reconcile (`signoff.test.ts`), and pay and invoice runs are priced from the timesheets and rate bands (`finance.test.ts`).

## Not covered

- Timesheets, invoices and payslips are CSV exports for payroll and accounts software; the platform does not produce PDF invoices or payslips (Version 1 scope).
- HR Hub documents are files people upload; the HR preview now uses embedded fonts only, but the files themselves are whatever was uploaded.
