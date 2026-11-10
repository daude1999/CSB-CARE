# Assurance pack

> **DRAFT FOR HUMAN REVIEW.** Every document in this folder was drafted by an AI assistant from the code and
> documentation in this repository on 10 November 2026. None has been reviewed by a data protection officer, a
> solicitor, a Caldicott Guardian or a security tester. They are starting points for the people who must own these
> decisions. Nothing here is legal advice, and nothing here means the platform is certified, DSPT-compliant or
> CQC-approved.

| Document | What it is for | Who should review it |
| --- | --- | --- |
| [DPIA.md](DPIA.md) | Data Protection Impact Assessment for the platform | Data protection lead or adviser, the owner |
| [DATA_FLOW.md](DATA_FLOW.md) | Where personal data comes from, where it is kept and who it goes to | Data protection lead, lead engineer |
| [RETENTION_SCHEDULE.md](RETENTION_SCHEDULE.md) | Proposed retention period for each record type, with the source of each period | Owner, registered manager, HR and finance leads |
| [DSPT_EVIDENCE_INDEX.md](DSPT_EVIDENCE_INDEX.md) | The Data Security and Protection Toolkit standards mapped to evidence in this repository, with gaps | IG lead or whoever submits the DSPT |
| [PEN_TEST_SCOPE.md](PEN_TEST_SCOPE.md) | Scope and rules for an independent penetration test | Owner and the chosen testing supplier |
| [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) | What to do in a security incident or data breach, including the 72-hour ICO steps | Owner, registered manager, data protection lead |

Things only the owner can supply are marked **[OWNER]** in each document (for example the ICO registration number,
named role holders and signed processor agreements).

Nothing in this pack changes how the software behaves. In particular **no deletion or anonymisation job exists**:
the retention schedule is a proposal, and enforcing it waits for the owner's written sign-off.
