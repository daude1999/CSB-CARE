# Security and reliability audit (PR 3, brief section 4)

Written 5 November 2026 from the code on `main` (`92d6070`) and `docs/SECURITY.md`. "Verified" means a test in the repository covers it and passed in the baseline run that day. Nothing here is a claim of certification.

## Findings

| Area | State | Evidence | Gap / risk | Proposed work | Needs owner approval |
|---|---|---|---|---|---|
| Organisation isolation | Verified (application layer) | Cross-tenant tests across policies, care, coordinator, chat, references | One layer only: a missed `organisationId` in a new query would leak | Keep tenancy tests per module; RLS below | — |
| Branch and area limits | Verified | `src/server/rota/scope.ts`, scope tests | — | — | — |
| Roles | Verified | `src/server/auth/rbac.ts`, role tests | — | — | — |
| Sessions | Implemented | `src/server/auth/session.ts`: random token, SHA-256 stored, 12-hour sliding expiry, HttpOnly/SameSite/Secure cookie | No absolute lifetime; a session kept active never ends | Add an absolute 7-day cap | No (small change) |
| Sign-in rate limit | Implemented | 5 failures per email per 15 minutes | No limit per IP address | Add an IP limit using the shared `RateLimitWindow` table | No |
| MFA / SSO | Missing | `docs/SECURITY.md` known gaps | For health and care data, password-only sign-in is the biggest remaining gap | TOTP for managers and admins first (needs a small library and a schema change), or Entra ID SSO if the company uses Microsoft 365 | **Yes**: which option, plus the new dependency |
| Restricted health information | Verified | Coordinator restricted sections, medication permission, sensitive documents hidden from coordinators | — | — | — |
| Document downloads | Verified | Permission check and audit on every opening (`/api/care-coordinator/documents/[id]`, evidence routes) | — | — | — |
| Upload validation | Implemented | Size limits; type from content; private storage | Malware scanning only when `MALWARE_SCAN_URL` is set; otherwise files are labelled "Not virus-checked" | Choose a scanner (Defender for Storage on Azure) | **Yes** (cost) |
| Invitations and resets | Implemented | One-time links, hashed, 7 days / 24 hours | Links are handed over by an admin, not emailed | Email once an email provider is approved | Yes (provider) |
| Logging redaction | Implemented | `src/lib/logger.ts` redacts passwords, tokens, cookies, keys | Not tested against care-record fields | Add a test that a service-user name or NHS number is never logged by the error handler | No |
| Encryption and keys | Partial | References encrypted with `CSB_REFERENCE_SECRET`; key safe codes encrypted | Key is not yet confirmed on Vercel; no key rotation procedure | Owner sets the key; document rotation in the runbook (PR 4) | Owner action |
| Audit integrity | Verified | Database triggers make audit rows immutable | — | — | — |
| Export permissions | Verified | `report.export` and audited exports | — | — | — |
| Retention and deletion | Missing | No retention schedule or deletion workflow | Records are kept indefinitely | Needs a retention policy first (governance checklist), then a reviewed deletion/anonymisation job | **Yes** (policy) |
| Privileged actions server-side | Verified | Every action re-checks permissions; QA walk of 475 screens | — | — | — |
| Row-level security | Not enabled (evaluated) | `docs/SECURITY.md` | Second layer would catch a missed tenant filter | Pilot on 3 high-risk tables (`ServiceUser`, `CareIntakeDocument`, `ServiceUserExternalReference`) with a Prisma extension and a full tenancy suite | Yes (scope and effort) |
| Background jobs on Vercel | Partial | `inline.ts`, `/api/jobs/kick`, daily cron | Late and missed call detection depends on someone loading a page | Dedicated worker (PR 4) plus a "worker last ran" warning already shown on the Monitor | Yes (Azure) |
| Live demo AI setting | Unverified | `docs/DEPLOYMENT.md` documents `AI_PROVIDER=simulated` | Brief requires `AI_PROVIDER=none` | Owner sets `AI_PROVIDER=none` on Vercel | Owner action |

## Proposed order for PR 3 code changes (no new dependency)
1. Absolute session lifetime and per-IP sign-in limit, with tests.
2. Logging redaction test for care-record fields.
3. Remaining items wait for the owner's choices above.
