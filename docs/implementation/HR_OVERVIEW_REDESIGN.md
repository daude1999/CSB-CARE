# HR overview, People and Recruitment redesign (2 Nov 2026)

Owner's brief of 2 Nov 2026 with an approved concept image (three screens: Dashboard, People, Recruitment). Built on
branch `claude/project-thread-yjjc15` as a draft PR. **Not merged, not deployed.** The concept's names, dates and numbers
are illustrative; every figure on screen is counted from the organisation's own records.

## What each screen is for now

| Screen | Job | What changed |
|---|---|---|
| HR overview (`/hr/dashboard`) | What needs attention today | Light heading "HR overview / Your priorities today"; four figures; Action required (each row has a working Review link to the existing screen, already filtered); Coming up (new starters and booked interviews). The employee directory, needs-attention list, upcoming-checks table and quick-actions panel were removed (People and the Checks register already do those jobs). My Tasks and Alerts are links in the heading. |
| People (`/hr/people`) | Find and manage employees | One directory: search, Branch and Status filters, Name / Role / Branch / Status / Compliance and an actions menu (Quick view, Open record, Edit details). Role, manager, check status, "due by", extra columns and saved views are under **More filters**. Import and Export are under **More**. Filters stay in the address, so returning from a record keeps them. |
| Recruitment (`/hr/recruitment`) | Applicants and their next steps | Pipeline board with all six real stages (the concept's Applied, Screening, Interview, Offer plus Onboarding and Ready for Work). Cards: initials, name, role (and branch), next step, interview or due date, "Overdue" with an icon. The name opens the record; the card's menu opens the quick panel, which keeps the validated stage move. Search, Role (new), Branch, Recruiter and **Show** (the old figures strip: new, waiting for review, offers awaiting an answer, next step is ours, and closed applications). Upcoming interviews and Reminders moved under the board. List view kept. |

All other HR screens (employee record, Checks & Training, Documents, Time Off, Settings, candidate record) keep the
orange module header and are unchanged.

## Counting rules

From the HR Hub's data for the branch scope on screen (`src/hr/lib/overview.ts`, unit-tested in
`tests/unit/hr-overview.test.ts`) and from the platform database (`src/server/workforce/hr-overview.ts`, integration-
tested in `tests/integration/hr-overview.test.ts`):

- **Employees**: everyone not archived.
- **Starting soon**: start date from today to 30 days ahead.
- **Interviews today**: interviews of open applications starting today (London), booked or already held. Cancelled,
  declined and missed ones are not counted.
- **Actions due**: the distinct items listed under Action required. A check that appears in two rows (an overdue
  training record) counts once.
- **Action required rows** (shown only when the count is above zero): training expiring or overdue (category Training,
  overdue or due within 30 days); documents awaiting review (evidence uploaded, not verified); leave requests to approve
  (waiting for a decision, ending no earlier than 30 days ago: the list Holidays & Sickness opens on); required checks
  missing evidence; checks overdue (training included); checks without a next review date; the signed-in person's own HR
  tasks past due (onboarding tasks included).
- **People compliance**: the person's least healthy required check: Overdue or Missing evidence (red), Review needed
  (to verify or incomplete) or Due soon (amber), Compliant (green), Not assessed (no checks required). Always a word and
  an icon. Employment status is a separate column.

Interviews and leave requests come from `GET /api/hr/overview?branch=`: it checks the session, HR portal access and the
HR account's branches on the server, and answers 404 for a branch the account does not cover. If it cannot load, the
overview says so and offers Try again; it never shows a zero instead.

## Shared look

`src/app/(app)/hr/hr-ui.css` (tokens and components, every rule under `.hr-ui`, loaded only by HR pages) and
`src/components/hr-ui.tsx` (heading, figure, avatar, badge, status, empty state). The same components serve the HR
Hub's client screens and the server-rendered Recruitment page. `tests/unit/hr-overview.test.ts` fails if any rule in the
sheet is not under `.hr-ui`.

## Preserved

HR stays the employee record; Rostering's connection, Suspended status, visit flags, training evidence permissions,
time off, replacement cover and Back/Forward are untouched (no file under `src/server/rota`, `src/server/workforce`
except the new read-only `hr-overview.ts`, or the shell changed). Stage moves use the same `moveStageAction`;
onboarding and duplicate prevention are unchanged. The Checks register now also accepts `?category=` and an
"Expiring or overdue" status (used by the training row); with no parameters it behaves as before.

## Differences from the concept (deliberate)

- The platform's dark sidebar, top bar and module switcher are kept (shared by every module; the brief says not to add a
  second sidebar). The concept's white sidebar is not copied.
- Recruitment shows six stage columns, not four, so the cards are narrower than in the concept.
- "View all" on Coming up is replaced by a "Recruitment" link: the list mixes new starters and interviews, which have
  no single "all" page.
- The figures carry a one-line note saying what is counted.
- Leave request counts follow the HR account's branches; the Holidays & Sickness page itself has no branch filter.

## Not built

- No messaging, calendar or job-board integration; nothing is sent to applicants.
- No drag-and-drop on the board (moves stay on the record and the quick panel).
- No onboarding milestone dates beyond HR tasks: there is no milestone record.
