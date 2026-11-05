# Policy Reader redesign (owner's spec of 5 November 2026)

Screen: Policy & Compliance → Policy Library → a policy (`src/app/(app)/policies/[id]/page.tsx`).

The approved screenshot named in the spec was not attached, so this build follows the written spec: purple and navy
palette, purple breadcrumb bar, horizontal section cards, Review Sheet, and three right-hand panels. The global header
(PR #82) and the sidebar are unchanged.

## What changed

- **One continuous document** instead of separate tabs for Review Sheet, Policy Text, Procedure, Forms and All Policy.
  `src/lib/policy-reader.ts` places every stored section exactly once, in this order: Review Sheet, Purpose, Scope,
  Objectives, Policy, Procedure, Definitions, Key Facts (Staff), Key Facts (Service Users), Records & Monitoring,
  Branch Appendices, Further Reading, Outstanding Practice, Forms & Resources. Responsibilities, escalation, local
  contacts, record keeping, training, monitoring, review arrangements and branch appendices are kept inside the
  nearest part. A part with nothing written is left out, never shown as an empty heading.
- **Sticky section strip** (`src/components/policy-reader.tsx`). It sits under the 56/68px top bar, highlights the
  section on screen as the reader scrolls up or down, keeps the active card in view, scrolls smoothly on click
  (instantly with reduced motion), puts `#section` in the address so Back and Forward work, and moves focus to the
  section heading. Arrow keys, Home and End move between cards. One "reading line" decides the active section, so the
  highlight does not flicker at boundaries.
- **Policy Progress** shows the current section, the number of sections and how far down the document the reader is.
  It never signs or acknowledges anything; Log Read & Sign is unchanged. It resets for each policy and version.
- **Review Sheet**: five indicators (last reviewed, last amended, next review, review interval, review status) and a
  table with reference, title, version and the previous version, category and document type, who and where it applies
  to, owner, reviewer, approver ("Not assigned" when empty), approval status, effective date, business impact, reason
  for review, summary of changes, legislation and guidance, CQC quality statements, source links with their
  verification state, and outstanding review requirements. Starter text is shown as "not yet approved", never as
  approved. Business impact shows "Not assessed" when no impact assessment exists (it used to default to Low).
- **Policy Actions**: Mark as Important and Add to Reading List (new personal markers, saved without a page reload and
  audited), Assign to Staff (the existing Staff Sign-off page, only for people with `signoff.manage`), Compare
  Versions (new compare page using the existing section diff) and View Version History.
- **Linked Forms & Resources**: the forms, checklists and tools whose "Related policies" section names this policy,
  with Word download and Open, plus "Open in CSB Care" links to existing workflows (incident report, risk assessment,
  corrective actions, risk register) shown only to people allowed to use them.
- **Header**: reference · title, category and type, publication state, version, next review, Download menu (Word and
  PDF, existing endpoints), Print, Log Read & Sign, and Edit · Start revision (the existing revision workflow; a
  published version is never edited directly). An open revision shows "Continue revision" instead.
- **Record views**: Versions, Regulation Map, Read & Sign and Reg. Flags are links in the header (`?view=`). Old
  links such as `?view=procedure` open the reader at that section.
- **My Reading List** (`/acknowledgements`) gains a "Saved to read later" list for policies added from the reader.

## Database

One additive migration, `20261105010000_policy_bookmarks`: table `PolicyBookmark` (organisation, user, policy, kind
`IMPORTANT` or `READING_LIST`), unique per user, policy and kind. Needed because no favourite or saved-for-later
mechanism existed. Nothing existing is changed or deleted.

## Not done, or limited by the current data

- **Approved screenshot**: not received, so no side-by-side comparison was possible.
- **Content (phase 3)**: no policy text was rewritten. The starter library has no Objectives, Key Facts (Service
  Users) or Outstanding Practice sections, so those parts do not appear yet and the Review Sheet lists them under
  "Not written yet". Key Facts (Staff) is drawn from the first line of each procedure step and says so. Procedures
  are short (a few steps each) and need professional writing and review before real use.
- **Forms (phase 4)**: resources are still linked through the "Related policies" text of each form. No explicit
  link table was added and no new forms were written. Download from the side panel is Word; the Forms & Resources
  section offers Word and PDF.
- **Policy Generator**: unchanged. Its drafts already carry structured sections and branch appendices, which the reader
  places in the right parts. It does not yet write Objectives, Key Facts or Outstanding Practice sections.
- **Reading position**: restored by the browser on Back and Forward and by `#section` links; it is not stored between
  sessions.
