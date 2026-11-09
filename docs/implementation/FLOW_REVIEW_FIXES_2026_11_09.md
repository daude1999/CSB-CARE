# Review fixes: rota, policy assignment, service users (9 Nov 2026)

Found by walking each flow end to end on a local, synthetic database. No production data was used.

| # | Flow | Problem | Fix | Tests |
|---|------|---------|-----|-------|
| 1 | Service users, policy assignment | Any error sent back by the server emptied the whole form, so one mistake meant retyping everything. | `KeepFormValues` keeps the typed values in this tab only between Save and the answer, then removes them. Date of birth and NHS number are never stored. | e2e `flow-fixes` |
| 2 | Add service user | A date of birth in the future (or before 1900) was accepted; a short NHS number was only caught after the round trip. | Server rule plus `min`/`max`/`pattern` on the fields so the browser stops it first. | e2e + integration |
| 3 | Add service user | The same person could be added twice (same NHS number, or same name and date of birth). | Same NHS number is refused. Same name and date of birth is refused until the person ticks "this is a different person". Archived records count. Manual form only; Care Coordinator setup is unchanged. | e2e + integration |
| 4 | Policy assignment | Choosing a branch, job title, role or person but leaving "Assign to" on "Everyone" silently assigned the policy to the whole organisation. | The form shows only the field for the chosen target, and the server refuses choices that do not match the target (nothing is assigned). | e2e + integration |
| 5 | Policy assignment | A CSB central document shown in the library had no Assign to Staff, and the sign-off link was a 404. | Assign to Staff now opens a page that explains staff sign the organisation's own copy, sends the manager to that copy if it exists, or offers "Create our copy". | e2e |
| 6 | Rota | A template added after the weeks were built never reached the rota and the template page said "All future built visits match". | The template page now says how many visits are missing from built weeks and links to Create Future Rota for that person. | e2e + integration |

Not changed: the Rota Dashboard, Daily Rota and Overview (visually locked), the permission model, document uploads.
