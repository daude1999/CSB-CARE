# Visits Needing Attention: one queue (2 Nov 2026)

`/rota/attention` was three stacked panels (Unassigned Visits, Missed Calls, Communication Outstanding). It is now one
prioritised work queue with the selected item's details on the right, built to the owner's image and written spec
(`01 Rota - Visits Needing Attention`). Layout and interaction only: no new rules, no schema change.

- `src/server/rota/attention-queue.ts`: `attentionQueue(ctx, { branch })` calls `unassignedBoard` (this week),
  `missedCallRegister` (open cases, last 30 days) with `coverStates`, and `outstandingCommunication`, and normalises them.
  `attentionGroup` / `groupAttention` are pure and unit-tested.
- Groups: **Act now** (unassigned starting within 4 hours or already started; missed calls past deadline or high-risk;
  overdue communication), **Later today**, **This week**. Within a group: priority, then start time.
- Permissions are unchanged: unassigned needs `rota.view`, missed calls `rota.monitor`, communication and every action
  `rota.edit`. Neither view permission redirects to the rota home.
- Selection is `?item=<type>:<id>`; tiles and tabs set `?type=now|unassigned|missed|comms`; `?branch=` narrows to one of
  the member's own branches. Search filters on the client.
- Below 1280px the details open in the shared `DrawerShell`.
- Assign in the panel opens Find Cover's review step for that carer, so booking still goes through the eligibility check.

Deliberately not built: the image's "Snooze" link (it would be a new rule), carer distance and free-time windows (the
platform holds no such data). The match % shown is the existing eligibility ranking score.
