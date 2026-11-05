# Release readiness

Not ready for real service-user data in production. Nothing here is a claim of CQC, DSPT or clinical certification.

| Gate | State | Owner action needed |
|---|---|---|
| P0 Care Coordinator automated tests (no-API) | Pass on branch | Review screenshots |
| P0 Care Coordinator human acceptance | Not done | Owner walks the flow with the fictional plan |
| `CSB_REFERENCE_SECRET` on Vercel | Not confirmed | Add it in Vercel → Settings → Environment Variables, then redeploy |
| `AI_PROVIDER=none` on the live demo | Not confirmed | Set it (the demo currently documents `simulated`) |
| Dedicated background worker | Missing on Vercel | Approve Azure (PR 4) |
| Automated backups and a tested restore | Missing | PR 4, then owner approves RPO/RTO |
| MFA or SSO | Missing | PR 3 |
| Malware scanner | Not configured | PR 4 |
| DPIA, privacy notice, processor agreements, retention policy | Not started | Owner and legal |
| Clinical safety review (medication stays off) | Not started | Owner and clinical lead |
| Independent penetration test | Not started | Owner |
