# Architecture decisions: rostering build

Each decision gives the choice, the reason and its consequence. They extend CLAUDE.md and do not replace it.

## AD-1 The HR Hub stays the source of truth for people
`StaffMember` is a read model projected from the HR workspace JSON inside the same HR write transaction (`src/hr/lib/workspace-tx.ts` → `src/server/workforce/projection.ts`). If the projection fails, the HR write rolls back. `reconcileWorkforce` re-runs the projection for every record. It is idempotent and keyed on the HR record id, never on email.
**Consequence:** rostering never edits HR facts (DBS, right to work, training). Rota-only data (areas, skills, contracted hours) lives in `RotaStaffProfile`.

## AD-2 Sign-ins are linked to staff records explicitly
`/admin/workforce` links a platform user to a `StaffMember` by hand. Two records sharing an email are never merged automatically.
**Reason:** a wrong automatic link would give a carer someone else's visits and home addresses.

## AD-3 One eligibility service with three answers
`src/server/workforce/eligibility.ts` returns ELIGIBLE, REQUIRES_REVIEW or NOT_ELIGIBLE, with reasons. Every assignment path uses it: single, bulk, build, planner drag and template carer. REQUIRES_REVIEW needs an explicit "accept warnings"; NOT_ELIGIBLE is refused.

## AD-4 HR changes flag visits; they never reassign them
`reviewStaffImpact` re-checks future visits after any HR, absence, availability or preference change and writes the flags and alerts. A person decides what to do next.

## AD-5 Database guards behind the service checks
- An exclusion constraint (needs `btree_gist`) stops one carer being booked on overlapping live visits, even if two coordinators race.
- A trigger enforces the visit status state machine.
- `VisitClock` is append-only.
- A partial unique index on (templateId, date) makes builds idempotent.
- Builds also take an advisory lock per organisation and week.

## AD-6 Times are London wall-clock
Templates and settings hold London local minutes. Visits are stored as UTC instants converted through `src/lib/london.ts`, so DST changes keep a 08:00 call at 08:00.

## AD-7 Optimistic concurrency on editable records
Visits (`lockVersion`), templates, service users and absences (`version`) refuse stale edits with a ConflictError that asks the person to reload.

## AD-8 Area scope from membership
A membership with no `MembershipArea` rows sees the whole organisation. With rows, visits, alerts and lists are limited to those areas, and acting on anything outside them raises ForbiddenError.

## AD-9 Absences and availability are HR-controlled
They need an HR & Workforce account, are limited to that account's branches, and are read-only for Branch Viewers. Whoever enters a request cannot approve it. Sickness is recorded as approved, because there is nothing to decide.

## AD-10 Sensitive service-user fields
Date of birth and NHS number need `serviceUser.sensitive`. The key safe code is AES-GCM encrypted at rest, and every reveal is audited.

## AD-11 Nothing outbound
Notifications are in-app only. No SMS, email or push is sent from rostering. Finance runs, once built, will never issue invoices or payroll automatically.

## AD-12 No new dependencies
The build uses the existing stack only: Next.js, Prisma, zod and Phosphor. Planner drag-and-drop uses native HTML5 drag events in a small client component, and keyboard users get the same action through the visit page.
