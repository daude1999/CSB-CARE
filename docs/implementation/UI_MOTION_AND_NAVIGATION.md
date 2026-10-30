# UI motion and navigation polish

Owner's brief of 29 Oct 2026 ("Enterprise UI/UX polish & navigation animations"). Frontend only: no schema,
permission, tenancy or business-logic change. Branch `claude/project-thread-i7uu8j`.

## What was wrong before (audit)

| Area | Finding |
| --- | --- |
| Portal switching | Nothing happened between the click and the new page arriving (pages are server-rendered, prefetch is off), so a slow page looked like a dead click. The module colour snapped. |
| Sidebar | The active highlight jumped; a module's pages appeared and disappeared instantly, pushing the other modules down in one frame. On the navy sidebar the focus ring was the theme's 3px outline, which clipped at the scroll edge. |
| Page changes | No entrance; the content swapped in one frame. No loading feedback of any kind (no `loading.tsx`, no progress). |
| Forms | Server Action buttons gave no sign of working; a second press was possible. |
| Dialogs, menus, phone menu | Radix dialogs and `<details>` menus appeared in one frame. The phone menu (native `<dialog>`) had no slide. |
| Errors | "Try again" on the error page only redrew the failed render; for a server error it did nothing. "Back to overview" on the not-found page went to the Compliance Dashboard. |
| HR boundary | Correct (full page loads, own sheet), but leaving HR gave no feedback until the next page painted. |
| Accessibility | No skip link; no reduced-motion handling (there was little motion to reduce). |

## Motion tokens

Declared once as CSS custom properties on `:root` (`src/app/globals.css`) and mirrored in `src/lib/motion.ts`
for the one script-driven animation. A unit test (`tests/unit/navigation.test.ts`) fails if the two drift.

| Token | Value | Used for |
| --- | --- | --- |
| `--motion-fast` | 120ms | Hover, focus, press, menus opening, dialog closing |
| `--motion-base` | 200ms | Page entrance, dialogs opening, tabs, phone menu, active marker |
| `--motion-slow` | 260ms | Module sections opening/folding, module colour blend, portal highlight |
| `--motion-rise` | 5px | Distance a page or popover travels as it fades in |
| `--ease-out` | `cubic-bezier(0.22, 1, 0.36, 1)` | Things arriving |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | State changes (colour, position) |

The HR Hub cannot read the platform sheet, so `public/hr/hr-motion.css` repeats the same three values.

## Transition specifications

| Element | Treatment |
| --- | --- |
| Page entrance (`src/components/main-area.tsx`) | Content area only: opacity 0→1 and 5px rise, 200ms ease-out. Web Animations API on the existing `<main>`, keyed on the path, so nothing is remounted and query-string changes (filters, tabs, selected policy) do not replay it. A full page load uses the same values in CSS (`.page-enter`). |
| Module colour | `--module` is a registered `<color>` property (`@property`), so title bars blend from one module's colour to the next over 260ms. Enabled only after the first paint, so a fresh load starts in the right colour. |
| Progress bar (`src/components/navigation-progress.tsx`) | 2px bar under the top bar in the colour of the module being opened. Appears after 120ms (a fast page never flashes it), creeps to 90%, completes and fades when the page arrives. |
| Slow and failed navigation | After 6s: "Still loading. This page is taking longer than usual." After 20s: "This page is not responding" with **Load it again** (a full load of the same address) and **Dismiss** (back to the page already open). A server error renders the error page inside the shell with a real retry (`router.refresh()` then `reset()`). |
| Placeholder | If another page takes longer than 450ms, a placeholder in that page's shape (title bar in its module colour, strip and rows; or the Policy Library's hero and card; or the Overview's tiles) takes the content area. The old page is hidden, not unmounted. One opacity pulse for the whole placeholder, not one per bar. |
| Sidebar portal row | Background blends to the module colour (260ms); the coloured side marker fades. |
| Sidebar pages | One 2px marker on the guide line glides to the active page (transform and height, 200ms). The first placement jumps, later ones glide. |
| Module sections | The new module's pages open while the old one's fold (grid-rows 0fr↔1fr, 260ms). Only during the change; at rest the list is static. The folding list is `inert`. |
| Phone menu | Slides in from the left over a fading backdrop (200ms); slides out where the browser supports `allow-discrete` transitions, otherwise closes at once. |
| Buttons | Colour, border and shadow over 120ms; 1px press. While a form is with the server the pressed button shows a small spinner and ignores further presses. |
| Menus (`<details>` dropdowns, organisation switcher, HR portal menu) | 4px drop and fade, 120ms. |
| Dialogs (Radix) | Overlay fades; panel rises 8px and scales from 98%, 200ms; reverses in 120ms on close. |
| Tabs (Radix) | Active panel fades in, 200ms. Folder tabs and table rows blend their hover colour, 120ms. |
| Flash messages | Rise in when the server's answer arrives (they are rendered from the redirect, so never before). |
| HR Hub | Content rises in on arrival (full page load). Portal menu pops. Choosing another portal marks the entry as opening and runs a bar in that module's colour along the top. |

## Navigation behaviour

- A click on a link to another page in this tab (Next.js links and plain anchors alike) starts the pending state at
  once. Ignored: modified clicks, new tabs, downloads, `/api/` and static files, other sites, in-page anchors and
  the page already open (`pageTarget` in `src/lib/navigation.ts`, unit tested).
- While pending, the sidebar shows the page being opened as selected, with its module open. `aria-current` stays on
  the page actually on screen until the new one arrives, so assistive technology is never told about a page that
  has not loaded.
- The pending state ends when the address changes, or when the server sends a fresh render of the shell (a Server
  Action that redirects to the very same address), or on `pageshow` (Back into the history cache).
- Form submissions that go to the server (Server Action forms and plain forms) show the pending button and the
  bar. Forms that handle their own state opt out with `data-no-progress` (the AI assistant).
- The phone menu closes as soon as a page is chosen.
- Sidebar width is fixed; the sidebar scrolls the current page into view once when it first appears.
- A **Skip to content** link is the first focusable element and targets `#main-content`.
- Next.js's route announcer reads the new page's title to screen readers; every page has an `h1`.

## HR portal boundary

Superseded on 29 Oct 2026 by `HR_IN_PLATFORM_SHELL.md`: the HR Hub's screens now sit inside the platform's sidebar,
top bar and module title bar. Entering and leaving HR is still a full page load (now enforced for every link by the
shell's `onEdge` click handler in `src/components/navigation-progress.tsx`), so the HR sheet never stays behind on
another page. `src/hr/components/portal-switcher.tsx` and `public/hr/hr-motion.css` were removed with the HR top bar;
moving between HR screens now gets the platform's content entrance.

## Accessibility

- `prefers-reduced-motion: reduce`: every animation and transition in the platform is cut to 0.01ms (state still
  changes, instantly); the page entrance is skipped in script; the progress bar becomes a static bar and the button
  spinner a static ring, so the "working" signal remains. The HR sheet does the same.
- Focus: dialogs take focus and return it to their trigger (Radix and native `<dialog>`), closing on Escape. On
  the navy sidebar the focus ring is a 2px white inset outline. The folding module list is `inert`.
- `aria-current="page"` on exactly one sidebar page and on the module home when it is the page shown.
- Slow-page notices are in a polite live region. Placeholders are `aria-busy` with a visually hidden label.
- No flashing; nothing moves more than 8px; no scroll jumps (Next's own scroll-to-top on a new page is unchanged).

## Performance

- Only `opacity` and `transform` are animated on page content; these are composited and do not reflow.
- Nothing inside a register (tables, record lists) animates on arrival. Only the hovered row's colour transitions.
  A browser test counts running animations on the Daily Rota and requires none inside the register.
- Height is animated only on the sidebar's module section (at most ~25 short rows) and only during a change.
- The entrance runs on the existing element; nothing is remounted to trigger an animation.
- Placeholders use one opacity animation each, not one per bar.
- No animation library was added. Everything is CSS plus one Web Animations call.
- Layout shift on the Daily Rota after navigation is measured in a browser test (must stay under 0.1).

## Components updated

| File | Change |
| --- | --- |
| `src/app/globals.css` | Motion tokens, `@property --module`, sidebar/marker/section/drawer styles, progress bar, placeholders, menus, dialogs, tabs, pending buttons, reduced motion |
| `src/lib/motion.ts` (new) | Token mirror and `prefersReducedMotion()` |
| `src/lib/navigation.ts` (new) | Pure rules: active entry, most specific entry, which clicks open a page |
| `src/components/navigation-progress.tsx` (new) | Pending store, click/submit listeners, progress bar, slow and stalled notices |
| `src/components/skeletons.tsx` (new) | Page, Policy Library and Overview placeholders |
| `src/components/main-area.tsx` | Page entrance, colour blend switch, placeholder while waiting, `#main-content` target |
| `src/components/portal-switcher.tsx` | Pending-aware sidebar, gliding marker, opening/folding sections, phone menu slide and close on choice |
| `src/components/side-nav.tsx` | Uses the shared `isActiveHref` |
| `src/components/dialog.tsx`, `tabs.tsx`, `ui.tsx` | Animation classes; flash and folder-tab transitions |
| `src/components/assistant-form.tsx` | Opts out of the shell's pending state (it has its own) |
| `src/app/(app)/layout.tsx` | Skip link; progress bar in the top bar |
| `src/app/(app)/error.tsx`, `policies/error.tsx`, `not-found.tsx` | Real retry; error page in the shell's title-bar style; correct overview link |
| `src/app/hr/layout.tsx`, `src/app/hr/[[...path]]/page.tsx`, `src/hr/components/portal-switcher.tsx`, `public/hr/hr-motion.css` (new) | HR entry transition and leaving feedback (see above) |

Rota screens: no layout or structure change (OnePlan mirror preserved). Pixel comparison against `main` at rest
(1440 and 390 wide, 15 pages incl. all main rota screens): identical except the new 2px active-page marker on the
sidebar guide line. The Policy Library comparison also differed inside the PDF viewer only because the `main`
comparison server was missing its local pdf.js assets.

## Why there is no `loading.tsx`

A first version used route `loading.tsx` files. With JavaScript switched off they left the placeholder on screen
for good (Next streams the page behind a Suspense boundary that needs script to swap in). The placeholder is now
drawn in the browser during client navigation only, so a page loaded without JavaScript renders in full.

## Tests executed (29 Oct 2026, local isolated databases)

| Command | Result |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm test` (vitest, `csb_test`) | 22 files, 183 tests passed (baseline 175; +8 in `tests/unit/navigation.test.ts`) |
| `npm run test:hr` | 14 passed |
| `npm run build` | Pass |
| `npx playwright test` (`csb_e2e`) | 45 passed (baseline 30; +15 in `tests/e2e/navigation.spec.ts`) |

`tests/e2e/navigation.spec.ts` covers: Overview to each permitted module; HR as a full page load and HR → Rostering
→ Back → Forward without style leakage; permission-restricted navigation (care staff); sidebar active state and
marker; direct URLs, refresh, Back and Forward; module sections folding (inert while folding); keyboard operation,
focus ring and stable sidebar width; content-only entrance, none on query-string changes, shell never remounted
(typed search text kept); no animation inside a large rota register and layout shift under 0.1; slow navigation
(progress at once, placeholder, "taking longer" notice); a page that stops responding (Load it again / Dismiss);
form pending state until the server answers; navigation with JavaScript switched off; dialog focus in and out;
phone menu focus, Escape and close-on-choice; reduced motion.

One existing test was adjusted: `overview.spec.ts` read the Policy title bar colour immediately after a client
navigation; it now waits for the colour to settle (`toHaveCSS`), because the colour now blends over 260ms.

## Known limitations

- The phone menu's slide-out needs a browser with `transition-behavior: allow-discrete` (Chrome/Edge 117+,
  Safari 17.4+); elsewhere it closes instantly. The slide-in works everywhere `@starting-style` does, otherwise it
  appears at once.
- The colour blend needs `@property` (all current browsers); older ones switch colour at once.
- "Dismiss" on a stalled page cannot cancel a request already sent; if it completes later the new page appears.
- (Resolved by `HR_IN_PLATFORM_SHELL.md`: HR screens now use the platform's content entrance.)
