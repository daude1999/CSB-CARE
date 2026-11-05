# Service User → Reference Numbers

Built on the existing encrypted reference register (`src/server/care/external-references.ts`, PR #78). There is no second reference store.

## What the tab shows
- **Permanent CSB reference** (`ServiceUser.csbReference`): read-only, unique per organisation, never reused. The older `SU-` reference is shown beside it as the legacy reference.
- **External references** from `ServiceUserExternalReference`: title (e.g. "Tower Hamlets – Frameworki"), number as printed, type, issuer, source document (opened through the normal document permissions) and page, source wording, who added and verified it, and its state: Awaiting verification, Verified, Rejected or Superseded.
- **Care package references** read from `CarePackage.reference`, kept separate and managed on the Care package tab.
- **NHS number**: compared with Personal details (the authoritative field), never copied over it. Hidden from anyone without `serviceUser.sensitive`.
- **Possible references in older records**: Frameworki numbers found in existing free text. Nothing is moved automatically. Staff add one only after choosing what it identifies.
- **Reference history** from the audit log.

## Actions
| Action | Permission | Service |
|---|---|---|
| Add reference | `serviceUser.edit` (NHS also needs `serviceUser.sensitive`) | `addExternalReference` |
| Verify or reject, with reason | `serviceUser.edit` + `serviceUser.sensitive` | `verifyExternalReference` |
| Correct or withdraw | `serviceUser.edit` | `supersedeExternalReference` (original kept as SUPERSEDED, new row unverified) |

Duplicates on the same profile are never created. A person-specific number already on another profile is refused. A framework ID may be shared and is labelled as not proof of identity.

## Frameworki
`src/lib/reference-numbers.ts` recognises "Frameworki 1088676", "LBTH Frameworki 1088676" and "Frameworki: 1088676" in any spacing or case. The value stays a string. The type comes from the surrounding words (client, package or framework). When they do not settle it, the Care Coordinator fact is marked "type to confirm" and cannot be approved until a person edits it. Both readers (basic and AI) use the same server-side detection. A Frameworki number is never proposed as the care package reference.

## Search
Service Users and the rostering search look up the register by exact fingerprint, including labelled entries ("Frameworki 1088676"). NHS rows are only searched for restricted roles. Superseded rows are never matched. Branch and area scoping is unchanged.

## Schema
Additive migration `20261104230000_reference_numbers_tab`: `systemLabel`, `sourceQuoteCipher` (encrypted like the value), `status` (default ACTIVE), and supersede fields. Existing rows are untouched.

## Production
`CSB_REFERENCE_SECRET` must be set on Vercel, otherwise the tab and reference search fail.
