# Visit Details panel: Save Changes, Previous/Next, click outside

Owner's brief of 2 November 2026 ("Visit Details panel improvements"). Daily Rota → Visit Details side panel only;
the Daily Rota table and its look are unchanged (visually locked).

## What changed

- **Carer editor with Save Changes.** Reassign Carers (or the X on a carer, or Add Carer) opens an editor in the panel:
  one row per numbered place (Carer 1 … Carer 20) showing *Booked*, *Empty place*, *Will change*, *Will add* or
  *Will remove*, with the ranked carers for each place and their warnings. "Add carer place" and "Remove empty place"
  are part of the same draft. Nothing is saved until **Save Changes**; Discard puts everything back.
- **One transaction** (`src/server/rota/staffing.ts`, `saveVisitStaffing`). All changes run through the existing
  `assignInTx` / `unassignInTx` / `updateVisitInTx`, so eligibility, the double-booking guard, row locks, visit
  history, the audit log and the Medication Lead rules apply exactly as before. If any change is refused nothing is
  saved, and the refusal names the place. A `visit.staffing_saved` audit entry records the places before and after.
- **Concurrent edits.** The draft keeps the visit version it started from; a colleague's newer save makes the save
  fail with "Someone else changed this visit…" and a *Reload the latest version* button. Nothing is overwritten.
- **Save safeguards.** Save is disabled with no changes, shows "Saving…", cannot be pressed twice, and needs the
  warnings box ticked when a chosen carer needs a check. "Saved" appears only after the server commits; the panel and
  table then reload from the database and the panel stays open.
- **Previous | Visit n of N | Next** under the panel heading, worked out by the Daily Rota page from the list exactly
  as shown (same day, filters, sort, search). Crossing a page boundary turns the table to that page. Disabled at the
  ends. A new visit opens on Details, scrolled to the top. Left/Right arrow keys move when nobody is typing or using a
  dropdown or menu.
- **Click outside / Escape / X.** Clicking empty space outside the panel closes it; clicking a plain cell of another
  row opens that visit in one click; clicks inside the panel, its pop-overs, dialogs and other controls never close it.
  No overlay is added. Escape closes an open pop-over first, then the panel. Find Cover (a modal drawer) keeps its own
  keys and clicks.
- **Unsaved Changes prompt** (Save Changes / Discard Changes / Continue Editing) before closing, clicking outside,
  Previous/Next, changing tab, following any link or sending another form while carer changes are waiting. A failed
  save keeps the panel open with the choices still on screen.
- **Locked visits.** Completed and in-progress visits explain why carers cannot be changed and link to office
  corrections on the full visit page; cancelled / not-delivered visits say to reinstate first. Missed visits can still
  be re-staffed for recovery cover and stay Missed; the number of places cannot be changed on them.

Unchanged: tabs, Edit Visit, Add Note, View/Full visit, Find Cover, Swap shift, Make single, Cancel, Reinstate.

## Decisions (owner said "yes" to all four, 2 Nov 2026 23:57)

1. Removing a carer needs no reason; it is recorded as "Removed by the office".
2. One "I have read the warnings" tick covers the whole save.
3. Missed visits can be re-staffed and stay Missed; completed, in-progress and cancelled visits are locked with an
   explanation and a link.
4. Swap shift and Find Cover stay separate and unchanged.

## Files

`src/server/rota/staffing.ts`, `src/app/visit-panel-actions.ts` (returns a result instead of redirecting, so a refused
save keeps the draft), `src/components/visit-panel-shell.tsx`, `src/components/visit-staffing-editor.tsx`,
`src/components/visit-inspector.tsx`, and in `src/app/(app)/rota/visits/page.tsx` only the Previous/Next calculation,
the `nav` prop and a `data-href` on each row.

## Tests

- `tests/integration/visit-staffing.test.ts` (13): add, replace, remove, several changes together including a move
  between places, all-or-nothing on a double-booked carer, ineligible carer refused, same carer twice, warnings,
  colleague saved first, never dropping a filled place, missed stays missed, completed refused, permissions and
  tenant isolation, Medication Lead.
- `tests/e2e/visit-panel.spec.ts` (7): add and save, remove and discard, Previous/Next with sort and across pages,
  arrow keys, click outside, Escape, row click, unsaved prompt (Continue / Discard / Save), colleague conflict,
  completed visit locked. `tests/e2e/rota.spec.ts` updated for the new Reassign Carers button.

## Limitations

- Shadow carers are not edited in the panel editor (as before; use the full visit page).
- Clicking a plain row cell opens a visit only while the panel is open (the reference link works at all times).
