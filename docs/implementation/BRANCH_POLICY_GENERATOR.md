# Branch-specific Policy Generator (4 Nov 2026, draft PR)

Owner's brief "CSB CARE – Branch-specific AI Policy Generator". Built inside Policy & Compliance; nothing existing was
replaced. Draft PR only: no merge or deploy without the owner's approval.

## What it does

| Area | Where | Summary |
| --- | --- | --- |
| Branch & Local Authority Configuration | Policy Library → Branch Configuration (`/policies/branches`), also listed in Settings | Per branch: reference, address, postcode, local authority, region, services, Safeguarding Adults Board, Children Partnership, regional guidance, local procedure, referral page, contacts, out-of-hours contacts, ICB, commissioning, extra sources, responsible manager, next review. Managers verify the configuration and, separately, confirm contacts. Material changes clear verification. Local authorities can be added without code. Optimistic concurrency on save. Audit history on the page. |
| Local & Safeguarding References | Regulatory Monitoring → Local & Safeguarding References (`/compliance/regulatory/references`) | Extends the existing `RegulatorySource` table (no duplicate). National / regional / local level, region and local authority scope, publisher, topics, version, dates, lifecycle (current / superseded). Each organisation records its own check (`OrgSourceReview`): verified needs a note and a future review date. Filters by level, area, status, topic, text. "Check now" queues a monitored check (at most once an hour). Organisations can add official https sources, which start unverified and reviewed by hand. |
| Policy Generator | Policy Library → Policy Generator (`/policies/generator`) | Select policy (own policy, CSB template or new) → Select branches and approach → Review requirements (every source labelled S1, S2…, per branch, with gaps) → Generate draft → normal Review & approve → Publish. |
| Approaches | | A: one company policy with an appendix per branch (`SHARED_WITH_APPENDICES`). B: a separate policy per branch linked to the company policy (`BRANCH_SPECIFIC`, `parentPolicyId`). Or national only. |
| Gaps and publish safeguards | On the draft (`/revisions/:id`) | Gaps (missing procedure, contacts, unverified or overdue sources, failed checks, unverified configuration) with resolve and re-check. A draft with "[REVIEW REQUIRED" text cannot be submitted or published. Publishing a generated draft needs the five confirmations from the brief and no open critical gap. The author still cannot approve their own draft. |
| Staff by branch | On publish | A `WORKS_IN_BRANCH` reading rule per branch: staff employed in, assigned to an area of, or recently rostered for visits in the branch. Multi-branch staff are asked once. Nothing is auto-acknowledged; earlier acknowledgements stay. |
| Monitoring | `src/server/policy-geo/monitoring.ts` | When a linked source changes: the organisation's "verified" check moves to "needs review", affected policies are flagged, a review task is created in Actions and the owner is notified, with links to the change (old vs new text). No automatic rewrite. |
| Branch Coverage | Policy Library → Branch Coverage (`/policies/coverage`) | Policy × branch matrix: company policy, appendix or branch policy, and approved / needs review / draft / awaiting approval / missing local arrangements / not started, with acknowledgements outstanding. Filters: branch, region, local authority, category, status, owner, text. |
| Cross-boundary safeguarding | Branch Coverage → Cross-boundary safeguarding (`/policies/cross-boundary`) | Records where the person lives, receives care, who funds it and where incidents happened; flags differences from the branch's area; shows each area's recorded procedures; a manager records which authority's procedures apply, with reasons (append-only, geography snapshot kept). The platform never decides the lead authority. |

## AI

The generator works without AI (source-guided). With a real provider switched on, AI may only reword the generated
sections; its output is rejected if it contains phone numbers, e-mail or web addresses, cites a source not in the list,
quotes text not in the stored source, or edits other sections. The simulated provider is never used for generation.
AI is not switched on for the live demo (`AI_PROVIDER` unset), so live drafts are source-guided.

## Sources (starter set)

Every starter source is recorded as **not yet verified**: this build environment could not open the official sites,
so titles and addresses were taken from search results only. No phone numbers or contact details were recorded.
Someone must open each page and record the check before relying on it.

- National: Care and support statutory guidance (DHSC, GOV.UK); CQC guidance for providers.
- London: London Multi-Agency Adult Safeguarding Policy and Procedures (saeb.org.uk); Tower Hamlets report a concern
  page, referral form, Safeguarding Adults Board annual report 2022-23.
- North West / Merseyside: North West Safeguarding Adults Policy; North West People in Positions of Trust policy;
  Liverpool Safeguarding Adults Board local policies; Liverpool City Council safeguarding adults procedure.
- South East / Hampshire and Isle of Wight: 4LSAB multi-agency policy and guidance; 4LSAB MARM one-minute guide;
  Portsmouth report a concern page; Portsmouth Safeguarding Adults Board; Portsmouth escalation protocol guide.

Regional sources apply only to their region (4LSAB only to Hampshire, Isle of Wight, Portsmouth and Southampton), so
Liverpool never receives Pan-London procedures and Tower Hamlets never receives North West ones.

## Data model (additive migration `20261104150000_branch_policy_generator`)

New: `LocalAuthority`, `BranchPolicyProfile`, `OrgSourceReview`, `PolicyBranchScope`, `PolicySourceLink`,
`PolicyGenerationRun`, `PolicySourceGap`, `SafeguardingAuthorityDecision`; enums `GeoLevel`, `PolicyScopeMode`.
Added columns on `RegulatorySource`, `Policy`, `ServiceUser`, `Incident`, `PolicyPublication`; new enum values
`WORKS_IN_BRANCH` and `GENERATED`. No drops or renames. Reference data is added lazily and idempotently
(`ensureGeoReference`), so the live database does not need a reseed.

## Limitations

- No source has been verified against the live official page; all start "not yet verified".
- No local contact numbers are recorded anywhere. Each branch's contacts must be entered from the official page.
- A Pan-Merseyside adult safeguarding procedures page and a Tower Hamlets SAB procedures page were not found; Liverpool
  and Tower Hamlets use the council and SAB pages listed above until someone confirms the right documents.
- The North West People in Positions of Trust policy is recorded against the Liverpool City Council procedure page
  that names it, until the policy's own address is confirmed.
- Automatic checking of council sites runs weekly and respects robots.txt; PDFs and Word documents are reviewed by hand.
- "Works in branch" uses employing branch, area assignments and visits in the last 90 / next 28 days.
