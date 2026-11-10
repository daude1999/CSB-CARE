# DSPT evidence index

> **DRAFT FOR HUMAN REVIEW.** Drafted on 10 November 2026. The Data Security and Protection Toolkit (DSPT) is
> completed by the **organisation** (Care Solution Bureau CIC, as a care provider), not by the software. Most of
> its questions are about people, policies, training and devices, which no codebase can evidence.
>
> **About the numbering.** The toolkit is built on the National Data Guardian's 10 data security standards, and
> each year's version groups its questions ("assertions" and "evidence items") under them; for social care
> providers they are presented in four sections (staffing and roles; policies and procedures; data security; IT
> systems and devices). The exact evidence-item numbers and wording change each year, so this index maps the
> **10 standards and the assertion themes under them**, not individual item numbers. **Whoever submits the DSPT
> must match each row to the current version's item numbers** at https://www.dsptoolkit.nhs.uk.

Key to the "State" column:

- **Evidenced**: something in this repository supports it (shown in the Evidence column).
- **Partly**: the software side exists; the organisational side is needed too.
- **Gap**: nothing in the repository evidences it. "Gap (organisation)" means it can only be evidenced by the
  organisation, outside the software. "Gap (software)" means software work is needed.

## Standard 1. Personal confidential data is handled, stored and transmitted securely

| Assertion theme | Evidence in this repository | State |
| --- | --- | --- |
| The organisation has a named senior lead for data security and protection (SIRO, Caldicott Guardian, DPO or IG lead) | None | Gap (organisation) |
| ICO registration is in place | None; `docs/implementation/UK_DATA_GOVERNANCE_CHECKLIST.md` item 1 says "not confirmed" | Gap (organisation) |
| There is a record of processing activities and of where data flows | `docs/assurance/DATA_FLOW.md` (draft), `prisma/schema.prisma` (every data item held) | Partly: draft exists; the Article 30 record must be completed by the organisation |
| A DPIA is carried out for high-risk processing | `docs/assurance/DPIA.md` (draft) | Partly: needs review and sign-off |
| Privacy notices tell people how their data is used | None | Gap (organisation) |
| Data is encrypted in transit | HSTS and CSP headers in `next.config.ts`; Secure, HttpOnly, SameSite cookie in `src/server/auth/session.ts` | Evidenced |
| Data is encrypted at rest | Field encryption (AES-256-GCM) for key-safe codes and external references: `src/server/care/keysafe.ts`, `src/server/care/external-references.ts`. Disk encryption is the hosting provider's | Partly: provider's encryption statement needed; `CSB_REFERENCE_SECRET` not confirmed set on the live site |
| Records are kept and disposed of in line with a retention schedule | `docs/assurance/RETENTION_SCHEDULE.md` (proposal); `EvidenceDocument.retainUntil` | Gap (software and organisation): schedule not adopted, no disposal workflow |
| Individuals' rights requests (SARs) are handled in time | None | Gap (organisation); no one-click export (software) |
| Data quality: records are accurate and attributable | Immutable audit log (`prisma/migrations/20261024232000_integrity`, `20261029210000_v1_audit_integrity`), versioned care plans, risk assessments and call notes | Evidenced |

## Standard 2. Staff understand their responsibilities

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Staff contracts contain data protection and confidentiality clauses | None | Gap (organisation) |
| Staff are told the policies they must follow and confirm they have read them | Policy acknowledgements and Staff Sign-off (`src/server/policies`, `tests/integration/signoff.test.ts`) | Evidenced (tool); the organisation must publish its data protection policy in it |

## Standard 3. Staff complete appropriate data security training

| Assertion theme | Evidence | State |
| --- | --- | --- |
| At least 95% of staff complete data security awareness training each year | The HR Hub records training per person and reports who is due (`src/hr`, `src/server/readiness`, `tests/integration/readiness.test.ts`) | Partly: tool exists; completion figures are the organisation's |
| Leaders and specialist roles receive suitable training | None | Gap (organisation) |

## Standard 4. Personal confidential data is only accessible to staff who need it

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Access is role-based and follows least privilege | `src/server/auth/rbac.ts`, `src/server/auth/portals.ts`, `src/server/rota/scope.ts` (branch and area limits); `tests/unit/portals.test.ts`, `tests/integration/branches.test.ts` | Evidenced |
| Each user has their own account; no shared logins | One account per email (`User.email` unique); sign-ins linked to staff by hand only (CLAUDE.md rostering rules) | Partly: needs an organisational no-sharing rule |
| Organisations' data is kept separate | `ctx.organisationId` scoping (CLAUDE.md security rules); cross-tenant tests across `tests/integration`; row-level security planned (`docs/SECURITY.md`) | Evidenced (application layer); second layer in progress |
| Sensitive records have tighter access | Restricted coordinator sections, medication permission, sensitive documents (`docs/implementation/EVANTIX_SECURITY_AUDIT.md`) | Evidenced |
| Access by the system supplier is controlled and logged | `SupportAccessGrant` (time-limited, customer-approved) in `src/server/platform/support.ts`; `tests/integration/platform-admin.test.ts` | Evidenced |
| User activity is logged and the logs are reviewed | `AuditLog` (immutable), audit viewer `src/server/admin/audit-viewer.ts` | Partly: logging evidenced; a review routine is the organisation's |
| Leavers' access is removed promptly; access rights are reviewed | Admin user management `src/server/admin/users.ts`, `tests/integration/admin-users.test.ts` | Partly: needs a leaver and access-review procedure |
| Strong authentication; multi-factor for remote and privileged access | bcrypt cost 12 (`src/server/auth/password.ts`); rate limit and session limits (`tests/integration/session-limits.test.ts`) | **Gap (software): no multi-factor or single sign-on.** Out of scope of the current programme by the owner's decision |

## Standard 5. Processes are reviewed at least annually to identify and improve those that caused breaches or near misses

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Lessons from incidents and near misses are identified and acted on | Root cause analysis and action tracking (`src/server/cqc/rca.ts`, `tests/integration/cqc-rca.test.ts`) can record this | Partly: tool exists; the review is the organisation's |

## Standard 6. Cyber attacks are identified and resisted; incidents are reported

| Assertion theme | Evidence | State |
| --- | --- | --- |
| There is a data security incident procedure, including reporting within 72 hours | `docs/assurance/INCIDENT_RESPONSE.md` (draft) | Partly: needs adoption and named people |
| Incidents are reported through the DSPT incident reporting tool where required | Described in INCIDENT_RESPONSE.md | Gap (organisation) |
| Malware protection | Upload scanning hook `MALWARE_SCAN_URL`, policy in `docs/SECURITY.md` | Partly: **no scanner configured**; device antivirus is the organisation's |
| Sign-in attacks are limited | Sign-in rate limit `src/server/auth/session.ts`; shared rate-limit table `src/server/security/rate-limit.ts` | Evidenced (per email; a per-IP limit is listed as a gap in the security audit) |
| Errors and attacks are detected | Structured logs `src/lib/logger.ts`; `/api/health` | Gap (software): no error tracking or alerting yet (workstream 3) |

## Standard 7. A continuity plan is in place and tested

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Backups are taken, held separately and protected | `docs/BACKUPS.md`, `scripts/backup/`, `.github/workflows/postgres-backup.yml` | **Gap: built but not active** |
| Restores are tested | `.github/workflows/postgres-restore-check.yml`, `.github/workflows/backup-scripts-check.yml` (synthetic) | Gap: no real restore test recorded |
| There is a business continuity plan for losing the system | Runbook in `docs/OPERATIONS.md` (technical only) | Gap (organisation): how care continues on paper if the system is down |

## Standard 8. No unsupported operating systems, software or browsers are used

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Software is supported and patched | Node 22 LTS, PostgreSQL 16, Next.js 15 (`package.json`); weekly Dependabot (`.github/dependabot.yml`) and `npm audit` in CI (`.github/workflows/ci.yml`), both added in workstream 1 | Evidenced once workstream 1 is merged |
| Staff devices are supported and updated | None | Gap (organisation) |

## Standard 9. A strategy is in place for protecting IT systems from cyber threats

| Assertion theme | Evidence | State |
| --- | --- | --- |
| Security is tested (penetration test, vulnerability scans) | `docs/assurance/PEN_TEST_SCOPE.md` (scope only) | Gap: no test commissioned |
| Secure configuration and change control | Pull requests with required CI; database integrity triggers; migrations only through reviewed PRs (CLAUDE.md) | Evidenced once the CI check is made required in GitHub |
| Networks and web applications are protected | CSP, HSTS, `X-Frame-Options`, same-origin checks (`docs/SECURITY.md`, `next.config.ts`, `src/server/auth/current.ts`) | Evidenced |
| Passwords and default credentials are managed | Demo passwords exist for demo accounts only (`README.md`); `SHOW_DEMO_LOGINS` must be off in production | Partly: **confirm no demo account remains on the live site** |
| Cyber Essentials or equivalent | None | Gap (organisation) |

## Standard 10. IT suppliers are held accountable through contracts

| Assertion theme | Evidence | State |
| --- | --- | --- |
| There is a list of suppliers that handle personal data | Processor table in `docs/assurance/DATA_FLOW.md` | Partly |
| Contracts with those suppliers include data protection terms | None | Gap (organisation) |
| Suppliers have appropriate certification (for example ISO 27001, Cyber Essentials Plus, their own DSPT) | None | Gap (organisation): collect each supplier's certificates |

## Biggest gaps, in order

1. No multi-factor or single sign-on (standard 4).
2. Backups not active and no restore test on record (standard 7).
3. Production hosting agreements and supplier contracts (standards 9 and 10).
4. Named IG roles, ICO registration, privacy notices, staff training figures (standards 1 to 3).
5. No penetration test (standard 9).
6. Retention not adopted or enforced (standard 1).
7. No malware scanner configured (standard 6).
