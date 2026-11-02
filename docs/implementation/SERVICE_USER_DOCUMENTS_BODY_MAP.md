# Service user documents and Digital Body Map (2 Nov 2026)

Parts 4, 5 and 6 of the owner's consolidated requirements (2 Nov 2026), plus their audit, security and incident-linking items (Parts 9 and 10). Built alongside the service user records work (care plans, risks, incidents, visit notes, compliance overview), which owns the profile's tab grouping.

## Where it lives

- Profile tabs `documents` (Council Documents and Other Documents, `?section=council|other`) and `bodymap` on `/rota/service-users/[id]`. No new menu section.
- Domain: `src/server/care/su-documents.ts`, `src/server/care/body-map.ts`.
- Screens: `src/components/su-documents.tsx`, `src/components/body-map.tsx`, `src/components/body-map-figure.tsx` (client: outline and marker picker), `src/components/private-file-input.tsx`.
- Actions: `src/app/su-record-actions.ts`. Files: `GET /api/service-users/documents/[id]` (`?mode=preview`, `?v=N`) and `GET /api/service-users/body-map/photos/[id]`.
- Migration `20261102233000_service_user_documents_body_map` (additive): `StoredObject`, `ServiceUserDocument`, `ServiceUserDocumentVersion`, `BodyMapObservation`, `BodyMapReview`, `BodyMapPhoto`.

## Storage

Uploads on Vercel used to go to `/tmp`, which is wiped. `src/server/storage` now has a `database` provider (bytes in the `StoredObject` table, never exposed by URL) used automatically on Vercel, and an optional `supabase` provider (`STORAGE_PROVIDER=supabase`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, private bucket). Nothing needs setting for the live demo. Files are limited to 4 MB because Vercel refuses request bodies over 4.5 MB.

## Rules

- Replacing a document adds a version; versions are never edited (database trigger). Archiving moves a document to "Historical documents"; nothing is deleted.
- Sensitive categories (identification, medical letters, GP correspondence, discharge, financial, hospital discharge) and documents marked "Restrict to managers" open only with `serviceUser.sensitive` (registered manager, administrators). Others see the row as "Restricted document".
- Required council documents: Council Support Plan and Purchase Order (owner's decision). Nothing in Other Documents is required, so nothing there is counted as missing.
- A new or replaced Council Support Plan sends a bell prompt to managers to review the care plan; the care plan is never changed.
- Body map observations are kept exactly as recorded (database trigger); follow-ups and photos are appended. Recording alerts managers in the app. Only `incident.manage` decides on an incident: link one about the same person (database-checked), report a new one through the normal incident service, or record that none is needed with a reason.
- Body map recording and photos: office staff and managers (`bodyMap.record`, `bodyMap.photos`). Care workers' app is out of scope.
- Audit actions: `suDocument.uploaded|replaced|updated|archived|restored|previewed|downloaded`, `bodyMap.recorded|followedUp|resolved|photoAdded|photoViewed|incidentLinked|incidentNotRequired`.

## For the compliance overview

`documentCounts(ctx, serviceUserId)` and `bodyMapCounts(ctx, serviceUserId)` return the figures (or null without permission).

## Not built

- Expiry reminders for documents (expired documents show on the profile and in the counts only).
- Virus scanning needs `MALWARE_SCAN_URL`, as for compliance evidence; without it files are stored as NOT_SCANNED after type and content checks.
- Word and TIFF files download rather than preview in the browser.
