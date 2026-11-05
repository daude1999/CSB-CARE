# No-API Council Support Plan Reader — Stage 1

## Purpose
Support Care Solution Bureau's existing authenticated AI Care Coordinator workflow **without a paid AI API**. The reader runs locally in the application's server runtime and continues to use existing:
- upload and document category storage,
- source-page traceability and coordinator review,
- manager section approvals,
- ServiceUser + external references,
- nine care plan sections,
- draft risks and packages,
- recurring visit templates and approved rota generation.

**No new chat or dashboard module.** The existing floating UI and ordinary intake workflow remain unchanged.

## Deployment setting
Use `AI_PROVIDER=none` in the application environment for this no-API phase. Do not configure `ANTHROPIC_API_KEY`, OpenAI keys or paid inference endpoints. The reader already falls back automatically when no provider is configured. The conversational assistant cannot generate unrestricted LLM answers in this mode: its existing actions must guide users to the structured intake workflow.

## Implemented Stage 1
The existing `basicRead` recognises standard `Field: Value` lines, contacts, Frameworki references, care needs, risk statements and timetable rows. The added `augmentCouncilSupportPlan` handles a second documented council layout:
- standalone care-plan headings with a subsequent paragraph,
- visit blocks with separately labelled start, duration, frequency, staffing, tasks and provider,
- timetable continuation across pages (each complete visit remains on its original source page),
- commissioned vs family/informal visits,
- strict no-inference rule for absent schedule fields,
- nine-section source coverage report,
- mismatch warning when parsed weekly council minutes differ from the document's commissioned total.

Partial table rows, source scans and unsupported layouts remain **review items**. No content is fabricated to fill a section. Historical discharge instructions must not be entered as active medicines or risks.

## Synthetic acceptance scenario
A fully fictional four-page support-plan sample with a mixed schedule format is tested at `tests/unit/care-coordinator-no-api-support-plan.test.ts`:
- four commissioned daily visits at 09:00 for 60 min, 12:00 for 45 min, 16:30 for 30 min, 20:00 for 60 min,
- one informal weekly family shopping visit, excluded from commissioned totals,
- council weekly minutes = 1,365 = 22 hours 45 minutes,
- all nine care-plan headings appear in the fixture, without generated clinical content,
- original council reference values and source pages can be reviewed in the existing reference pipeline,
- missing staffing and missing plan sections raise explicit warnings.

There is also an existing **database-level** integration test at `tests/integration/care-coordinator.test.ts` which uses synthetic documents to verify the existing full workflow (upload, read, review, manager approval, save, care plan, risk drafts, templates, and rota).

## Important limitations
- Stage 1 is rules-based and is **not Claude-level comprehension**. Different council table formats require additional tested adapters.
- Scanned image-only PDFs still require a secure OCR or manual entry option; no OCR has been silently added.
- Detailed, person-centred clinical prose cannot be invented. Only source-backed sections are proposed and remaining sections require the coordinator's review.
- A care package ending 30 December 2026 is test/scenario data and must not replace a council's actual end date without authorisation.
- Review all visit/funding totals. A numerical match alone does not prove that commissioning is authorised.
- No service-user record is created automatically from a file upload; existing authenticated approvals must complete first.
- Unit tests and CI are not evidence of production deployment or clinical readiness.
