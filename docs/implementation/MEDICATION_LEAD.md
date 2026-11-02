# Medication Lead (PR 2 of 4)

Owner's brief of 2 November 2026, Part 2 ("Medication responsibility"). Works inside the existing visit allocation and
the existing eMAR, and only while the organisation has medication switched on (Settings; needs a clinical review note).

## Rules

- A visit needs a Medication Lead when it is marked "Medication prompt" or an approved medicine is due at its time.
- **One carer:** they become the Medication Lead automatically, but only when their readiness for the visit's medication
  tasks is clear (training, competency, restrictions, open review flags). Otherwise responsibility stays unassigned and
  the office gets a "Medication Lead needed" alert.
- **Two or more carers:** an authorised coordinator (rota editing plus medication access) chooses the lead from the
  carers booked. Only carers cleared for medication can be chosen; the others are listed with the reason.
- **Reassignment:** when the lead is removed, replaced or swapped away, a database trigger ends their responsibility at
  once, the visit shows "Needs reassessment" and the office is alerted. Changing the lead needs a reason. Every record
  keeps who set it, when, who ended it and why; nothing is edited or deleted (database triggers).
- **eMAR:** a dose is still recorded by the carer who actually gave it (MAR record), once per dose. A missed dose is
  recorded against the Medication Lead (or the only carer); other carers on the visit are never marked for it.
- Builds and roll forward set the lead on single-carer medication visits and send the office one summary for the rest.
- Being the lead is never treated as evidence that medication was given.

## Data model (additive)

`VisitMedicationLead` (one live row per visit by partial unique index; source AUTO or COORDINATOR). Triggers: the lead
must be a booked carer; rows can only be ended once; the row ends when the carer's booking ends.

## Tests

`tests/integration/medication-lead.test.ts` (11).
