# Overview — approved design (1 Nov 2026)

The owner approved `docs/design/overview-approved-reference.png` for `/overview`. This is a focused change to that page.

## What changed
- **Header (Overview only).** A dark CSB header replaces the standard top bar on `/overview`: the official monogram
  (`public/brand/csb-monogram-on-dark.png`), "Care Solution Bureau CIC" with "Integrated care management" (or the
  customer organisation's name), today's date and time in Europe/London (`londonClock()` in `src/lib/london.ts`,
  refreshed every 10 seconds), notifications, help, and the signed-in person's name and role from the session with a
  small menu (branch, sample-workspace label, sign out). There is no search box on the Overview; every other page keeps
  the standard top bar and its search (`TopbarSwitch` in `src/components/overview-header.tsx`).
- **No figures row.** The eight figure tiles and the organisation card above Quick Actions are gone. The services behind
  them (`activeServiceUsers`, `activeStaff`, the trends) are kept.
- **Rostering & Care Management card.** The miniature planner is replaced by five figures for today, each linking to
  the page it was counted from:

  | Figure | Definition | Source |
  | --- | --- | --- |
  | Visits completed today | Today's visits with status Completed | `rotaSnapshot` |
  | Pending visits today | Today's visits still Scheduled (not started) | `rotaSnapshot` |
  | Missed visits today | Visits confirmed Missed only. A late visit still awaiting a clock-in is not counted. Equals the Rota Dashboard's missed figure. | `rotaSnapshot` |
  | Unassigned visits today | Visits still to be delivered with a carer slot empty; the same figure as Needs your attention | `rotaHeadline` |
  | Active staff on rota | Carers (shadow shifts excluded) booked on a visit today that is going ahead; the Rota Dashboard's "staff on duty" | `rotaSnapshot` |

  All are limited to the person's organisation, branches and areas, and hidden from people without `rota.view`.
- Unchanged: Quick Actions, the Policy, HR, Reporting and Administration cards, Needs your attention, module
  rearranging, the left menu (owner's choice on 1 Nov 2026), the Rota Dashboard and Daily Rota.

## Tests
- `tests/integration/overview-rota-figures.test.ts`: the five figures reconcile with the Rota Dashboard and Daily Rota,
  respect branch grants and organisation isolation, and are hidden from carers.
- `tests/unit/london.test.ts`: the header clock across GMT, BST and the October clock change.
- `tests/e2e/overview.spec.ts`: no figures row, five Rota figures, header logo, London date and time, signed-in name,
  no search on the Overview, search still on other pages.
