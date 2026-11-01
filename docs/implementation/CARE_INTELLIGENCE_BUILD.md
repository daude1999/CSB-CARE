# Integrated care intelligence build (1 Nov 2026)

One coordinated build on `claude/project-thread-q183f2`, delivered as one Draft PR. Product name stays **CSB All In One
Platform**. Nothing here merges, deploys or changes the live demo until the owner writes "I approve the screenshots.
Merge the PR."

## What was already there and reused

| Need | Reused, not rebuilt |
| --- | --- |
| People | HR Hub workspace (`HrWorkspace`) and its projection into `StaffMember` (`src/server/workforce`) |
| Eligibility | `src/server/workforce/eligibility.ts`, readiness (`src/server/readiness`); ONBOARDING blocks every slot except shadow |
| Cover | Unassigned Visits, Find Cover (Recommended / Manual / Review), Coverage History, Sickness & holiday cover, the rota optimiser |
| Alerts | `RotaAlert` and the Exceptions register (owner, deadline, escalation), the Monitor sweep, in-app notifications only |
| Care records | Care plans (versioned, second-person approval), risks, incidents, visit notes, task outcomes, MAR (behind its switch) |
| AI | `getAiProvider()` (anthropic, simulated, none) and zod-validated output |
| Reporting | KPI registry (`src/server/reports/kpis.ts`), branch scoping, CSV export with definitions |

## What is new

| Work package | Where | Summary |
| --- | --- | --- |
| WP1 Recruitment | `/hr/recruitment`, `src/server/recruitment` | Applied → Screening → Interview → Offer → Onboarding → Ready for Work, plus Withdrawn and Unsuccessful with retention and a "remove personal details" step. Structured screening questions (no automatic rejection), interviews with clash check, offers only after a passed interview, configurable in-app reminders, optimistic locking, full history. |
| WP2 Onboarding to readiness | `startOnboarding`, `staffReadinessCheck` | HR authorises onboarding: creates (or links, to avoid duplicates) the HR employee as a New starter with the standard checks and tasks, in the same transaction as the candidate change. The candidate page shows Eligible / Needs Review / Not Eligible from the real eligibility service. "Ready for Work" is recorded only after HR makes the employee Active, and never grants eligibility. |
| WP3 Rota intelligence | `/rota` "Coming up", Unassigned Visits, plan page | Six alerts counted by the same services as the screens they open (unassigned tomorrow, double-ups, absences and HR flags, missed calls without a decision, hours over limit, bookings to review). "Find Suitable Carers" plans only the ticked visits through the optimiser; every proposal links back to the Manual tab. Nothing is applied until the coordinator confirms. |
| WP4 Care Summary | `/rota/care-plans/[id]?view=summary`, Service User overview | Recent records (no AI, always available) for 7, 14, 30 days or custom, with counted visit facts. Optional AI draft in four sections; every point cites record ids, uncited points are dropped, provenance is stored, the text is frozen by trigger, and it stays "Unapproved draft" until a manager reviews or dismisses it. "Start a care plan review" opens an ordinary draft linked to the summary; the summary text is not copied in. Off until an admin records who authorised it in Rostering Settings. Service User overview gains "At a glance". |
| WP5 Monitor alerts | `/rota/monitor` | "Today's alerts": what, who, when, why, source visit, owner and deadline, and the existing actions (Open visit, Missed Calls, Find Cover, Owner and resolve). One entry per visit and kind; a late alert is folded into a missed one. Visit status words kept distinct: No attendance recorded, Recorded missed, Not delivered, Cancelled, Completed late, In progress, Completed. |
| WP6 Compliance and insights | Compliance Dashboard "Needs attention", `/analytics` | Staff not ready because of a policy sign-off, open safeguarding incidents and overdue care-plan reviews link from compliance into care operations (shown only when not zero). Analytics becomes "Care Operations Insights" with Staffing, HR/recruitment/readiness and Care quality groups, each figure with its definition, branch scope and a link. |

## Schema (additive only)

Migration `20261101200000_recruitment_care_summary`: enums `RecruitmentStage`, `RightToWorkStatus`, `InterviewStatus`;
tables `Candidate`, `CandidateEvent` (append-only trigger), `CandidateNote`, `CandidateScreening`, `CandidateInterview`,
`RecruitmentSettings`, `CareSummary` (output, sources and provider frozen by trigger); nullable columns
`RotaSettings.careSummaryEnabledAt/ById/ReviewNote` and `CarePlan.sourceSummaryId`. No existing column changes.
Hosted builds run `tsx prisma/seed-recruitment.ts`, which adds 12 fictional candidates only when the organisation has none.

## Safety decisions

- No external calendar, job board, email or SMS is connected. Reminders are in-app to the recruiter only; screens say so.
- Care Summary sends record text (never names or addresses) only after the switch is on and a provider is configured.
  With `AI_PROVIDER=simulated` it is a labelled keyword count, and nothing leaves the platform. With no provider the
  screen says it is not configured; the records view still works.
- The summary never edits care plans, diagnoses, incidents or safeguarding records.
- Every number is counted from records at request time. Alerts and KPIs link to the screen that lists the same records.

## Known limitations

- Recruitment KPIs use the `readiness.view` permission; the recruitment screens themselves need an HR account.
- Interview times are not synced to any calendar; candidates are not contacted by the platform.
- Continuity of care is explained in Find Cover's existing reasons; no separate continuity score was added.
- Travel time is not estimated where the optimiser has no postcode data; nothing is invented.
- The Compliance Dashboard care items appear only when their count is above zero, so the demo shows none today.
