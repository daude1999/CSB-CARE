# Policy, Procedure & Forms build: progress tracker

Owner's brief: "Master policy, procedure & forms management implementation" (5 November 2026). The brief is delivered
in stages, each a separate draft PR that waits for the owner's "I approve the screenshots. Merge the PR."

| Stage | What it covers | State |
|---|---|---|
| PR 0 | Stabilise the Forms & Resources register from PR #94 | **Done in this branch** (see below) |
| PR 1 | Explicit policy-to-form links, placed at procedure steps, shown in the existing Policy Reader | **Done in this branch** |
| PR 2 | Form definitions and immutable form versions (`FormDefinition`, `FormVersion`, field schema) | Built as one PR with PR 3 (draft PR, awaiting approval) |
| PR 3 | Form completion engine (draft, submit, return, review, approve, void), 2–3 pilot forms | Built: pilots CSB-FRM-020 and CSB-FRM-013 (draft PR, awaiting approval) |
| PR 4 | Links from completed forms to service users, staff, incidents, audits and evidence | Not built |
| PR 5 | "Start digital form" / "Open existing workflow" at the exact procedure step | Not built (PR 1 shows the form and its downloads at the step) |
| PR 6 | Staff compliance, review queue and reporting for forms | Not built |
| PR 7 | Search over sections, steps and forms; completeness review for authors | Not built |

Nothing in this branch records a completed form, collects a signature or makes a form "digitally fillable". The
register and the reader say so.

## PR 0: Forms & Resources register (`/policies/forms`)

- **Why PR #94's Vercel preview failed:** `npm run typecheck` failed. The search filter built `mode: "insensitive"` as a
  plain string, which Prisma's `QueryMode` type rejects, so `next build` stopped at type checking. (Vercel's logs are
  not reachable from here; the same error reproduces locally.)
- The query moved out of the page into `src/server/forms/catalogue.ts` (architecture rule 2). The tab count uses the same
  filter (`resourceRegisterWhere`), so the pill always matches the list.
- **Each form is listed once.** An organisation sees its own copies plus CSB templates it has not adopted; before, the CSB
  template and the organisation's copy of the same form both appeared.
- New "Linked policies" column (explicit links only), next review date, honest approval labels ("CSB template · not
  adopted", "Not yet approved", "Approved"), PDF as a real download link.

## PR 1: explicit policy-to-form links

**Database:** one additive migration, `20261105210000_policy_resource_links`, table `PolicyResourceLink`:
organisation (null for the CSB master library), policy, resource, optional `sectionKey` (a stable `PolicySection` key;
procedure steps are the `procedure.*` sections, numbered in reading order exactly as the reader numbers them),
"use when" (≤ 300 characters), required flag, order, origin, who/when, and withdrawal (who, when, reason).

Enforced by the database (trigger `csb_policy_resource_link_guard`):
- both ends belong to the link's organisation, or both are CSB masters: no cross-tenant link is possible;
- the near end is a policy, procedure or guidance; the far end is a form, template, checklist or tool;
- after creation a link can only be withdrawn, once; it is never edited or revived. One active link per policy,
  resource and place (partial unique index).

**Backfill:** `csb_backfill_policy_resource_links()` turns each published resource's existing "Related policies" section
into links, in the same organisation only. It runs in the migration (so the live database gets its links on deploy),
and the seed runs it again. It never re-creates a pair that has any link, including a removed one. On a full demo
database it creates 109 CSB master links and 93 demo-organisation links. No step placements are invented: backfilled
links are on the whole policy. Placing a form at a step is a decision for the policy author.

**Adopting a template** copies CSB's links between that template and documents the organisation already has
(origin `TEMPLATE`), inside the adoption transaction, and records how many in the audit entry.

**Fallback:** a resource whose "Related policies" text names the policy, but which has no link of any kind for it, is
still offered in the reader, labelled "Named in the form's Related policies". This keeps the old behaviour until links
are confirmed everywhere. A removed link is never brought back by the fallback.

**Screens** (existing design kept; no new sidebar entry, tab or record view):
- Policy Reader, Forms & Resources section: one row per form, with "Used at Step n: …", "Use when …" and a Required
  marker; "Manage linked forms" link for authors, "Link history" for everyone else.
- Policy Reader, procedure step: a discreet "Form for this step" note with Word and PDF downloads.
- Policy Reader, Linked Forms & Resources panel: unchanged layout, plus a "Step n" link when a form is placed at a step.
- New page `/policies/[id]/resources` ("Linked forms"): links now, link a form (authors only), removed links with reason.

**Permissions:** adding and removing links uses the existing `policy.author` permission (organisation admin and policy
author), on the organisation's own active policies only. CSB master links are read-only in the app. Readers of a policy
can see its links and history. Narrower `form.*` permissions arrive with PR 2, when form definitions exist. `rbac.ts`
was not changed.

**Audit:** `policy.resource_link.added`, `policy.resource_link.withdrawn`, and `resourceLinksInherited` on
`policy.adopted_template`.

**Tests:** `tests/integration/policy-resource-links.test.ts` (9 tests: backfill and idempotency, cross-tenant refusal in
the app and the database, roles, duplicate and concurrent adds, withdrawal once with history, frozen rows, text fallback,
template adoption, register de-duplication) and `tests/e2e/policy-resource-links.spec.ts` (3 browser tests).

## PR 2 + 3: on-screen forms (pilot)

- Tables `FormDefinition`, `FormVersion`, `FormRecord`, `FormRecordEvent` (migration `20261105230000_form_records`).
  Triggers: published versions never change (only PUBLISHED → SUPERSEDED), records start as drafts on the current
  version, answers freeze once submitted, status follows DRAFT → SUBMITTED → RETURNED/APPROVED → VOIDED, history is
  append-only, nothing is deleted.
- Field schema (`src/lib/forms/schema.ts`) is pure data validated with zod: text, long text, date, time, number,
  yes/no, choice, multiple choice, "I confirm" statement, headings, conditional questions. No code in a form.
- Pilot forms are defined in `src/server/forms/pilots.ts` and synced by `prisma/sync-forms.ts` (run in `vercel-build`
  and the seed). A new version is published only when fields or instructions change; records keep their version.
- Screens: `/policies/forms/records` (fill in a form, review queue, my open forms, finished) and
  `/policies/forms/records/[id]` (fill in, save draft, submit, approve, return with reason, void with reason, print,
  history). "Fill in on screen" buttons on the register and in the Policy Reader for the pilot forms only.
- Records are visible only to their author and the form's reviewers (ORG_ADMIN, COMPLIANCE_LEAD). A reviewer cannot
  approve their own record. History records which questions changed, never the answers.
- Tests: `tests/integration/form-records.test.ts` (8), `tests/e2e/form-records.spec.ts` (1).

Limits: no screen to author new forms yet (pilots are in code); no autosave; no attachments or repeating tables; no
separate "under review" state; no notifications; no CRM or evidence links (PR 4).

## Not done or limited

- On-screen forms exist only for the two pilots (see below). Other forms remain downloads.
- "Open existing workflow" links at a step (incident report, body map, safeguarding) are PR 4/5; the existing
  category-based "Record it in CSB Care" links are unchanged.
- No branch-specific placement (`branchScope`) yet; policies already carry branch scope.
- CSB master links cannot be edited in the app; they come from the starter library's "Related policies".
- Nine-area QCS taxonomy mapping, monthly resource updates and search over steps are later stages.
