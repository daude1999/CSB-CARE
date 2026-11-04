# Set up from support plan (4 November 2026)

**Rota → Service Users → Set up from support plan** (`/rota/service-users/import`)

Office staff upload a council support plan (and up to three other letters), check what CSB has read from it, correct anything wrong, and confirm. One transaction then creates the person, their contacts, the care package, one repeating visit template per timetable row and the document records, so **Build Rota** can schedule the visits straight away.

## Why

Setting a new person up by hand takes seven screens. The council support plan already holds everything the rota needs. The owner asked on 4 November for the support plan to be imported with the timetable driving the rota build.

## The three steps

1. **Upload.** PDF only, up to 4 MB each, at most 4 files. The support plan goes first. The other files are filed as documents and are not read. Nothing is stored until step 3.
2. **Check and correct.** With `AI_PROVIDER=anthropic`, the plan is sent to the model and the answer must fit `SupportPlanExtractionSchema` (`src/server/ai/schemas.ts`): every value carries the page it was read from, timetable rows keep their full task text across continuation pages, durations are converted to minutes, and conflicts between pages come back as flags. The form shows every field for a person to check. With `simulated` or `none`, the form opens empty and staff type the values in. A likely duplicate (same name and date of birth, or same name and postcode) is shown and must be confirmed as a different person.
3. **Confirm.** A summary of the visits with weekly totals and the gap against the commissioned minutes, then **Confirm and set up**.

## What is created

| Record | Source | Notes |
| --- | --- | --- |
| `ServiceUser` | Person section | Status Active from the "Care active from" date (so Build Rota schedules the visits), otherwise Assessment. Council reference kept in care preferences. Date of birth and NHS number are only written by people with `serviceUser.sensitive`, as on the ordinary form. |
| `ServiceUserContact` | Contacts | Key holder and the source page go in the contact's notes. One main contact at most. |
| `CarePackage` | Package | Funder is recorded by name in the requirements; linking a `Funder` stays a finance decision. |
| `VisitTemplate` | One per timetable row | Cycle weeks 1–4, the days ticked, start, minutes, carers, call type (guessed from the time of day and the row, chosen by the office), medication prompt, start and optional end date. Task text and the source page go in the template notes. Carers-service rows are prefixed `[Carers service …]`. |
| `ServiceUserDocument` + version | Documents | Same checks, scanning and storage as `uploadDocument`. A Council Support Plan prompts managers to review the care plan (bell only). |
| Audit log | Everything | Each record is audited as usual with `via: "support-plan-import"`, plus `serviceUser.import.read` and `serviceUser.import.confirmed`. |

**Never created here:** the care plan, risk assessments, medication records, resuscitation decisions. They need a manager's or clinical lead's judgement; the confirm step says so and the person's Care tab is the next stop.

## Rules kept

- Permissions: `serviceUser.edit`, `rota.edit` and `serviceUser.documents` (organisation admins, care managers and coordinators). Restricting a document needs `serviceUser.sensitive`.
- Tenant and branch scope come from the session (`rotaScope`), never from the form. Call types, areas and categories are checked against the organisation.
- Files are checked, virus-scanned and stored before the transaction; if the transaction fails nothing is recorded and no record points at the file.
- The AI reading is a proposal: untrusted document content, page-referenced, and validated against the schema. The model is told not to infer or guess. Nothing is written until a person confirms.
- Real care documents never go into GitHub, tests or screenshots. The tests use a synthetic one-page PDF and a made-up person.

## Code

- Domain: `src/server/care/su-import.ts` (schemas, `draftFromExtraction`, `weeklyTotals`, `guessCallType`, `readSupportPlan`, `findPossibleDuplicates`, `confirmImport`).
- Actions: `src/app/su-import-actions.ts` (`readSupportPlanAction`, `confirmImportAction`, both through `handleData` so the wizard keeps its state on an error).
- Screen: `src/app/(app)/rota/service-users/import/page.tsx`, `src/components/su-import-wizard.tsx`.
- AI: `extractSupportPlan` on `LlmProvider` (optional), implemented in `anthropic.ts` with the PDF as a document block.
- Shared pieces now exported for reuse: `detailsSchema`, `detailData`, `contactSchema`, `contactData`, `checkArea`, `nextServiceUserReference` (service users), `packageSchema`, `createTemplateInTx` (templates), `parseDetails`, `canSeeSensitive`, `promptCarePlanReview` (documents).

## Tests

- `tests/unit/su-import.test.ts`: hours to minutes, weekly totals, call type guess, draft from a reading (pages, funding, temporary rows), bad shapes ignored, draft checks, commissioned gap.
- `tests/integration/su-import.test.ts`: manual path and file checks; the provider's reading with page references and no writes; confirm creates everything in one go with audit and the care plan prompt, and Build Rota previews 30 visits; duplicate stop; rollback when one row is wrong; permissions; Assessment when no care start.
- `tests/e2e/su-import.spec.ts`: the full wizard typed in by a manager at 1672×941 with tablet and phone views of the confirm step, a carer kept out, and the duplicate stop.

## Limits

- Image-only (scanned) PDFs are read by the model when `AI_PROVIDER=anthropic`; without AI they must be typed in.
- Medication lists and hospital letters are filed, not read.
- Updating an existing person's templates from a new plan is not built; the import creates a new person only.
- The live demo needs `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY` on Vercel for the reading step; otherwise the screen works in typed-in mode.
