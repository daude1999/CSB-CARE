# Service user search fix (5 Nov 2026)

## Cause
On the live site every search in the top bar (on Rostering pages) and in Rota → Service Users returned HTTP 500, even
plain names. Both searches called `searchReferenceHits()` for every entry, and that hashes the entry with
`CSB_REFERENCE_SECRET`. In production the code throws when the secret is missing, which took down the whole page.
The unfiltered Service Users list and the Reference Numbers tab still loaded, so the reference migrations
(`20261104030000_client_reference_registry`, `20261104230000_reference_numbers_tab`) are applied. The fix for live is to
set `CSB_REFERENCE_SECRET` on Vercel (Production) and redeploy. Live could never have stored an encrypted reference
without the secret, so setting it for the first time cannot make existing data unreadable. Never change it afterwards.

## What changed
- `src/server/care/service-user-search.ts`: one search definition for both boxes. Every word of a name must match the
  first name, surname or preferred name ("Fatuma Ali", "Ali Fatuma", "Fat Al"); CSB and SU numbers accept short
  spellings ("csb 159", "SU159"); postcodes work with or without the space; NHS numbers only for restricted access.
- The encrypted register is only queried when the entry contains a digit. If it fails (missing key or an unreadable
  table) the rest of the search still answers and an amber warning says reference numbers were not searched. The
  failure is logged without the searched value. Failures of the main query still show the error page.
- Service Users directory: an "All statuses" option, and a notice when the status or area filter hides matches.
- Top bar results page: loading state, exact-number hint on empty results, a link to policy search.
- The header search design (PR #82) is unchanged.

## Tests
`tests/unit/service-user-search.test.ts`, `tests/integration/service-user-search.test.ts`,
`tests/e2e/service-user-search.spec.ts`.
