# Monitored sources

The registry lives in the `RegulatorySource` table (seeded from `prisma/seed-data/sources.ts`) and is managed at **Source Monitoring** (`/admin/sources`, platform admins). Each source records its method, coverage, schedule, freshness window, licence notes, last attempt, last success, last change and consecutive failures.

## Honesty rules built into the product

- A source counts as **monitored** only if it was successfully checked within its freshness window. Otherwise it is shown as stale, never checked or failing, and the overview reports it.
- `MANUAL_REVIEW_ONLY` sources are listed so reviewers know to check them, but they are never described as automatically monitored.
- The first successful check of a document captures a **baseline** and raises no change. Changes are only raised when stored content differs from the previous stored version. Metadata-only changes (for example a new timestamp) are logged but do not raise a change.
- Raw responses and normalised text are stored unchanged (`SourceVersion` is immutable at the database level), so every diff and citation can be checked against what was actually retrieved.
- After 3 consecutive failures platform admins are alerted once per failure streak.
- The admin pages warn when the background worker has not reported for 30 minutes.

## Verification status

The adapters were built against the documented formats of each service and tested with recorded fixtures (`tests/fixtures`). **The build environment could not reach gov.uk, legislation.gov.uk or cqc.org.uk** (outbound network blocked), so no live check has been run yet. Before relying on monitoring:

1. Deploy with network access and run `npm run monitor:once -- <source-key>` for each automated source.
2. Check the run on `/admin/sources/<id>`: documents discovered, sections extracted and no errors.
3. For the CQC HTML source, confirm the configured URLs and the content selector still match the live pages (they are marked unverified in the registry notes).

## Sources

| Key | Method | Coverage | What is checked |
| --- | --- | --- | --- |
| `govuk-adult-social-care-guidance` | GOV.UK Content API (`/api/content/...`) | Automated | The adult social care guidance collection and the documents it links to; full body text by section, public and updated timestamps, change notes |
| `govuk-dhsc-publications` | GOV.UK Search API (`/api/search.json`) | Partial | Recent DHSC publications filtered to social care; titles, descriptions and dates (new items are flagged for review) |
| `legislation-regulated-activities-2014` | legislation.gov.uk CLML XML | Automated | Every SI 2014/2936 regulation in the requirements register, including unapplied amendment effects. The provision list is generated from the requirements register |
| `legislation-mca-care-act` | legislation.gov.uk CLML XML | Partial | The Mental Capacity Act 2005 and Care Act 2014 provisions linked from the library |
| `legislation-other` | legislation.gov.uk CLML XML | Partial | Other Acts and regulations the library cites: CQC registration regulations, HSWA, MHSWR, LOLER, COSHH, RIDDOR, fire safety order, UK GDPR, Equality Act, Mental Health Act, Domestic Abuse Act, Working Time Regulations and others |
| `govuk-statutory-guidance` | GOV.UK Content API | Automated | Statutory codes and national guidance on GOV.UK: Care Act statutory guidance, MCA Code of Practice, DoLS guidance, IPC code of practice, Mental Health Act Code, UKHSA guidance, the Adverse Weather and Health Plan and others |
| `cqc-regulation-guidance` | HTML page (robots.txt respected) | Partial | CQC guidance on the regulations, notifications, duty of candour, Right support right care right culture, surveillance and directors' fitness. URLs and selectors need checking against the live site |
| `nice`, `skills-for-care`, `scie`, `nhs-england`, `hse`, `ico`, `fsa`, `nmc`, `restraint-reduction-network`, `cqc-home` | Manual | Manual review only | Listed for reviewers; not fetched. Each guideline the library cites is in the requirements register (`GDN-*`) so reviewers can see which documents depend on it |
| `demo-simulated-guidance` | Recorded fixture | Demo only | Feeds the labelled SIMULATED demo change. Not real guidance; absent when `SEED_DEMO=false` |

## Where the library's content comes from

The starter library draws on the same public sources as any provider policy library: the Regulated Activities Regulations 2014 and CQC registration regulations, CQC's quality statements and guidance, the Care Act 2014 and its statutory guidance, the Mental Capacity Act 2005 and its Code of Practice, the Mental Health Act, health and safety law with HSE guidance, UK GDPR with ICO guidance, UKHSA and DHSC guidance, NICE guidelines and quality standards, Skills for Care, SCIE, NHS England and the NMC. Every document has a "Legislation, guidance and CQC quality statements" section listing what it relies on, and each reference is a requirement-register entry linked to that document, so a detected change flags the documents that cite it. The wording of every document is original; nothing is copied from another provider's library.

## Polite fetching

- Identifies itself with `SOURCE_USER_AGENT` (set a contact address in production).
- Per-host delay (`SOURCE_MIN_INTERVAL_MS`, default 1.5 s), timeouts, response size limits.
- Retries only on 429 and 5xx, honouring `Retry-After`, with backoff.
- HTML sources check robots.txt before each run. Nothing behind sign-in or paywalls is accessed.
- GOV.UK and legislation.gov.uk content is reused under the Open Government Licence v3.0; licence notes are recorded per source.

## Adding a source

Add an entry to `prisma/seed-data/sources.ts` (or insert a row) with a `monitoringMethod` and `config`. Set `coverage` honestly. To support a new format, implement `SourceAdapter` in `src/server/sources/adapters` and register it in `adapters/index.ts`. Link requirements to source sections through `RegulatoryRequirement.sourceSectionRef`, so changes to that section flag the linked policies directly.
