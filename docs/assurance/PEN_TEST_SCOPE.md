# Penetration test scope

> **DRAFT FOR HUMAN REVIEW.** A scope to hand to an independent testing supplier. Drafted on 10 November 2026. The
> owner chooses the supplier, agrees dates and signs the authorisation. No test has been commissioned.

## 1. Purpose

Independent assurance, before more real care records are added, that one organisation cannot reach another's data,
that roles hold, and that the platform resists common web attacks. The result supports the DPIA, the DSPT
submission and customers' due diligence.

## 2. Supplier requirements

- CREST-accredited or CHECK-approved company (NCSC-recognised), with named testers.
- Signed non-disclosure agreement and a written authorisation to test from the owner **before** any testing.
- UK-based handling of findings; the report is delivered encrypted and treated as confidential.
- A retest of fixed findings included in the price.

## 3. Target and environment

**Test a staging copy, not the live site.** The live site holds real service users.

| Item | Detail |
| --- | --- |
| Application | CSB Care web application (Next.js 15, server actions and route handlers) |
| Environment | A dedicated staging deployment at the same commit as production, with its own database **[OWNER / engineer to provide URL]** |
| Data | Synthetic demo data only (`npm run db:seed`): two organisations ("Care Solution Bureau" demo and "Oakridge") so tenant isolation can be tested |
| Accounts supplied | One per role in each organisation (org admin, care manager, coordinator, finance, carer, policy author, reviewer, approver, HR admin, group HR, branch HR, branch viewer) and the three platform roles (platform admin, content editor, regulatory reviewer) |
| Source code | Available to the testers on request (grey-box); the repository is private |
| Hosting | Vercel (functions in London) and managed PostgreSQL. **The providers' own infrastructure is out of scope**; check each provider's testing policy and notify them if required |

## 4. In scope

### 4.1 Tenant isolation (highest priority)
- Reading or changing another organisation's service users, visits, care plans, documents, HR records, policies,
  evidence, finance figures and audit entries by changing identifiers in URLs, forms, server-action payloads and
  API calls.
- Search, the AI assistant and report exports leaking other tenants' data.
- Switching organisation without membership; forged or replayed organisation identifiers.
- Once row-level security is deployed: attempts to bypass it (unscoped queries, the audited bypass path).

### 4.2 Authentication and sessions
- Sign-in, sign-out, password reset and invitation links (one-time use, expiry, guessability, reuse).
- Rate limiting and account enumeration; credential stuffing resistance.
- Session cookie handling, fixation, expiry (12-hour idle, 7-day absolute), concurrent sessions.
- Note for the report: there is **no two-factor sign-in**; record it as a finding with a risk rating.

### 4.3 Authorisation inside a tenant
- Each role limited to its permissions (`src/server/auth/rbac.ts`), including branch and area limits.
- Restricted records: medication, safeguarding investigations, sensitive documents hidden from coordinators.
- Separation of duties where a review is used (an author cannot approve their own work).
- Carer accounts limited to their own visits.
- Portal access (`/hr`, `/rota`, `/platform-admin`, `/admin`) by typing addresses directly.
- Platform staff access to tenant data only through an approved, unexpired support access grant.

### 4.4 Input handling
- Cross-site scripting in every free-text field, uploaded file name and rendered document, including text
  extracted from uploaded PDFs and Word files and AI output.
- SQL injection, especially the raw SQL used for search and reports.
- Server-side request forgery through source-monitoring URLs, the malware-scanner URL and storage settings.
- Cross-site request forgery on server actions and route handlers.
- CSV and spreadsheet formula injection in exports.
- Open redirects (`?next=`-style parameters, flash messages).

### 4.5 File handling
- Upload limits, content-type detection, path traversal, polyglot files, archive bombs.
- Download routes: direct object references, content sniffing, cache headers.
- Stored files reachable without a session.

### 4.6 API and background routes
- Every route under `/api`, including `/api/health`, `/api/cron/*`, `/api/jobs/kick` and `/api/hr/*`: authentication,
  secrets (`CRON_SECRET`), information disclosure, abuse to exhaust the database.
- HTTP security headers and Content Security Policy.

### 4.7 AI features (if enabled on staging)
- Prompt injection through uploaded documents and call notes: attempts to make the assistant reveal other records,
  call tools outside the user's permissions, or write records without confirmation.

### 4.8 Configuration
- Secrets in client bundles, source maps, error pages and logs.
- Dependency vulnerabilities (the repository runs `npm audit` in CI).
- Demo accounts and demo sign-in hints absent in a production-style configuration.

## 5. Out of scope

- The live site and any real personal data.
- Denial-of-service and load testing beyond light rate-limit checks.
- Social engineering and phishing of staff; physical security.
- The infrastructure of Vercel, the database provider, GitHub and Microsoft Azure.
- Staff laptops and phones (a separate device review is recommended).

## 6. Rules of engagement

- Testing window and source IP addresses agreed in writing **[OWNER]**.
- Testers stop and telephone the named contact at once if they find real personal data, a way into the live
  environment, or a critical flaw being actively exploited.
- No data is taken off the staging environment except as evidence in the report, minimised and redacted.
- All test accounts and data are removed, and staging is rebuilt, after the retest.

| Contact | Name | Phone |
| --- | --- | --- |
| Owner and authoriser | **[OWNER]** | |
| Technical contact | **[OWNER]** | |
| Supplier lead tester | | |

## 7. Deliverables

1. Executive summary in plain English with an overall risk statement.
2. Each finding with a CVSS score, affected role and route, steps to reproduce, evidence and a recommended fix.
3. A specific statement on tenant isolation: tested how, and with what result.
4. A mapping of findings to the OWASP Top 10 and OWASP ASVS level 2.
5. Retest report after fixes.

## 8. After the test

- Critical and high findings are fixed before further real records are added; each fix gets an automated test.
- The summary and retest result are filed as DSPT evidence (standard 9) and referenced in the DPIA.
- Repeat yearly and after major changes (new hosting, row-level security, two-factor sign-in, a family or carer app).
