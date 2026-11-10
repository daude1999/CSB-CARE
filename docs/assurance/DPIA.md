# Data Protection Impact Assessment: CSB Care platform

> **DRAFT FOR HUMAN REVIEW.** Drafted by an AI assistant from the code and documents in this repository on
> 10 November 2026, following the structure of the ICO's DPIA template. It has not been reviewed by a data
> protection officer or lawyer. Items marked **[OWNER]** need facts or decisions only the organisation can give. A
> DPIA is not finished until the controller signs it and consults its data protection lead; if a high risk cannot
> be reduced, the ICO must be consulted before the processing starts (UK GDPR Article 36).

| | |
| --- | --- |
| Controller | Care Solution Bureau CIC **[OWNER: registered address, company number, ICO registration number]** |
| Data protection lead / DPO | **[OWNER: name]**. A DPO is likely to be required because the core activity includes large-scale processing of health data (UK GDPR Article 37(1)(c)). |
| Caldicott Guardian / IG lead | **[OWNER: name]** |
| System | CSB All In One Platform ("CSB Care") |
| Version assessed | `main` at commit a702f5c, 10 November 2026 |
| Review date | **[OWNER]**; at least yearly and before any change listed in section 8 |

## 1. Why a DPIA is needed

A DPIA is mandatory under UK GDPR Article 35 because the platform:

- processes **special category data on a large scale** (health and care records of service users);
- processes data about **vulnerable people** (adults receiving care, some of whom lack capacity);
- processes **criminal-offence data** (DBS check outcomes for staff);
- can use **new technology** (AI reading of referral documents) when that is switched on;
- **monitors** staff location in time (visit clock-in and clock-out) and matches records from several sources.

## 2. The processing

### 2.1 Nature

A web application used by a domiciliary care provider's office staff and care workers to:

- keep service user records, care plans, risk assessments, medication records (off until clinically reviewed),
  incidents, body maps and documents received from councils and hospitals;
- plan and monitor care visits (rota, call monitoring, missed-call handling);
- keep staff records, recruitment, training and compliance checks (HR Hub);
- prepare timesheets, pay and invoice figures for other systems;
- manage policies, regulatory change, audits and CQC readiness.

Collection: typed in by staff, uploaded as documents, or (when enabled) extracted from uploaded documents by an AI
model as a **proposal** that a named member of staff checks. Storage, access and outbound flows are in
[DATA_FLOW.md](DATA_FLOW.md). Deletion: none is automated; see [RETENTION_SCHEDULE.md](RETENTION_SCHEDULE.md).

### 2.2 Scope

| | |
| --- | --- |
| Data subjects | Service users; their relatives, attorneys and professional contacts; employees, workers and job candidates; platform users |
| Data | Listed in DATA_FLOW.md "Who the data is about" |
| Volume today | Two real service users on the live site as of 10 November 2026, plus staff records **[OWNER: confirm numbers]** |
| Expected volume | **[OWNER]** service users and staff across three branches (Liverpool, Portsmouth, Tower Hamlets); more if other providers become customers |
| Geography | Individuals in England. Storage and processing locations in DATA_FLOW.md |
| Retention | Proposed in RETENTION_SCHEDULE.md; not yet adopted |

### 2.3 Context

- Care Solution Bureau CIC is both the **software owner** and a **care provider using it**. For its own service
  users and staff it is the **controller**. If other care providers become customers, each is the controller for
  its own records and CSB is their **processor**; that needs a written processing agreement under Article 28 and
  is a material change to this DPIA.
- Individuals would expect a care provider to keep these records; they would not necessarily expect them to be sent
  to an AI provider outside the UK. That flow is off by default.
- The platform is a **demo-stage product moving to production**. Hosting today is described as "demo only" in
  `docs/DEPLOYMENT.md`; a move to Azure UK is planned and is out of scope of the current programme.
- Relevant codes and standards: the Caldicott Principles, the NHS Data Security and Protection Toolkit, CQC
  regulations 17 (records) and 12 (safe care), the NHS Records Management Code of Practice.

### 2.4 Purposes

Delivering and evidencing safe care; meeting regulatory duties (CQC, safeguarding, health and safety); employing
and paying staff lawfully; managing the business.

## 3. Consultation

| Who | How | Status |
| --- | --- | --- |
| Data protection lead / DPO | Review of this DPIA | **[OWNER]** not started |
| Registered manager and Caldicott Guardian | Review of access roles and restricted-record rules | **[OWNER]** not started |
| Care staff and office staff | Feedback on clock-in monitoring and what they can see | **[OWNER]** not started |
| Service users or their representatives | Privacy notice; views on record keeping and any AI use | **[OWNER]** not started |
| Processors (hosting, database, email, AI) | Processor agreements and transfer terms | **[OWNER]** not started |
| Security tester | [PEN_TEST_SCOPE.md](PEN_TEST_SCOPE.md) | Not commissioned |

## 4. Necessity and proportionality

### 4.1 Lawful basis (to be confirmed by the controller)

| Processing | Article 6 basis (proposed) | Article 9 / Schedule 1 condition (proposed) |
| --- | --- | --- |
| Service users' care records | 6(1)(e) public task where care is commissioned by a council or the NHS, or 6(1)(b) contract for private clients; 6(1)(c) legal obligation for records CQC requires | 9(2)(h) provision of health or social care, with DPA 2018 Schedule 1 paragraph 2 (handled under a duty of confidentiality) |
| Safeguarding records | 6(1)(c) legal obligation / 6(1)(e) public task | 9(2)(g) substantial public interest: DPA 2018 Schedule 1 paragraph 18 (safeguarding of individuals at risk). Needs an appropriate policy document. |
| Contacts of service users | 6(1)(f) legitimate interests, or 6(1)(e) | Not special category in itself |
| Staff employment records, sickness absence | 6(1)(b) contract, 6(1)(c) legal obligation | 9(2)(b) employment law: DPA 2018 Schedule 1 paragraph 1. Needs an appropriate policy document. |
| DBS outcomes | 6(1)(c) legal obligation (CQC regulation 19) | Article 10 with DPA 2018 Schedule 1 paragraph 1 or 6 |
| Visit clock times | 6(1)(f) legitimate interests (evidence of care delivered, lone-worker safety, pay); a legitimate interests assessment should be written | n/a |
| Security logs and audit trail | 6(1)(c) and 6(1)(f) (Article 32 security duty) | n/a |

Consent is **not** proposed as the basis for care records. Common-law confidentiality still applies alongside.

### 4.2 Proportionality and data minimisation

- Each record type exists because a care, employment or regulatory duty needs it. The platform does not collect
  location by GPS (clock times are the server's time; GPS and NFC are not built).
- Restricted information (medication, safeguarding RCAs, sensitive documents) is hidden from roles that do not need
  it, enforced on the server.
- NHS, council and Frameworki numbers and key-safe codes are encrypted at field level.
- AI reading is optional, off by default, and never writes to a record without a named person's decision.
- **Gap:** date of birth, addresses and free-text notes are stored in plain text in the database (protected by
  access control and the provider's encryption at rest, not by field encryption).
- **Gap:** no retention is enforced, so storage limitation (Article 5(1)(e)) is not yet met.

### 4.3 Individuals' rights

| Right | How it is supported today | Gap |
| --- | --- | --- |
| To be informed | Not in the software | Privacy notices for service users, families and staff **[OWNER]** |
| Access (SAR) | Staff can open and print a person's records and documents | No one-click export of everything held about a person |
| Rectification | Records are editable with history; care plans, call notes and risk assessments keep versions | — |
| Erasure / restriction | Service users can be archived; admin-only delete exists only for people with no care records | No erasure or restriction workflow; most care records must be kept in any case (legal obligation) |
| Objection | Handled outside the system | Procedure **[OWNER]** |
| Automated decisions (Article 22) | None. Matching, missed-call reasons and AI output are suggestions; a person decides | Keep it that way; document it in the privacy notice |

### 4.4 Processors and transfers

See the processor table in DATA_FLOW.md. No international transfer happens in the default configuration **if** the
database and hosting regions are confirmed as UK. Switching on the Anthropic provider sends document text to the
United States and needs an International Data Transfer Agreement or Addendum and a transfer risk assessment first.

## 5. Risks

Likelihood and severity are judged **after** the controls that exist today. Scale: Low / Medium / High.

| # | Risk to individuals | Likelihood | Severity | Risk |
| --- | --- | --- | --- | --- |
| R1 | One organisation's staff see another organisation's service users because a database query misses its organisation filter | Low | High | **Medium** |
| R2 | An account is taken over (password guessed, phished or reused); there is no two-factor sign-in | Medium | High | **High** |
| R3 | A member of staff sees more than their role needs (wrong role or branch given) | Medium | Medium | **Medium** |
| R4 | Records are lost and cannot be restored (off-site backup not yet active; database on a free plan) | Medium | High | **High** |
| R5 | Referral documents are sent to an AI provider outside the UK without a lawful transfer | Low (off by default) | High | **Medium** |
| R6 | An AI-extracted fact is wrong and reaches a care plan, medication list or risk assessment | Low (human check, quote and page shown) | High | **Medium** |
| R7 | Personal data appears in application logs or an error-tracking service | Low | Medium | **Low** |
| R8 | A malicious file is uploaded and later opened by staff (no scanner configured) | Low | Medium | **Low to Medium** |
| R9 | Records are kept longer than needed (no retention enforced) | High | Low | **Medium** |
| R10 | CSB platform staff view a customer's records without need | Low | High | **Medium** |
| R11 | Real personal data is copied into GitHub, screenshots, test data or chat tools | Low | High | **Medium** |
| R12 | Late or missed visits go unnoticed because the hosted demo has no always-on background worker | Medium | High (harm to a person, not a privacy harm) | **High** |
| R13 | Hosting described as "demo only" is used for real records without contracts, uptime commitments or support | High (already the case) | Medium | **High** |
| R14 | A lost or shared staff phone exposes a carer's visit list | Medium | Medium | **Medium** |
| R15 | Key for encrypted references (`CSB_REFERENCE_SECRET`) is lost or leaked; no rotation procedure | Low | Medium | **Low to Medium** |

## 6. Measures

| Risk | In place | Planned in the enterprise-readiness programme | Still needed (owner or later work) | Residual |
| --- | --- | --- | --- | --- |
| R1 | Organisation filter from the session on every query; 404 for other tenants' records; cross-tenant tests | PostgreSQL row-level security on every tenant table with its own test suite (workstream 2) | Independent penetration test | Low |
| R2 | bcrypt cost 12; hashed session tokens; 12-hour idle and 7-day absolute expiry; sign-in rate limit; HttpOnly Secure cookies | — (two-factor is explicitly out of scope of this programme) | **Two-factor or single sign-on for all office roles before scaling up**; password policy; leaver process | **Medium to High until two-factor exists** |
| R3 | Role and branch permissions on the server; restricted sections | — | Quarterly access review by the registered manager **[OWNER]** | Low to Medium |
| R4 | Encrypted backup and monthly restore check built (PR #118) | Health endpoint reports queue backlog; uptime alerting documented (workstream 3) | **Activate the backup; run and record a restore test; move off the free database plan** | High until activated, then Low |
| R5 | AI off by default; setting visible to admins | — | Transfer agreement and assessment before switching on; or a UK/EU-hosted model route | Low while off |
| R6 | Every fact shows its page and quote; verbatim check; drafts only for care plans, risks and medicines; named human decision | — | Clinical safety review (DCB0129/0160) before medication features are used | Low to Medium |
| R7 | Logger redacts secrets | Redaction of care-record fields with a unit test; error tracker scrubbing before send (workstream 3) | Choose an EU or UK error-tracking region | Low |
| R8 | Type detected from content; private storage; download as attachment; "Not virus-checked" label | — | Configure a scanner (`MALWARE_SCAN_URL`) or Defender for Storage | Low once configured |
| R9 | — | Proposed schedule (this pack) | Owner sign-off, then a reviewed disposal workflow | Medium until built |
| R10 | Time-limited support access grants approved by the customer; audit log | RLS bypass path audited (workstream 2) | Confidentiality terms for CSB staff; regular review of grants | Low |
| R11 | Project rule: synthetic data only in the repository, tests and screenshots | CI runs on synthetic data only | Staff guidance; no real records in chat or AI tools | Low |
| R12 | Monitor shows when it last checked and warns after 10 minutes | Health endpoint and alert documentation | **An always-on worker (planned with Azure)** | High until a worker runs |
| R13 | — | — | **Production hosting with signed agreements** (out of scope here; owner's decision) | High until moved |
| R14 | Carers see only their own visits; sessions expire | — | Device policy: screen lock, no shared logins **[OWNER]** | Medium |
| R15 | Key kept separate from the database | — | Key custody and rotation procedure in the runbook | Low |

## 7. Outcome and sign-off

| Item | Name | Date | Notes |
| --- | --- | --- | --- |
| Measures approved by | **[OWNER]** | | |
| Residual risks accepted by | **[OWNER]** | | R2, R4, R12 and R13 are **high** today. Either reduce them before more real records are added, or record why they are accepted. If they remain high and are not reduced, consult the ICO (Article 36). |
| DPO / data protection lead advice | **[OWNER]** | | |
| Advice accepted or overruled by | **[OWNER]** | | Reasons if overruled |
| Views of individuals considered | **[OWNER]** | | |
| This DPIA is kept under review by | **[OWNER]** | | |

## 8. Changes that must reopen this DPIA

- Switching on the Anthropic AI provider or any other AI service for real records.
- Switching on medication (eMAR) features.
- Onboarding a second care provider as a customer (CSB becomes a processor).
- Moving hosting or database provider or region.
- Adding GPS, NFC, messaging (SMS, WhatsApp) or a family portal.
- Adding an error-tracking, analytics or email provider.
- Building retention disposal.
