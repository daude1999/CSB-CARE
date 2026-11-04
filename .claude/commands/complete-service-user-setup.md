---
description: Review a referral's documents and complete a service user's setup through the app's Care Coordinator screens, with every decision made by a signed-in person.
argument-hint: "[what to set up, e.g. new referral for Stepney]"
---
# Complete Service User Setup

You are working in CSB-CARE. Read `docs/implementation/AI_CARE_COORDINATOR.md` first and use the `care-coordinator` and `care-compliance-reviewer` agents for review. Inputs: $ARGUMENTS.

This command never bypasses sign-in, human approval, clinical sign-off or rota publication, and never writes to the database directly.

1. **Documents.** In the app, Rostering → Service Users → Care Coordinator → Start an intake, and upload every document. Real documents go only into the app's private storage: never into the repository, a commit, a PR, a log or a screenshot.
2. **Check facts.** Go through each section. Compare every fact with the original page (Open original). Edit with the plain fields, reject with a reason, ask questions of the right person, mark duplicates. Watch for: current versus historical information, informal or family support (never scheduled), commissioned minutes against the visit rows, medication from discharge letters (never overwrites current medication), resuscitation information (never inferred).
3. **Send for approval.** A manager who did not decide the facts approves each section, or returns it with a reason.
4. **Save to record.** Save the approved sections; each is read back. Retry a failed section after fixing the cause.
5. **Approvals outside the intake.** A different manager approves the draft care plan and each risk draft. Medication follow-ups are reconciled with the current GP or pharmacy list.
6. **Rota.** Make care Active, preview and create the draft rota (always unpublished). Use the suggested carers as a starting point; assign and publish on the Daily Rota.
7. **Report.** List what was saved, what was rejected and why, the open follow-ups and anything a person still has to decide, without copying personal details into chat or files.
