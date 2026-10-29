# OnePlan research

Read-only discovery of the OnePlan (OneTouch Essentials) care platform that Care Solution Bureau CIC uses today. It was carried out on 29 October 2026 to specify equivalent functions in CSB, built as CSB's own original software. **No CSB application code was changed for this work.**

| File | Contents |
|---|---|
| [01_FULL_PLATFORM_INVENTORY.md](01_FULL_PLATFORM_INVENTORY.md) | Every page found, the navigation tree, domain concepts, statuses, and everything not inspected |
| [02_DASHBOARD_DESIGN_REFERENCE.md](02_DASHBOARD_DESIGN_REFERENCE.md) | OnePlan Home dashboard and the recommended CSB Rota "Today" page |
| [03_HR_FEATURE_SPECIFICATION.md](03_HR_FEATURE_SPECIFICATION.md) | OnePlan staff functions vs the CSB HR Hub, and the shared staff record |
| [04_ROTA_AND_VISITS_SPECIFICATION.md](04_ROTA_AND_VISITS_SPECIFICATION.md) | How OnePlan scheduling works, and the full CSB Rota & Visits specification |
| [05_SERVICE_USERS_SPECIFICATION.md](05_SERVICE_USERS_SPECIFICATION.md) | Service-user fields seen, and the CSB Service Users specification |
| [06_FINANCE_AND_REPORTING_SPECIFICATION.md](06_FINANCE_AND_REPORTING_SPECIFICATION.md) | Tariffs, funders, invoice and wage settings, the report catalogue, and CSB finance and reporting |
| [07_OTHER_MODULES.md](07_OTHER_MODULES.md) | Settings, lists, support, top bar, and CSB administration additions |
| [08_CSB_FEATURE_GAP_ANALYSIS.md](08_CSB_FEATURE_GAP_ANALYSIS.md) | Feature-by-feature mapping into CSB-CARE |
| [09_COMPLETE_IMPLEMENTATION_ROADMAP.md](09_COMPLETE_IMPLEMENTATION_ROADMAP.md) | Stages, dependencies, first demo slice |
| [10_TEST_AND_ACCEPTANCE_MATRIX.md](10_TEST_AND_ACCEPTANCE_MATRIX.md) | Automated tests and acceptance criteria |

## Method and limits

- The inspection used the owner's own logged-in browser session. Pages, menus and forms were looked at only. Nothing was saved, assigned, clocked, exported, sent or marked read.
- Screens that show individual service users, staff or pay were not opened. Those parts are marked **unverified** or **not inspected** and should be checked with demo records before they are built.
- **[O]** marks something observed on screen and **[I]** something inferred. Inferred items are never presented as verified.
- No personal data is recorded. OnePlan's code, branding, assets and wording are not reused. Only the workflow structure is described.

## Screenshots

21 screenshots with personal details blacked out are referenced by file name (`01-home-dashboard.png` … `21-settings-service-list.png`). This repository is public, so they are kept off it, on the owner's laptop, until the owner decides where they should live.

## Open decisions for the owner

1. Move HR Hub staff into relational tables so HR and Rota share one staff record (03 §4.1).
2. Whether expired DBS / right to work blocks allocation (recommended) or only warns.
3. Carer login: own account (recommended) or PIN.
4. Which stage to build first (09, "first build slice").
