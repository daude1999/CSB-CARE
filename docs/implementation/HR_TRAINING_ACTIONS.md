# Assign Training and Send Reminder (2 Nov 2026, draft PR)

The two buttons the owner's approved HR Training design (`04_Training_And_Compliance.png`) shows under "Due this
week", left out of PR #55 because nothing stood behind them. Both now work, on **HR → Checks & Training →
Training & Readiness**. Only HR users who may edit (not Branch Viewers) see them; the server checks again.

## Assign Training

- Choose a course (from the organisation's training requirements and training already on records, or type one), the
  people (search, role filter, "choose all shown"), a complete-by date, who in HR follows it up, and an optional note.
- For each person it records a **training assignment**, an **HR task** "Complete training: …" (status *Waiting on
  employee*, in My Tasks) and a line in the employee's history. The same open course is never assigned twice; archived
  people are skipped and named in the result.
- **It never changes a check, its evidence or rota readiness.** Readiness still comes only from verified checks, so
  assigning a course cannot block anyone from visits. (This was the deciding design choice: a new required check with no
  certificate would have flagged the person on the rota at once.)
- Assigned courses due in the next 7 days (or late) appear in "Due this week". The employee's **Training** tab lists
  them with **Mark complete** and **Cancel**.
- An assignment closes when: HR marks it complete or cancels it; its HR task is set to Complete in My Tasks; or the
  person's own training check of the same name is verified (Record review). Marking complete never verifies training.

## Send Reminder

- Lists everyone in the branch view with training to do: open assignments, and required training that is overdue, due
  soon or has no certificate. "To verify" items are HR's job and are left out.
- Shows, per person, whether they **get it on CSB** (a linked CSB sign-in), **have no CSB sign-in** (tell them
  yourself) or were **already reminded today**, and a preview of the exact words.
- Sending creates an **in-app notification only** (the bell, `/notifications`). No e-mail delivery row or job is
  created, so nothing leaves CSB. One reminder per person per day. Each one is recorded in the employee's history.
- Who has a sign-in comes from the workforce link (`StaffMember.userId`, set by an administrator only), re-checked inside
  the same database transaction that writes the HR history and the notifications.

## Where the code is

| Part | File |
|---|---|
| Rules (assign, close, outstanding training, reminder wording, who gets a reminder) | `src/hr/lib/training.ts` |
| Sign-in lookup and in-app notifications | `src/server/workforce/training-reminders.ts` |
| API actions `assign-training`, `close-training`, `training-reminder`; GET adds `trainingAssignments`, `trainingReminders`, `signIns` | `src/app/api/hr/hub/route.ts` |
| Panels and the record list | `src/hr/components/training-actions.tsx` (styles in `src/hr/styles/hr-views.css`, rebuilt into `public/hr/hr-hub.css`) |
| Buttons | `TrainingMatrix` in `src/hr/components/hr-views.tsx` |

No database migration: assignments and reminders live in the HR Hub's own JSON document (`HrWorkspace`), like tasks.

## Also fixed

HR side panels (Add employee, Upload, Record review, and the two new ones) open in a portal outside the HR Hub's root,
so their fields and buttons had lost their styling. `Drawer` now wraps the panel in the HR root (`display: contents`).

## Not built

- E-mail or text reminders (needs the owner's review of outbound messages first).
- Reminders for staff without a CSB sign-in.
- Staff Sign-off "Send Reminder" in Policy & Compliance (policy reminders already run automatically in-app).

## Test results (2 Nov 2026, local, isolated databases)

| Command | Result |
|---|---|
| `npm run typecheck` | passed |
| `npm run lint` | passed |
| `npm run test:hr` | 22 passed (8 new in `tests/hr/training.test.ts`) |
| `npm test` (Vitest, `csb_test`) | 79 files, 639 passed, 0 failed (includes 5 new in `tests/integration/hr-training-actions.test.ts`) |
| `npm run build` | succeeded |
| `npx playwright test hr-training-actions hr-compliance-ux hr-staff-record navigation` | 34 passed, 1 failed (a wrong selector in the new test: the banner sits outside the form); fixed, re-run `hr-training-actions`: 3 passed |

No file under Rota, the Overview, or the shared page header changed.
