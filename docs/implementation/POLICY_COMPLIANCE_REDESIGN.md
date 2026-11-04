# Policy & Compliance redesign (six workspaces)

Owner's brief of 3 Nov 2026 with six mockups (01 Compliance Dashboard … 06 Compliance Reports). The owner said "yes build it" in the project thread. Restyle only: every route, permission, workflow and data source is kept.

## What changed

- **Shared look** (`src/app/globals.css`, `pc-*` classes and `main[data-module="policy"]` overrides; `src/components/compliance-ui.tsx`, `pc-select.tsx`). Light page, white panels, breadcrumb header, underlined purple tabs with counts (`src/server/compliance/workspace-counts.ts`), pill badges in six tones. The navy sidebar is unchanged and the HR stylesheet is not imported. `MainArea` marks `<main>` with `data-module`.
- **Compliance Dashboard** (`/`): four figures that link to their filtered lists, a note on what is counted, Needs attention with deep links, recent regulatory updates, key review dates.
- **Policy Library** (`/policies`): same three columns, restyled. The inspector shows "Policy n of N" with Previous / Next across the filtered, sorted list (across pages), closes on X, Escape or a click on empty page space, asks before closing with unsaved form input, and remembers it was closed (`insp=closed`) so the first policy is not reopened. One primary action by status (Create revision, Review and approve, Assign for review, Start review, Adopt template, Restore), then Manage sign-off, Versions and a menu. The viewer reads "Page x of y" and offers Word as well as PDF. "Owned by me" quick filter.
- **Upload policy** (`src/server/policies/import.ts`, `uploadPoliciesAction`, `src/components/library/upload-policy.tsx`): .docx / .pdf, drag and drop. Each file becomes a new policy at Draft v1 with an open revision (reference `IMP-nnn`); nothing is approved or published. The original is stored as private evidence linked to the policy (same checks and virus scan as evidence). Word text is split into sections at Heading 1/2 when chosen; PDF text is not extracted. Optional duplicate check by title. One file opens its draft for checking; several return to the library.
- **Regulatory Monitoring**: updates table (source, date, impact, review status, responsible), Requirements Register with linked policies, evidence and open actions (`src/server/compliance/requirements.ts`), Source Status with Verified / Simulated and health.
- **Staff Sign-off**: four figures, tabs, a register with checkboxes and a bulk bar: Send reminder (in-app only), Extend due date (reason required), Exempt (reason required). `bulkSignoff` in `assignment.ts` touches only outstanding rows the caller manages; each change is an event and an audit entry. Nobody is ever marked as having read a policy.
- **Audits & Improvements**: audits (internal score, never a CQC rating), corrective actions with evidence and verification, risk register with score pill, evidence library.
- **Compliance Reports** (now in the Policy & Compliance sidebar section): six report cards, From / To / Branch / Status / Category filters, exports limited to built formats (Compliance Summary is PDF only), preview table. New `overdue` and `summary` report kinds; status and category filters apply to the page and the export alike.
- "Policy Sign-off" is renamed "Staff Sign-off"; "Organisational Risk Register" is "Risk Register".

## Known limits and open questions

- Upload limit is 10 MB in total per upload (the brief says 20 MB per file). The server action body limit is 11 MB and Vercel allows about 4.5 MB per request, so larger files need direct-to-storage upload first.
- The extracted text is checked in the draft revision after saving, not in a preview step before saving.
- Risk band labels stay Low / Moderate / High / Extreme; only the pill colours follow the brief's 15 / 8 thresholds.
- `/compliance/reports` moved from the Reporting portal to Policy & Compliance. Reporting & Analytics still links to it.
- Dev-only console warning "useInsertionEffect must not schedule updates" appears on any link click; it was already there before this work.
