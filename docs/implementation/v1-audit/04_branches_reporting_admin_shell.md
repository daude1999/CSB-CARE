# V1 audit — Branches, Reporting & Analytics, Administration, Overview, shell, local setup (29 Oct 2026, read-only)

Requirements: owner's V1 brief §9–11 and spec §3–5, §17–18.

## A. Classification

| Area | State | Evidence |
|---|---|---|
| Branch model | Partial — three parallel concepts | Branch (:106, hrBranchKey), Membership.branchId + MembershipArea, Area.branchId, StaffMember.hrBranchKey/branchId, ServiceUser.branchId/areaId, Policy.branchId, Audit.branchId; Visit has areaId only |
| HR Hub branches | Built, separate | src/hr/lib/domain.ts:2-12; hrBranchKey set only by seed/care.ts:20-27 |
| Rota area scope | Built (area, not branch) | rota/scope.ts:11-45; records with areaId null visible to everyone |
| ctx.branchId | Dead field | set in session.ts, never read |
| Branch in finance | Missing | timesheets.ts, runs.ts org-wide |
| Branch in rota reports | Partial (area) | rota/reports.ts:115-118 |
| Branch in compliance reports/exports | Missing | reports/tables.ts; /api/reports only checks report.view |
| Branch in policies/audits/search | Label only | — |
| UI-only restrictions (bypass) | Leak | rota/staff/page.tsx:32 `?area=` replaces scope; summary.ts:15 alert count org-wide; audits branch select unrestricted |
| Reporting & Analytics | Partial, policy-only | reports/page.tsx; no KPI definitions, filters, drill-through; "report exports" tile is a constant 4 |
| Overview | Built, real figures | not a §4.2 dashboard; admin tile promises screens that don't exist |
| Administration & Settings | Partial | settings (business, approvals, read-only branches, AI, latest-40 audit rows), /admin/areas, /admin/workforce, /modules. Missing: user invite/roles/branch assignment/deactivate/password reset, branch CRUD, audit viewer |
| RBAC | Partial | roles ORG_ADMIN, POLICY_*, COMPLIANCE_LEAD, STAFF, CARE_MANAGER, CARE_COORDINATOR, CARER, FINANCE_OFFICER; no branch scope in Ctx; ROLE_NAMES lacks care roles |
| Shell / design | Partial | focus ring, mobile dialog menu, Flash; no loading.tsx, no template/transition, no reduced-motion, no table component |
| Local setup | Partial | README stale (brookfield logins, rota "Planned"); no one-command start, no Windows notes, no reset script |
| Isolation tests | Partial | tenant tests exist; one area test; no branch/URL-bypass/export-scope tests |

## B. Ordered gap list

1. One branch concept + real branch scope: Branch canonical; Area.branchId; Visit.branchId denormalised at build; MembershipBranch grants; Ctx.branchIds; shared scope helper; enforce in finance, reports, lists, counts, exports, search; HR mapping admin; audit cross-branch scope switches; tests.
2. Scope selector + single-branch dashboard (Session.activeBranchId); branch comparison on Overview.
3. KPI registry (`src/server/reports/kpis.ts`) with definitions shown in UI; Stat drill-through.
4. Reporting portal: delivery / workforce / compliance / finance tabs with branch+date filters, CSV requiring report.export.
5. Administration user management (invite, roles, branches/areas, deactivate, reset) + branch CRUD + audit viewer.
6. Roles: BRANCH_MANAGER (or CARE_MANAGER + branch grants); ROLE_NAMES.
7. Shell polish: loading.tsx, template fade with reduced-motion, sidebar transitions, DataTable, inline field errors, Help link.
8. Local setup: README fixes, Windows section, dev:all, local-reset script, docs/LOCAL_SETUP.md.
9. Modules catalogue: unlock built modules.

## C. Broken, fake or stale

staff page `?area=` bypass; unscoped alert count; dead Ctx.branchId; modules shown Locked while built; "Request access" notifies nobody; Overview admin tile; constant "4 report exports"; README logins; export permission inconsistency; fixed 40-row audit trail; no loading states.
