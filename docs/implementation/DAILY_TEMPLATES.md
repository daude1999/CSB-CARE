# Daily Templates (`/rota/templates`)

Owner's brief "CSB-CARE — Final Daily Templates implementation" (1 Nov 2026). The approved image is
`design-references/CSB_Daily_Templates_Approved_Roll_Forward.png`, added after PR #42. The follow-up matches the page to
it, and a real 1672 × 941 screenshot was compared side by side with it.

## What the page does

| Area | Behaviour | Code |
| --- | --- | --- |
| Heading | "Daily Templates", "Manage repeating care visits (up to N-week cycle)" from `RotaSettings.cycleLength` | `TemplatesHeader` |
| Views | Daily Templates, Advanced Templates (`/rota/templates/planner`), Build Rota (`/rota/build`) | `TemplatesHeader` |
| Roll Forward | Outlined purple, far right; opens the existing preview at `/rota/build?roll=1`. Shown only with `rota.build`. Nothing is copied until the coordinator confirms there | `TemplatesHeader` |
| Cycle week | Week 1 to the organisation's cycle length; filters on the template's `cycleWeeks`, so an All Weeks template shows in every week. A dot marks the cycle week of the current calendar week | `ChoiceGroup` |
| Day | Mon to Sun cards showing the dates of a real calendar week whose place in the cycle is the chosen pattern week (the first such week from this week on). ‹ › step one calendar week (`?on=`), and the selected cycle week follows. When "Every cycle week" is chosen the cards show no dates | page |
| Filters | Search (service user name or reference, template reference `T-XXXXXX`, carer name, call type), Area (authorised areas only), Team Member, Service User, Call Type. More Filters: active/inactive/all, short of a carer, every cycle week, every day. All in the URL | `templatePage` |
| Table | One row per template (a double-up is one row). Sortable by Service User or Time. Ref, Service User, Time, Duration, Carers (1/1, 2/2 green; 1/2 amber; 0/1, 0/2 red), Team Member(s), Service Call, Area, Pattern, Status (Active/Inactive), Actions (pencil to edit; a menu with View details, Duplicate, Deactivate or Activate). Paged on the server (10/25/50/100) | `templatePage`, `rota-pattern.ts` |
| Template Details | Opens on a row click or View (`?tpl=`), closes with ×. Pattern, days, times, carers, call, area, settings, dates, notes, warnings and the count of future built visits. Edit Template, Duplicate (copy starts inactive), Deactivate (asks first) or Activate | `templateDetails` |
| Bulk actions | Every existing action: activate/deactivate, reassign, unassign, edit start time, edit duration, nudge, add/remove lock, edit service name, add/remove alert, duplicate, convert to double-up, revert to single. Each template is checked and saved on its own; refusals are reported | `BulkTemplateBar` → `templateBulkAction` |

Advanced Templates now uses the same heading, view tabs, Roll Forward button and week picker. Its grid and
drag-and-drop are unchanged. Build Rota is unchanged.

## Rules kept

- Templates are the repeating pattern. Nothing on this page changes built visits; a change reaches built visits only
  through "Apply to built visits" on the template's Edit page, which leaves hand-changed and started visits alone.
- Every list, count, search and details lookup is limited to the caller's organisation and areas (`templateScopeWhere`).
  A `?tpl=` id from another branch or organisation shows nothing.
- Deactivate never deletes; history and built visits are kept.
- Templates support one or two carers only. Three- or four-carer templates aren't built.

## Tests

- `tests/unit/rota-pattern.test.ts`: pattern, weekday, coverage and duration labels.
- `tests/integration/daily-templates.test.ts`: paging, week/day filters, every filter, search, double-up as one row,
  details warnings, disabled duplicate, branch and organisation isolation, create then list.
- `tests/e2e/daily-templates.spec.ts`: pickers, details open/close, tabs, Roll Forward opens the preview, deactivate
  with confirmation, bulk action.

## Differences from the approved image (deliberate)

- The top bar and the left sidebar are the platform's own; the owner reserved the sidebar for a later update.
- References are `T-` plus the end of the template's id (for example `T-SQ8LT4`). The image's `TMP-1001` would need a
  new sequential reference column, which is a schema change.
- Service calls show their name without an icon, because call types are created by each organisation and no icon is
  stored for them.
- Deactivate uses a "no entry" icon, not the image's bin, because deactivating never deletes anything.
- Go stays pale until templates are ticked and the action's details are filled in, and it says why.
- Panel facts beyond the image (settings, run route, dates, notes, built visits) are under "More details".

## Known limits

- With the details panel open below about 1600px wide, the table scrolls sideways to reach Status and Actions.
