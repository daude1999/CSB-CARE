# HR & Workforce inside the platform shell

Owner request (29 Oct 2026): "the hr platform needs some work", focus chosen: look and feel. The owner approved the
mock-up ("Make the change") that puts the HR Hub's screens in the same frame as every other module.

## What the audit found (before)

Screens checked at 1440, 834 and 390 wide on the demo data: HR Dashboard, People, an employee record, My Tasks,
Compliance, Documents, Training, Branches, Alerts, Settings, Imports.

| Finding | Where |
|---|---|
| HR had its own frame: its own sidebar ("CSB HR Hub", other modules missing), a red top bar, two search boxes and a dropdown to change module | Every HR screen |
| The person was shown as "Organisation Admin" in HR and "Registered manager" everywhere else | HR sidebar and account menu |
| Column headings overlapped ("Training requirement" over "Status") and "Safeguarding" broke mid-word | Training |
| The register was cut off on the right (173px hidden behind a sideways scroll) at 1440 | Compliance |
| The top-bar search was squashed to "Sear" next to the branch picker | Phone and tablet |
| Primary buttons were cyan on older screens and dark on newer ones | Documents > Upload document, Settings > Save policies |
| Technical wording shown to managers ("Supabase configuration required", "Malware scanning", "Invitations require Supabase Auth") | Settings |

## What changed

- **Frame.** HR uses the platform's sidebar, top bar and module title bar. The sidebar lists the HR Hub's screens in
  its original order (HR Dashboard; People, My Tasks; Compliance, Documents, Training; Holidays & Sickness,
  Availability; Branches, Alerts, Settings) from `src/components/hr-nav.tsx`. Each screen opens with the red title
  bar (Back goes to the HR Dashboard, or to People from a record) and a strip with the branch picker
  (`src/hr/components/hub-header.tsx`). The HR Hub's own sidebar, top bar, portal menu, account menu (with its light/
  dark switch) and footer were removed. Every HR screen below the title bar is unchanged.
- **Search.** On HR pages the top-bar search says "Search people or documents…" and opens the HR Hub's own search
  (also Ctrl+K / ⌘K and "/"); on phones it is an icon. Elsewhere it still searches policies
  (`src/components/shell-search.tsx`).
- **Addresses.** `/hr` now redirects to `/hr/dashboard` (keeping `?branch=`), so the menu can mark it.
- **Fixes.** Training sizes its own columns; the Compliance register fits at 1440 (narrower screens still scroll);
  one dark primary button style; Settings in plain words ("Before going live": sign-in, virus checking, emails,
  automatic reminders, OneDrive import), with the same facts as before; the platform's page header strip wraps its
  controls under the text on phones (`src/components/ui.tsx`, all modules).

## How the two style sheets share a page

The HR Hub is styled by Tailwind 4 (`public/hr/hr-hub.css`), the platform by Tailwind 3. Both are now on HR pages.

1. `scripts/build-hr-css.mjs` post-processes the compiled HR sheet (`scopeToHub`). Every rule outside Tailwind's own
   layers is confined to the HR Hub's root element `.cs`:
   - design tokens move from `:root` to `.cs`, so the platform's `--font-sans`, `--radius-*` and `--focus` are never replaced;
   - the automatic dark scheme (`prefers-color-scheme: dark`) is dropped, because the platform has none;
   - `html`/`body` rules apply to `.cs`, element rules to elements inside it through `:where(.cs)`, which adds no
     specificity, so the HR screens' own cascade is unchanged;
   - `main` becomes `.h-content`, because the platform's `<main>` is the page's one main landmark.
2. The platform's element rules (`h1`, `h2`, `h3`, `a`) and the class names both sides define (`panel`, `card`,
   `label`, `muted`, `skeleton`, `rows`) stop at `.cs` (`:where(:not(.cs *))` in `src/app/globals.css`, again no
   specificity change).
3. Links into or out of `/hr` are full page loads: a capture-phase click handler in
   `src/components/navigation-progress.tsx` keeps Next.js from opening them in place, so the HR sheet never stays
   on another page. Links between HR screens stay instant.
4. `src/hr/styles/hr-embed.css` holds the HR-side fixes listed above.

`tests/unit/hr-shell.test.ts` fails if any HR rule escapes `.cs` or the platform's element rules lose their guard.

## Checks

- Screenshots at 1440, 834 and 390 of every HR screen before and after, compared side by side with the mock-up
  the owner approved and with the Rota Dashboard (`/mnt/project-files/csb-hr-look/` in the project).
- The title bar's font on HR pages is checked against Rostering's in `tests/e2e/navigation.spec.ts`.

## Known limitations

- HR pages have two level-one headings: the title bar and the HR screen's own heading (for example "People"), as
  the screens were kept as built.
- The old HR sidebar showed counts next to People, My tasks, Compliance and Alerts; the platform menu has none.
  The same numbers are on the HR Dashboard and each screen.
- The HR Hub's dark mode is gone, along with its switch, because the platform around it is light only.
- The Compliance register still scrolls sideways below about 1440 wide.
- Imports is reached from People > Import CSV, as before; it is not in the menu.
