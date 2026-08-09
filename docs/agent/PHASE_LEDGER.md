# Autonomous Iteration Phase Ledger

> **Historical ledger:** Entries below preserve completed work and decisions at their original dates. New phases follow the realtime online, AI-first [Product Strategy](../PRODUCT_STRATEGY.md) and [Roadmap V5](../ROADMAP_V5.md).

## 2026-08-05 UI V3 Selected Target Implementation

Status: completed and released to Production.

Goal:

- Implement the selected product direction across the real React PWA, then close browser, responsive, accessibility, PWA, and release evidence without changing protected data or Provider contracts.

Scope:

- M0-M5: App Shell, staged Today lifecycle, itinerary/map/place, documents/inbox, contextual AI/search, forms, ledger/shared trip, and Settings.
- M6: same-state visual comparison, five-viewport Goldens, full regression, PWA upgrade, owner-approved iOS/Android simulator qualification, and same-SHA remote evidence.

No-go:

- No IndexedDB schema, Supabase semantics, Provider contracts, route-cache semantics, ticket/blob storage, AI privacy, or confirmation-boundary change.
- No generated map, ticket, identity, or realtime fact copied into product data.
- No fabricated simulator, physical-device, or remote deployment result.

Result:

- Mobile navigation is `今日 | 行程 | 资料 | 我的`; Search and AI remain contextual commands.
- Today now has distinct empty, predeparture, active, and completed states.
- Documents use a real-preview editing list; Inbox is reached through `来源与导入`.
- Trip uses `日程 | 地图`, a compact date strip, continuous timeline, and one place Sheet.
- Global AI is on-demand, auto-closes after navigation, preserves one final confirmation for writes, and retries failed steps without repeating successful steps.
- Shared V3 Section, Row, Status, Disclosure, and Form primitives now cover core and low-frequency pages.
- Selected Target comparisons for predeparture, active Today, itinerary, and documents found no open P0/P1/P2 visual issue.

Validation:

- Typecheck, lint, 191-file/1578-test unit suite, production build, bundle budget, executable Golden flows, and five PWA upgrade tests passed.
- Full serial E2E passed 175/175 in approximately 6.6 minutes; PWA upgrade passed 5/5.
- iPhone 16 / iOS 26.5 Simulator passed Safari, Add to Home Screen, installed-PWA cold start, software-keyboard, map, and AI Sheet checks from a fresh state.
- Android API 33 Emulator passed the production build in Chrome, system WebView layout, DOM accessibility bounds, software keyboard, map, AI Sheet, and horizontal-overflow checks. The legacy Chrome 103 WebAPK launcher limitation is recorded and covered by the 5/5 built-dist PWA lifecycle matrix under the owner-approved simulator standard.
- Final candidate `76e35ca` passed GitHub Actions run `31014432123` and Cloudflare Pages Preview deployment `3fa543de-5895-4b17-b557-6f8b58dca308` on the same SHA.
- Physical devices are optional post-release observation and no longer block UI V3.
- PR #33 merged as `9317a9a`; GitHub Actions main run `31015131693` and Cloudflare Pages Production deployment `6647a145-87c9-45a3-b602-059deb450ac3` passed for the merge SHA.
- Production root, Manifest, Service Worker, entry assets, and precache smoke passed without real Provider calls. Supabase migrations and advisors were inspected read-only; no cloud contract changed.

Next:

- Continue with Roadmap V5 Realtime Cloud Core as a separately bounded phase; keep physical-device observations optional and retain UI V3 regression gates.

## 2026-07-29 Planned Program - UI V3 Product Shell

Status: implementation and browser acceptance complete; physical-device release evidence pending

Goal: replace the current layered App Shell, persistent AI input, repeated trip navigation, card-heavy pages, and narrow desktop shell with the product-level adaptive experience defined in [UI V3](../UI_REFACTOR_V3.md).

Execution order:

1. V3.0 visual direction, `DESIGN.md`, Stitch Design System, and six key screens.
2. V3.1 App Shell, four top-level destinations, adaptive navigation, and on-demand AI Action Sheet.
3. V3.2 Today, itinerary, map, item detail, and ticket vertical slice.
4. V3.3 documents, inbox, and search integration.
5. V3.4 settings, progressive forms, ledger, shared trip, and remaining surfaces.
6. V3.5 accessibility, performance, Golden Screenshots, full E2E, PWA upgrade, and real-device acceptance.

No-go:

- Do not combine the UI migration with schema, cloud-write, Provider, ticket/blob, route-cache, or AI privacy contract changes in the same phase.
- Do not describe Target navigation or Action Sheet behavior as shipped before its code and validation land.
- Do not merge ImageGen, Stitch, or Figma output directly; implement and verify real React components.

Required evidence:

- Fixed viewport and state matrix from `docs/UI_REFACTOR_V3.md`.
- `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run build`, relevant E2E, full serial E2E when feasible, and PWA upgrade coverage.
- Manual iPhone Safari/PWA and Android Chrome/PWA records before release.

## 2026-07-30 V3.0 Visual Direction And Implementation Gate

Status: completed

Goal:

- Lock one reusable visual language before changing production UI, while preparing an implementation boundary that does not depend on the selected density or Today-page composition.

Completed evidence:

- Audited the live implementation at the fixed `390 x 844` viewport and retained the screenshots outside the repository.
- Generated exactly three independent Today-page directions from the same real trip state: timeline-first, next-stop-first, and map-first.
- Recorded the shared contracts and pending selection state in [UI V3](../UI_REFACTOR_V3.md).
- Confirmed that the direction choice changes first-screen emphasis only; navigation, AI behavior, ticket previews, progressive disclosure, accessibility, and data boundaries stay fixed.

Decision gate:

- On 2026-07-30 the user selected a fusion of direction 2's visual language and direction 3's map-first hierarchy.
- `docs/DESIGN.md` records the chosen direction, semantic token mapping, component anatomy, six key-screen contracts, responsive behavior, and approved deviations.
- Created Stitch project `9253865158827971218` and Design System `4831380021779748496`.
- Generated Today, itinerary, map, place detail, documents, and AI Action Sheet references under that single Design System; their screen identifiers are recorded in `docs/DESIGN.md`.
- Rejected generated suggestions that conflicted with the selected contract, including a deep-blue primary, default-expanded AI steps, and an extra unsourced weather widget.

Implementation boundary after selection:

- `src/App.tsx` continues to own route resolution and account/trip context, but passes route metadata to the shell instead of deriving visual title behavior ad hoc.
- `src/components/AppShell.tsx` becomes the sole owner of safe areas, top bar, adaptive primary navigation, modal-layer coordination, and content insets.
- `src/components/BottomTabBar.tsx` becomes the four-destination `PrimaryNavigation`; route mapping keeps detail, document, ledger, search, and settings subroutes attached to the correct top-level destination.
- `src/components/ai/GlobalAiCommandBar.tsx` is decomposed into an Action Gateway controller and an on-demand `AiActionSheet`; planning, validation, preview, confirmation, stale-plan, idempotency, and retry behavior remain unchanged.
- The current exported `TripNav` is replaced with one `日程 | 地图 | 资料 | 费用` context switch and is removed from detail routes.
- Page-specific fixed bottom bars and guessed `pb-32` / `pb-48` offsets migrate to the shell modal/safe-area contract before page-level visual work begins.

First implementation receipts:

- Unit: four navigation destinations and route mapping; single shell title; AI closed with no mounted fixed surface; dialog focus trap, Escape, focus return, and one confirmation.
- Component: one bottom surface invariant; long Chinese/English labels; `320px` overflow; `200%` text; light/dark semantic tokens.
- E2E: Today-to-itinerary navigation, contextual Search, AI open/close/navigation, write preview and single confirmation, direct detail-route refresh, PWA safe-area behavior.
- Visual: selected target and implementation compared at the same `390 x 844` state before creating any Golden Screenshot.

Risk:

- High for shell migration because the existing AI component, route mapping, full-screen day/item layouts, and bottom navigation all independently own fixed positioning.
- Medium for route compatibility because existing Hash URLs and deep links must survive the information-architecture change.

Stop conditions:

- Stop and repair if a page can mount two fixed bottom interaction surfaces, AI closes without restoring focus, a write bypasses preview/confirmation, a deep link becomes unreachable, a route loses its top-level selection, or any protected data/Provider contract must change.
- Keep V3.0 pending if visual selection, `docs/DESIGN.md`, or same-state visual comparison evidence is missing.

## 2026-07-30 V3.1-V3.4 Product Shell And Core Journeys

Status: implemented; focused validation passed; V3.5 product acceptance in progress.

Goal:

- Apply the selected direction 2 visual language and direction 3 map-first hierarchy to the real application without changing data, Provider, sync, route-cache, ticket/blob, or AI confirmation contracts.

Scope:

- V3.1: adaptive App Shell, four stable destinations, contextual top bar, route presentation, and on-demand AI Action Sheet.
- V3.2: map-first Today, compact itinerary, full-canvas day map, place detail, and progressive item/trip forms.
- V3.3: real-thumbnail ticket gallery, documents, Inbox, and search.
- V3.4: four-group Settings, collapsed technical controls, ledger, owner/companion shared-trip routing, AI Draft, and remaining secondary surfaces.

No-go:

- No IndexedDB schema, Supabase/cloud semantics, Provider operation, route-cache, ticket/blob storage, AI privacy boundary, or write-confirmation change.
- No real Provider, AI, route, map, Supabase, or Cloudflare call during implementation validation.
- No fabricated device acceptance result.

Result:

- Bottom navigation is now `今日 | 行程 | 收件箱 | 我的`; Search and AI are top-bar commands.
- AI has no mounted idle overlay. Opening it shows a compact Action Sheet; result and confirmation states expand only when needed.
- Today and day map use the existing real map engines as the primary canvas. Map controls, selected-place cards, attribution, and bottom navigation have separate safe regions.
- Itinerary timelines, reminders, trip tools, readiness repair, Settings, ticket/document tools, and advanced diagnostics are flat or collapsed by default.
- Ticket pages open on the gallery, use real image/PDF previews when available, contain long names, and move filtering and add flows into sheets.
- Trip and item forms expose only basic information and place fields before `更多设置`; one save action owns the bottom safe area.
- The owner `同行共享` route now accepts the `tripId` produced by the product UI instead of falling into the guest-link flow.
- AI Draft now shows destination, dates, and one primary online generation command first; preferences, variants, local examples, and JSON import are secondary disclosures.
- All modal surfaces render above the primary navigation, fixing confirmation and preview controls that could previously be obscured.

Focused validation:

- Repeated `npm run typecheck:app` and `npm run lint` checks passed through the implementation phases.
- Focused component suites for App Shell, route presentation, Today/day/map, tickets, documents, Search, Settings, forms, Trip Workspace, readiness repair, Shared Trip, ledger, and AI Draft passed.
- The real local application was inspected at `390 x 844` for Today, trip, day list/map, item forms, tickets/documents, Inbox, Search, all Settings levels, ledger setup, owner Shared Trip, AI Draft, and AI Action Sheet.
- The `390px` inspected states reported no document-level horizontal overflow. Final `320/768/1440`, dark, `200%`, full suite, E2E, build, PWA, and Golden comparison remain in V3.5.

Risk:

- Medium until the complete serial E2E and responsive matrix pass because the shell changes affect every route.
- Real iPhone Safari/PWA and Android Chrome/PWA remain manual release evidence and must not be inferred from browser automation.

## 2026-07-30 V3.5 Product Acceptance

Status: completed for implementation and browser acceptance; physical-device release evidence pending.

Goal:

- Close the UI V3 implementation with responsive, accessibility, visual-fidelity, full regression, PWA-upgrade, and production-build evidence.

Result:

- Compared the selected `2 + 3` generated reference and the real Today implementation in one same-state `390 x 844` artifact.
- Fixed the two P2 differences found in the first pass: expanded map attribution and an overly shallow itinerary sheet.
- The second combined comparison found no actionable P0, P1, or P2 visual differences.
- Verified Today at `320 x 844`, `390 x 844`, `768 x 1024`, and `1440 x 900`, plus dark mode and `200%` equivalent reflow, without document-level horizontal overflow.
- Inspected the real Trip itinerary, item detail, ticket gallery, Settings root, and AI Action Sheet in the selected in-app browser.
- Confirmed AI initial focus, Escape close, focus return, compact idle height, and non-overlapping modal/navigation layers.
- Kept real iPhone Safari/PWA and Android Chrome/PWA acceptance explicitly pending instead of inferring it from desktop emulation.

Validation:

- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 188 files and 1,560 tests.
- `npm run build` passed; bundle budget passed at 852.5 KiB initial JS, 245.6 KiB gzip, and 2,261.3 KiB/108-entry precache.
- The complete serial E2E suite passed all 156 tests in approximately 5.8 minutes.
- The complete built-dist PWA upgrade suite passed all 5 tests.
- The final focused Home/map/mobile regression passed all 9 tests at `390 x 844`.
- The scan-local `design-qa.md` records the visual comparison and ends with `final result: passed`; screenshots and that local QA record remain uncommitted.

## 2026-06-17 Phase 1 - Trip Home Overview

Status: completed

Goal: make Trip Home feel like a real trip command center with a full-trip map overview, next-step orientation, and clearer entry points into day, ticket, route, ledger, and readiness workflows.

Scope:

- Improve `TripWorkspacePage` layout and derived overview model.
- Reuse existing local data, `TripMapPreview`, readiness, route preparation, tickets, and ledger entry points.
- Keep user-facing copy in Chinese.

No-go:

- No IndexedDB schema changes.
- No cloud sync, Supabase, provider proxy, route cache, AI privacy, or ticket blob contract changes.
- No real AI, search, route, map, Cloudflare, Supabase, or other provider calls.

Likely files:

- `src/pages/TripWorkspacePage.tsx`
- `src/pages/TripWorkspacePage.test.tsx`
- supporting UI components only if existing page patterns require it.

Validation:

- `npm run build`
- `npm run lint`
- `npm run test:unit -- src/pages/TripWorkspacePage.test.tsx`
- broader tests before final push.

Risk: medium, because Trip Home is a central route but the work is local UI and derived state only.

Stop conditions:

- Stop or narrow scope if the implementation requires protected data contracts, real provider calls, or schema changes.
- Stop and repair within phase if Trip Home tests or build fail due to this phase.

Result:

- Added a Trip Home command-center overview with trip stats, focus day, next item, map coverage, and quick entries for tickets, route preparation, and ledger.
- Reworked the focus-day timeline preview so it no longer labels the first item as in-progress without evidence.
- Kept the change local to UI and derived state; no schema, sync, route cache, provider, AI privacy, or cloud semantics changed.

Validation:

- `npm run test:unit -- src/pages/TripWorkspacePage.test.tsx` passed.
- `npm run lint -- src/pages/TripWorkspacePage.tsx src/pages/TripWorkspacePage.test.tsx` passed.
- `npm run build` passed.
- `git diff --check` passed.

## 2026-06-17 Phase 4 - Ticket Library Gallery

Status: completed

Goal: make Ticket Library feel like a ticket gallery rather than a flat file list, with useful local status overview and binding-based sections.

Scope:

- Add local ticket stats for total, copy/reference/external, unassigned, and cached copy tickets.
- Group filtered tickets by binding context while preserving existing upload, preview, delete, and cache actions.
- Improve tests around gallery summary and sections.

No-go:

- No ticket blob storage, cloud sync, Supabase, auto-sync, upload queue, schema, or provider contract changes.
- No real cloud, provider, map, route, search, or AI calls.

Likely files:

- `src/pages/TicketLibraryPage.tsx`
- `src/pages/TicketLibraryPage.test.tsx`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- `npm run test:unit -- src/pages/TicketLibraryPage.test.tsx`
- `npm run lint -- src/pages/TicketLibraryPage.tsx src/pages/TicketLibraryPage.test.tsx`
- `npm run build`
- `git diff --check`

Risk: medium, because Ticket Library combines upload, preview, delete, and cache controls, but this phase keeps behavior and storage untouched.

Stop conditions:

- Stop or split if changes require altering ticket blob/cache/cloud semantics.
- Repair within phase if Ticket Library tests, lint, or build fail due to this change.

Result:

- Added a ticket-library overview card with total, storage-mode, offline-cache, and unassigned counts.
- Replaced the flat gallery with binding-based sections for item-bound, trip-level, and unassigned tickets.
- Preserved existing upload, preview, delete, cache clear/restore, retry, and sync-display behavior.

Validation:

- `npm run test:unit -- src/pages/TicketLibraryPage.test.tsx` passed.
- `npm run lint -- src/pages/TicketLibraryPage.tsx src/pages/TicketLibraryPage.test.tsx` passed.
- `npm run build` passed.
- `git diff --check` passed.

## 2026-06-17 Phase 3 - Item Detail Onsite View

Status: completed

Goal: turn Item Detail into a field-ready onsite page with immediate time/location/ticket context and safer external navigation from the current or previous stop.

Scope:

- Improve `ItemDetailPage` information hierarchy and local derived relation display.
- Reuse existing map-link helpers, ticket preview, previous/next item relations, and place lookup confirmation flow.
- Keep all actions user-triggered and local/browser-only except existing explicit place lookup search.

No-go:

- No schema, ticket blob, cloud sync, route cache, provider proxy contract, AI privacy, or search changes.
- No automatic place lookup, route generation, AI, cloud, Supabase, Cloudflare, or real provider calls.

Likely files:

- `src/pages/ItemDetailPage.tsx`
- `src/pages/ItemDetailPage.test.tsx`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- `npm run test:unit -- src/pages/ItemDetailPage.test.tsx`
- `npm run lint -- src/pages/ItemDetailPage.tsx src/pages/ItemDetailPage.test.tsx`
- `npm run build`
- `git diff --check`

Risk: medium, because Item Detail is central navigation UI, but changes are local presentation and existing helper links.

Stop conditions:

- Stop or split if improvements require changing provider contracts, stored data shapes, or automatic writes.
- Repair within phase if Item Detail tests, lint, or build fail due to this change.

Result:

- Added an onsite summary directly below the item hero with day position, time, coordinate readiness, location, and ticket status.
- Kept no-coordinate external navigation unavailable until coordinates are added, matching the existing field-safety contract.
- Added previous-stop external route links using existing local map-link helpers and kept the ticket-library entry trip-scoped for the existing documents route contract.
- Preserved the explicit place lookup search/confirmation boundary; no automatic provider calls or writes were added.

Validation:

- `npm run test:unit -- src/pages/ItemDetailPage.test.tsx` passed.
- `npm run lint -- src/pages/ItemDetailPage.tsx src/pages/ItemDetailPage.test.tsx` passed.
- `npm run build` passed.
- `git diff --check` passed.

## 2026-06-17 Phase 2 - Day Map Marker Card

Status: completed

Goal: complete the Day View marker-card interaction so a map marker opens a lightweight place card with nearby navigation and a clear path into Item Detail.

Scope:

- Keep changes inside `DayMapView` and focused tests.
- Make marker cards appear from explicit marker selection rather than defaulting to the first item.
- Add previous/next mappable item controls and richer place context using existing item fields.

No-go:

- No MapLibre lifecycle rewrite.
- No route cache, routing provider, provider proxy, cloud sync, schema, or AI privacy changes.
- No real map, route, search, AI, Cloudflare, Supabase, or provider calls.

Likely files:

- `src/components/trip/DayMapView.tsx`
- `src/components/trip/DayMapView.test.tsx`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- `npm run test:unit -- src/components/trip/DayMapView.test.tsx`
- `npm run lint -- src/components/trip/DayMapView.tsx src/components/trip/DayMapView.test.tsx`
- `npm run build`
- `git diff --check`

Risk: medium, because map overlay padding and selection behavior are user-facing but local to the day map view.

Stop conditions:

- Stop or split scope if the work requires changing map adapter contracts or route-cache/provider behavior.
- Repair within phase if marker-card tests, lint, or build fail due to this change.

Result:

- Kept the Day Map default first-place card for existing workflows while allowing explicit marker selection and dismissal.
- Added richer lightweight card context: stop index, ticket count, time, location/address, detail action, and previous/next mappable-place navigation.
- Preserved existing map adapter, route cache, provider, and viewport-padding contracts.

Validation:

- `npm run test:unit -- src/components/trip/DayMapView.test.tsx` passed.
- `npm run lint -- src/components/trip/DayMapView.tsx src/components/trip/DayMapView.test.tsx` passed.
- `npm run build` passed.
- `git diff --check` passed.

## 2026-06-17 Final Integration Repair

Status: completed

Goal: preserve existing E2E-visible navigation, provider-fixture, and locator contracts after the four product phases.

Scope:

- Restore Day Map default first-marker-card behavior while preserving the richer marker card and previous/next controls.
- Restore Item Detail no-coordinate map fallback and trip-scoped ticket-library navigation.
- Preserve Trip Home quick-action test ids after the command-center redesign.
- Make AI draft E2E provider proxy fixtures explicit and scope an AI import assertion to the Day View timeline.

No-go:

- No production provider, AI privacy, schema, cloud sync, route cache, ticket blob, or storage contract changes.
- No real AI, search, route, map, Cloudflare, Supabase, or provider calls.

Result:

- Full validation is green after integration repair.
- The final complete Playwright run passed `121 passed`.

Validation:

- `npm run lint` passed.
- `npm run test:unit` passed: 151 test files and 1245 tests.
- `npm run build` passed with the existing Vite large-chunk warning.
- `PLAYWRIGHT_PROXY=http://127.0.0.1:10808 PLAYWRIGHT_WORKERS=1 npm run test:e2e` passed: 121 tests.
- `git diff --check` passed.

## 2026-06-20 Phase 5 - Trip Context Continuity

Status: completed

Goal: preserve the last meaningful trip and day across global navigation so the bottom Trip tab, page headers, and return paths keep users inside the journey they were working on.

Scope:

- Add a small versioned browser navigation-context store for non-sensitive trip/day identifiers.
- Record context from canonical trip-scoped routes without changing route shapes.
- Make the global Trip tab reopen the active or most recently visited trip instead of falling back to Home when the current URL has no `tripId`.
- Resolve the app-shell title for trip-scoped routes, not only Trip Home.
- Add focused unit/component coverage for invalid persisted data, stale trips, route transitions, and tab behavior.

No-go:

- No IndexedDB schema, cloud sync, route cache, provider, AI privacy, ticket/blob, or vault changes.
- No new route contract or automatic remote lookup.
- Do not persist titles, notes, coordinates, ticket data, document data, or other sensitive content in browser navigation context.

Likely files:

- `src/lib/navigationContext.ts`
- `src/lib/navigationContext.test.ts`
- `src/App.tsx`
- `src/components/AppShell.tsx`
- `src/components/BottomTabBar.tsx`
- focused component tests.

Validation:

- focused Vitest files for navigation context, app shell, and bottom tabs.
- `npm run lint`
- `npm run build`
- `git diff --check`

Risk: medium, because global navigation is shared by every route, while persisted data remains limited to non-sensitive identifiers.

Stop conditions:

- Stop or narrow if continuity requires changing canonical hashes, IndexedDB records, sync payloads, or private document data.
- Repair within the phase if stale context can trap users on missing trips or break existing tab navigation.

Result:

- Added a versioned navigation-context store that persists only trip/day identifiers and safely ignores malformed or oversized records.
- Validated stored and route-derived trip IDs against IndexedDB before using them, and automatically removed stale persisted context.
- Extended trip-scoped shell titles beyond Trip Home and made the global Trip tab return to the last valid trip from Home, Search, Inbox, or Settings.
- Preserved the last day while moving within one trip and dropped it when switching to a different trip.

Validation:

- `npm run test:unit -- src/App.test.tsx src/lib/navigationContext.test.ts src/components/AppShell.test.tsx` passed: 3 files and 22 tests.
- focused ESLint passed for all Phase 5 files.
- `npm run build` passed with the existing large-chunk warning.
- `git diff --check` passed.

## 2026-06-20 Phase 6 - Global Home 2.0

Status: completed

Goal: turn the global Home page into an accurate journey portfolio that selects the active or next trip by travel date, shows the next useful local action, and separates upcoming from completed travel.

Scope:

- Build a pure Home overview model for ongoing, upcoming, and completed trips using each trip's existing timezone semantics.
- Select the primary trip by status/date rather than database array position.
- Add next-day/next-item context and compact local preparation signals from existing days, items, and tickets.
- Remove duplicate rendering of the primary trip from the recent list and make completed travel a secondary section.
- Preserve create, demo, AI draft, documents, import, settings, and delete workflows.

No-go:

- No automatic provider, cloud, map, route, AI, or search calls.
- No schema, timezone model, route cache, ticket blob, cloud semantics, or AI privacy changes.
- Do not infer realtime travel status beyond stored plain dates, wall-clock times, and the existing trip timezone rules.

Likely files:

- `src/lib/homeOverview.ts`
- `src/lib/homeOverview.test.ts`
- `src/pages/HomePage.tsx`
- `src/pages/HomePage.test.tsx`
- `e2e/home.spec.ts` or a focused Home E2E.

Validation:

- focused Home model and page tests.
- relevant Home E2E at desktop and 390px when feasible.
- `npm run lint`
- `npm run build`
- `git diff --check`

Risk: medium, because Home is the global entry point and trip ordering changes, but all data is read-only derived local state.

Stop conditions:

- Stop or split if overview signals require vault decryption, remote status, or a new persistent data model.
- Repair within the phase if empty, ongoing, upcoming, or all-completed portfolios lose an existing primary action.

Result:

- Added a pure timezone-aware Home portfolio model that prioritizes ongoing travel, then the nearest upcoming trip, instead of trusting IndexedDB `updatedAt` order.
- Added focus-day and next-item selection using stored plain dates, wall-clock times, execution state, and existing trip/day timezone semantics.
- Rebuilt Home into a primary journey panel plus upcoming and completed sections, removed the duplicate primary row, restored an accessible delete action, and kept all create/import/AI/documents/settings paths.
- Added bounded local preparation signals for day, itinerary, map-coordinate, and ticket coverage without provider, cloud, route, or vault calls.

Validation:

- `npm run test:unit -- src/lib/homeOverview.test.ts src/pages/HomePage.test.tsx` passed: 2 files and 12 tests.
- focused ESLint passed for all Phase 6 files.
- `npm run build` passed with the existing large-chunk warning.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/home-to-trip.spec.ts` passed at the project 390x844 viewport.
- Playwright visual inspection passed at 390x844 and 1280x900 with zero horizontal overflow and no console errors; screenshots remained outside the repository.
- The in-app Browser plugin was attempted first but its runtime was unavailable under the current session policy, so repository Playwright was used as the documented fallback.
- `git diff --check` passed.

## 2026-06-20 Phase 7 - Local Search 2.0

Status: completed

Goal: make the Search tab a useful local command surface across the expanded product, with ranked matches and accurate deep links for itinerary, tickets, transport bookings, and ledger records.

Scope:

- Add a pure weighted local-search index and query model with normalized matching and deterministic ranking.
- Index trips, itinerary items, tickets, non-secret transport booking/segment metadata, and ledger expenses.
- Add category filters, result counts, grouped empty states, and query-aware result labels.
- Deep-link each result to the narrowest existing canonical route.
- Load independent local datasets in parallel and keep result rendering bounded.

No-go:

- No network search, AI search, provider call, OCR, vault unlock, or decrypted document indexing.
- No IndexedDB schema, cloud sync, ledger contract, transport contract, ticket/blob contract, or route changes.
- Do not index encrypted secrets, document numbers, PNR/order numbers, notes from private vault objects, or raw ticket file content.

Likely files:

- `src/lib/localSearch.ts`
- `src/lib/localSearch.test.ts`
- `src/pages/SearchPage.tsx`
- `src/pages/SearchPage.test.tsx`
- focused Search E2E.

Validation:

- focused search model and page tests.
- relevant Search E2E at desktop and 390px when feasible.
- `npm run lint`
- `npm run build`
- `git diff --check`

Risk: medium, because search spans several local modules, while the implementation remains read-only and excludes protected/private payloads.

Stop conditions:

- Stop or narrow if a useful result requires decrypting vault content or altering a protected storage contract.
- Repair within the phase if ranking is unstable, deep links are incorrect, or large local datasets cause unbounded rendering.

Result:

- Added a pure weighted local-search index with NFKC/compact normalization, deterministic title-first ranking, category counts, bounded rendering, and grouped results.
- Expanded Search to trips, itinerary items, tickets, non-secret transport booking/segment metadata, and ledger expenses with exact canonical deep links.
- Loaded independent trip, ticket, ledger, booking, and segment datasets in parallel after their required parent IDs were known.
- Added a horizontally scrollable category control and responsive grouped result rows for the expanded local command surface.
- Kept the index in memory and explicitly excluded vault objects, booking secrets, PNR/order data, private links, ledger order numbers, ledger notes, OCR, and raw ticket file content.

Validation:

- `npm run test:unit -- src/lib/localSearch.test.ts src/pages/SearchPage.test.tsx` passed: 2 files and 12 tests.
- focused ESLint passed for all Phase 7 files.
- `npm run build` passed with the existing large-chunk warning; Search remains a lazy route chunk.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/search.spec.ts` passed at the project 390x844 viewport.
- Playwright visual inspection passed at 390x844 and 1280x900 with zero horizontal page overflow and no console errors; screenshots remained outside the repository.
- The E2E flow proved Home seed -> Search -> compact query -> item group -> exact Item Detail navigation.
- `git diff --check` passed.

## 2026-06-20 Final Integration and Accessibility Repair

Status: completed

Goal: prove the three phases work together across the full product and repair any branch-owned regression before push.

Scope:

- Run the full lint, unit, build, and Playwright suites from the isolated feature worktree.
- Preserve existing Home `trip-card` interaction/text contracts while keeping the new portfolio structure.
- Repair Search accessibility failures found by the existing 390px axe audit.

No-go:

- No provider, cloud, schema, vault, route-cache, ticket/blob, or AI privacy changes.
- No weakening, skipping, or suppressing existing accessibility rules.

Result:

- Preserved the Home `trip-card` test/interaction contract and complete stats phrases inside the redesigned primary journey panel.
- Replaced the invalid `role=tab` plus `aria-pressed` combination with a named segmented-filter group using native pressed-button semantics.
- Tightened the Search E2E URL assertion so it independently proves the Item route and selected trip ID.

Validation:

- `npm run lint` passed.
- `npm run test:unit` passed: 166 files and 1338 tests.
- `npm run build` passed with the existing large-chunk warning.
- First full Playwright run passed 125/126 and identified one branch-owned critical `aria-allowed-attr` failure in Search filters.
- Focused `e2e/mobile-ux-a11y.spec.ts` passed after the semantic repair.
- Final `PLAYWRIGHT_PROXY=http://127.0.0.1:10808 PLAYWRIGHT_WORKERS=1 npm run test:e2e` passed: 126 tests in approximately 5.7 minutes.
- No real AI, search, route, cloud, or provider operation was invoked; provider-backed E2E paths remained mocked/disabled.
- Fetched and merged the parallel `main` increment `2500f73` after read-only review of its production smoke script and Companion owner-select RLS migration; no Home, Search, navigation, or product-code conflicts occurred.
- Post-merge `node --check scripts/trip-intelligence-cross-device-smoke.mjs`, full lint, 166-file/1338-test unit suite, and production build passed.
- GitHub Actions run `27873146515` for `main@2500f73` passed Lint, Type Check, Build, Unit Tests, and E2E Tests. This feature push has no branch run because CI is configured for `main` pushes and `main` pull requests only.
- Latest Cloudflare Pages production deployment `0f6e0bd8-22d8-48f8-92c0-8a3869cb5da0` for `main@2500f73` completed the deploy stage successfully.
- Supabase production migration history includes `harden_production_boundaries` and `allow_owner_select_companion_projection`; targeted SQL confirmed owner-or-member SELECT plus owner-only insert/update/delete policies on `companion_shared_trips`.
- Supabase security advisors reported one existing leaked-password-protection warning and one informational deny-all connector-secrets table notice; performance advisors reported nine informational unused-index notices and no blocking issue.

## 2026-06-22 Baseline Integration - Parallel Main Rebase

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: continue the autonomous product run in the existing isolated worktree without touching the parallel `codex/provider-production-hardening` checkout, while incorporating the latest account isolation, authentication, and time-semantics work from `main`.

Result:

- Reused the clean `/Users/ysradmin/Documents/tripmap-autonomous-20260620` worktree; the primary checkout and its untracked screenshots were left untouched.
- Merged `origin/main` without conflicts.
- Preserved the completed navigation-context, Global Home 2.0, and Local Search 2.0 phases.

Validation:

- `npm run lint` passed.
- `npm run test:unit` passed: 169 files and 1352 tests.
- `npm run build` passed with the existing large-chunk warning.

## 2026-06-22 Phase 8 - Direct Day Plan Reordering

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: let users directly reorder a day's itinerary with accessible controls while replacing scattered multi-write reorder loops with one atomic local mutation that preserves existing object-sync and confirmation contracts.

Scope:

- Add a repository-level transaction for a complete day order and a tracked mutation that emits the existing item upserts after the transaction succeeds.
- Reuse that mutation in manual Day Timeline ordering, route-order suggestion apply, Companion reorder, and AI trip-edit reorder paths where their existing validation already supplies a complete order.
- Add an explicit Day Timeline ordering mode with move-up/move-down controls, pending preview, save, and cancel.
- Warn that transport details remain attached to their destination item; do not silently rewrite times or transport fields.

No-go:

- No IndexedDB schema, object-sync wire shape, route-cache key, AI patch schema, Companion mutation contract, provider, or cloud semantic changes.
- No drag-and-drop-only interaction; keyboard and 390px controls must remain complete.
- No automatic route generation or route-order provider call.

Likely files:

- `src/db/repositories.ts` and `src/db/trackedMutations.ts`
- `src/components/trip/DayTimelineView.tsx`
- existing AI, Companion, and route-order apply call sites plus focused tests.

Validation:

- Focused repository/tracked-mutation, Day Timeline, AI apply, Companion, and Trip Map tests.
- `npm run lint`, `npm run build`, `git diff --check`, and relevant 390px Day E2E.

Result:

- Added `reorderDayItems` as one Dexie transaction with duplicate, stale-set, stale-baseline, and day-existence guards.
- Added a tracked reorder mutation so object-sync item upserts and trip dirty events are emitted only after the local transaction succeeds.
- Split chronological sorting from explicit plan-order sorting, then reused plan order in day lists, route-order suggestion, map preview, route preparation, Companion reorder, and Trip Map route-order apply paths.
- Added a Day Timeline sorting mode with Chinese copy, accessible up/down controls, draft preview, cancel, save, and transport metadata guidance.
- Hardened the mobile E2E database cleanup to unregister stale service workers and clear Cache Storage before each scenario.

Completed validation:

- `npx eslint src/lib/itinerary.ts src/lib/itinerary.test.ts src/db/repositories.ts src/db/repositories.test.ts src/db/trackedMutations.ts src/db/trackedMutations.test.ts src/db/index.ts src/lib/companion.ts src/components/trip/TripMapPreview.tsx src/components/trip/DayTimelineView.tsx src/components/trip/DayTimelineView.test.tsx src/lib/routeOrderSuggestion.ts src/lib/routing.ts src/lib/tripMapPreview.ts src/components/DayMap.tsx e2e/helpers.ts e2e/full-page-forms.spec.ts` passed.
- `git diff --check` passed.
- `npm run test:unit -- src/lib/itinerary.test.ts src/db/repositories.test.ts src/db/trackedMutations.test.ts src/components/trip/DayTimelineView.test.tsx src/components/trip/DayMapView.test.tsx src/lib/routeOrderSuggestion.test.ts src/lib/routing.test.ts src/lib/routeCache.test.ts src/lib/tripMapPreview.test.ts src/lib/companion.test.ts src/lib/ai/aiTripEditApply.test.ts` passed: 11 files and 103 tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 169 files and 1357 tests.
- `npm run build` passed with the existing large-chunk warning.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/full-page-forms.spec.ts -g '日程排序模式'` passed.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/full-page-forms.spec.ts` passed: 7 mobile tests.

Post-push remote diagnostics:

- Pushed `feature/autonomous-iteration-20260620-navigation-search` at `c57b707e9e062e811f80779f751e2fed50ece8ed`.
- GitHub Actions returned no run for this feature branch/commit.
- Cloudflare Pages latest production deployment stayed on `main` commit `06b7c32c391dec3b4867e0483165df1dafc49165`; deploy stage was `success`.
- Supabase CLI listed project `rfpcooafakuvgrdlfxpg` as `ACTIVE_HEALTHY`; Supabase MCP migration/branch reads were unavailable because the connector OAuth token was revoked, and CLI migration listing required linked DB credentials not available in this session.

Risk: medium-high, because ordering is shared across manual, AI, Companion, and route-suggestion flows, but stored shapes and sync payloads remain unchanged.

Stop conditions:

- Stop or narrow if atomic ordering requires a schema/wire-contract change or changes the meaning of transport metadata.
- Repair within the phase if any existing confirmation, stale-preview, route-order, or object-sync test regresses.

## 2026-06-22 Phase 9 - Ticket Metadata Editor

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: complete the missing ticket editor so users can correct titles, categories, notes, and itinerary binding without re-uploading or deleting the ticket.

Scope:

- Add a transactional metadata update/rebind operation that keeps `TicketMeta.itemId`, scope, and itinerary `ticketIds` consistent.
- Expose editing from gallery cards and the full-screen preview, using a dedicated responsive editor surface.
- Permit title, category, note, and trip/item/unassigned binding changes; preserve storage mode and underlying copy/reference/external payload.
- Refresh gallery grouping, preview metadata, local search data, and existing object-sync queue through current change events.

No-go:

- No ticket/blob schema, file replacement, storage-mode conversion, cloud path, vault, OCR, or upload contract changes.
- No deletion or rebinding without explicit save; cancel leaves all records unchanged.

Likely files:

- ticket repository/tracked mutation contracts.
- `src/pages/TicketLibraryPage.tsx` and a focused editor component.
- Ticket Library, repository, object-sync, and preview tests.

Validation:

- Focused ticket repository/page/preview/local-search tests.
- `npm run lint`, `npm run build`, `git diff --check`, and ticket E2E at 390px.

Read-only mini-plan result:

- Existing ticket creation updates `TicketMeta`, optional `TicketBlob`, and itinerary `ticketIds` through separate calls; deletion already centralizes cleanup in a repository transaction.
- Phase 9 will add one repository/tracked mutation for metadata and binding edits, then route the gallery card and full-screen preview through that mutation.
- The editor will preserve storage mode, file/blob/reference/external payloads, cloud paths, OCR/import contracts, and object-sync wire shapes.

Result:

- Added `updateTicketMeta` as one repository transaction over ticket metadata, trip items, and trip timestamps; it rejects cross-trip item binding and repairs stale item `ticketIds` references while rebinding.
- Added the tracked mutation wrapper so updated ticket metadata and changed itinerary items enter the existing object-sync outbox only after the local transaction succeeds.
- Added card-level and full-screen-preview editing entry points in the ticket library.
- Added a responsive ticket metadata editor for title, category, note, and trip/item/unassigned binding; storage mode, file/blob/reference/external payloads, OCR, vault, and cloud paths are not editable.
- Added repository, tracked mutation, page, and mobile E2E coverage for metadata editing and atomic binding cleanup.

Completed validation:

- `npx eslint src/db/repositories.ts src/db/repositories.test.ts src/db/trackedMutations.ts src/db/trackedMutations.test.ts src/db/index.ts src/components/TicketPreview.tsx src/pages/TicketLibraryPage.tsx src/pages/TicketLibraryPage.test.tsx e2e/ticket-library.spec.ts` passed.
- `git diff --check` passed.
- `npm run test:unit -- src/db/repositories.test.ts src/db/trackedMutations.test.ts src/pages/TicketLibraryPage.test.tsx src/lib/localSearch.test.ts` passed: 4 files and 48 tests.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/ticket-library.spec.ts -g '票据库可以编辑票据元数据'` passed.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/ticket-library.spec.ts` passed: 7 mobile tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 169 files and 1361 tests.
- `npm run build` passed with the existing large-chunk warning.

Risk: medium-high, because metadata participates in item binding and object sync, while blob/storage semantics remain untouched.

Stop conditions:

- Stop or split if rebind cannot be transactional with the existing stores or would require migration/cloud contract changes.
- Repair within the phase if editing can orphan an itinerary `ticketIds` reference or mutate file/blob fields.

## 2026-06-22 Baseline Integration - Provider Hardening Rebase

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: absorb the latest provider production hardening merge from `main` before starting PWA lifecycle work, while preserving the autonomous branch's Phase 8 and Phase 9 product changes.

Result:

- Fetched `origin/main` and merged `cb1b992090a461c5a1e455ae67bc0fff65da33c3` without conflicts.
- Preserved Phase 8 day plan ordering and Phase 9 ticket metadata editor commits.
- Pushed merge commit `9ad2a99` to the feature branch.

Validation:

- `npm run lint` passed.
- `npm run test:unit` passed: 172 files and 1379 tests.
- `npm run build` passed with the existing large-chunk warning.
- GitHub Actions returned no run for the feature branch.
- Cloudflare Pages latest production deployment stayed on `main` commit `cb1b992090a461c5a1e455ae67bc0fff65da33c3`; deploy stage was `success`.
- Supabase CLI listed project `rfpcooafakuvgrdlfxpg` as `ACTIVE_HEALTHY`.

## 2026-06-22 Phase 10 - PWA Lifecycle Control

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: replace invisible service-worker behavior with a clear, non-blocking update and offline lifecycle so beta users know when a new build is ready and when network-only features are unavailable.

Scope:

- Register the PWA through an application controller instead of the injected opaque auto-update path.
- Show a compact global offline notice and a user-triggered update/restart prompt with defer and retry behavior.
- Keep map tiles, provider calls, search, routes, and cloud explicitly network-only; do not add runtime caches.
- Surface the same lifecycle state in Settings with the current app version and recovery guidance.

No-go:

- No commercial map caching, background provider retries, forced reload during unsaved form work, or new telemetry/provider calls.
- No claim that offline mode includes maps, routes, search, or cloud.

Likely files:

- `vite.config.ts`, `src/main.tsx`, and `src/components/AppShell.tsx`.
- a focused PWA lifecycle module/controller and Settings integration.

Validation:

- Unit/component tests with mocked service-worker registration and online/offline events.
- production build/service-worker artifact inspection, lint, diff check, and focused PWA E2E.

Read-only mini-plan result:

- `vite-plugin-pwa` currently injects registration automatically with `registerType: autoUpdate` and `skipWaiting: true`, so users get invisible update behavior.
- Phase 10 will switch to manual registration through a controller that records SW availability, update-ready, offline-ready, error, and online/offline state in a local store.
- AppShell will render a compact global offline/update notice, and Settings will expose the same lifecycle state with the current app version and a user-triggered update action.
- Workbox runtime caching stays empty; map/search/route/cloud/provider capabilities remain network-dependent.

Result:

- Switched `vite-plugin-pwa` from injected `autoUpdate` registration to manual prompt registration; Workbox runtime caching remains empty, and `skipWaiting`/`clientsClaim` are no longer automatic.
- Added a PWA lifecycle store, hook, registration wrapper, controller, and Vitest virtual-module stub.
- Added global AppShell lifecycle banners for offline and update-ready states, including user-triggered update/restart and a dismiss path.
- Added Settings lifecycle status with current version, service-worker state, update action, online/offline state, and explicit network-only map/route/search/cloud guidance.
- Added unit/component tests for lifecycle state, mocked registration callbacks, global banner behavior, and Settings integration, plus a mobile Settings E2E smoke.

Completed validation:

- `npx eslint vite.config.ts src/vite-env.d.ts src/lib/pwaRegister.ts src/lib/pwaLifecycle.ts src/lib/pwaLifecycle.test.ts src/hooks/usePwaLifecycleState.ts src/components/PwaLifecycleController.tsx src/components/PwaLifecycleController.test.tsx src/components/PwaLifecycleBanner.tsx src/components/PwaLifecycleBanner.test.tsx src/components/AppShell.tsx src/App.tsx src/pages/SettingsPage.tsx src/pages/SettingsPage.test.tsx e2e/appearance.spec.ts vitest.config.ts src/test/pwaRegisterStub.ts` passed.
- `git diff --check` passed.
- `npm run test:unit -- src/lib/pwaLifecycle.test.ts src/components/PwaLifecycleController.test.tsx src/components/PwaLifecycleBanner.test.tsx src/pages/SettingsPage.test.tsx src/components/AppShell.test.tsx` passed: 5 files and 33 tests.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/appearance.spec.ts -g 'PWA 生命周期'` passed.
- `PLAYWRIGHT_WORKERS=1 npm run test:e2e -- e2e/appearance.spec.ts` passed: 2 mobile tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 175 files and 1387 tests.
- `npm run build` passed with the existing large-chunk warning.
- Build artifact inspection showed no `dist/registerSW.js` and no injected registration in `dist/index.html`; `dist/sw.js` only retains the user-triggered `SKIP_WAITING` message listener and does not call `clients.claim()`.

Risk: medium, because update timing affects the full application shell but no stored data contract changes.

Stop conditions:

- Stop or narrow if the plugin cannot expose a deterministic prompt flow without breaking production registration.
- Repair within the phase if an update can reload automatically while a form or confirmation flow is active.

## 2026-06-22 Phase 11 - Executable Design System Pass

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: turn the existing SwiftUI-like direction into an executable repository contract and reusable controls, then apply it to the new Day, Ticket, and PWA surfaces instead of leaving another layer of one-off utility strings.

Scope:

- Record the existing product tokens and interaction hierarchy in repository design-system guidance compatible with agent workflows.
- Add only the missing reusable primitives justified by Phases 8-10, such as compact toolbars, inline status notices, and segmented action groups.
- Migrate the new surfaces and nearby duplicated patterns while preserving current route and data behavior.
- Verify light/dark, 390px, desktop, focus, reduced-motion, and long Chinese labels.

No-go:

- No wholesale visual rebrand, generated UI/code import, marketing page, or unrelated page rewrite.
- No purple/blue monochrome redesign, nested-card expansion, or decorative-only UI.

Likely files:

- repository design-system guidance and `src/components/ui/*`.
- the Day, Ticket, PWA, and focused UI tests touched by the prior phases.

Validation:

- UI primitive tests, focused page tests, lint, build, diff check, 390px/desktop visual and accessibility E2E.

Read-only mini-plan result:

- Existing UI primitives already cover buttons, cards, rows, empty states, forms, and collapsible settings sections, so Phase 11 should not introduce a broad component framework.
- Recent Day, Ticket, and PWA surfaces duplicated compact action rows and rounded inline status blocks; these are justified shared primitives because they recur across multiple product workflows.
- The safe executable scope is to add `ActionToolbar` and `InlineStatus`, document when to use them, migrate the Phase 8-10 surfaces, and lock the semantics with component tests plus focused workflow validation.

Result:

- Added executable repository design-system guidance in `docs/DESIGN_SYSTEM.md`.
- Added shared `ActionToolbar` and `InlineStatus` primitives with unit coverage for grouping, alignment, tone, icon, and role semantics.
- Migrated Day timeline, Ticket library, PWA lifecycle banner, and Settings PWA status copy to the shared primitives while preserving existing data, provider, and confirmation boundaries.
- Added a focused Phase 11 E2E layout guard across 390px and desktop widths, and scoped the workspace version assertion to the About section because PWA lifecycle status also surfaces the current version.
- Hardened local Playwright coworking by letting `PLAYWRIGHT_PORT` or `E2E_PORT` override the default `4173` preview port while preserving the default path.

Completed validation:

- `npm run lint` passed.
- `npm run test:unit` passed: 175 files, 1391 tests.
- `npm run build` passed; only the existing large chunk warning was reported, and PWA `generateSW` completed.
- `git diff --check` passed.
- Focused E2E passed for the new design-system layout guard, Day ordering, Ticket metadata editing, PWA lifecycle status, mobile UX/a11y, and the workspace view-switching path.
- First isolated full E2E on `PLAYWRIGHT_PORT=4273` completed with 129 passed and one transient `cloud-backup.spec.ts` timing failure. The failed test then passed alone and `e2e/cloud-backup.spec.ts` passed 12/12.
- Final isolated full E2E on `PLAYWRIGHT_PORT=4275 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 130 tests.

Risk: medium, because shared primitives can affect multiple surfaces; migration remains limited to recently changed workflows.

Stop conditions:

- Stop expansion if a primitive cannot remove real duplication or preserve existing semantics.
- Repair within the phase if shared styling causes layout shift, overlap, focus, or dark-mode regressions.

## 2026-06-23 Phase 12 - Time Semantics Alignment

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: align the stale timezone audit with the current codebase and add executable guardrails so Trip/Day timezone selection, cross-timezone item ranges, and cloud version timestamps stay deterministic without introducing schema or provider changes.

Scope:

- Update timezone/date documentation and roadmap/status stale notes to reflect the existing Trip/Day/Item timezone fields, `timeSemantics` helpers, and cross-timezone transport support.
- Harden cloud version timestamp formatting so invalid or missing timezone input cannot crash sync prompts.
- Strengthen unit coverage for Trip/Day timezone inheritance, selected-day choice around date boundaries, cross-timezone item chronology, and version timestamp fallback.
- Keep all behavior local and deterministic; no migrations, cloud writes, provider calls, or schema changes.

No-go:

- No new timezone schema fields, no Supabase migration, no IndexedDB version bump, and no automatic timezone backfill for historical data.
- No route/cache/provider contract changes and no real AI/search/map/route calls.
- No product claim that timezone handling fully solves multi-leg transport beyond the current explicit fields.

Likely files:

- `docs/TIMEZONE_AUDIT.md`, `docs/ROADMAP_V4.md`, `docs/PROJECT_STATUS.md`.
- `src/lib/cloudSnapshotCheck.ts`, `src/lib/cloudSnapshotCheck.test.ts`, `src/lib/timeZone.test.ts`, `src/hooks/useTripData.test.ts`, and possibly `src/lib/tripVisuals.test.ts`.

Validation:

- Targeted unit tests for time semantics, timezone helpers, selected-day behavior, trip visual status, and cloud snapshot checks.
- `npm run lint`, `npm run test:unit`, `npm run build`, `git diff --check`, and focused E2E only if UI copy or prompts change.

Read-only mini-plan result:

- The 2026-05-17 timezone audit is stale: code now has Trip/Day timezones, item start/end timezones, cross-date `endDate`, and Temporal-backed helpers.
- `pickSelectedDay` and `getTripStatus` already use trip/day timezone semantics, so the phase should document and guard them rather than invent a new model.
- `formatVersionTimestamp` accepts a timezone but directly passes it to `Intl.DateTimeFormat`; invalid values can throw inside cloud/sync prompts. Safe fallback is a small but real reliability fix.
- The safe executable scope is documentation alignment plus tests and local pure-helper hardening; any schema or migration work remains explicitly out of scope.

Result:

- Updated `docs/TIMEZONE_AUDIT.md`, `docs/ROADMAP_V4.md`, and `docs/PROJECT_STATUS.md` so the repository no longer treats Trip/Day/Item timezone support as future-only work.
- Hardened `formatVersionTimestamp` with timezone validation and a UTC fallback for invalid timezone input.
- Added executable tests for invalid cloud-version timezone fallback, explicit requested-day precedence, Day timezone future-day selection, invalid Item timezone/endDate fallback, and Trip status timezone boundaries.
- Kept schema, IndexedDB versioning, Supabase, route/cache/provider contracts, and real provider calls untouched.

Completed validation:

- `npm run test:unit -- src/lib/cloudSnapshotCheck.test.ts src/lib/timeZone.test.ts src/hooks/useTripData.test.ts src/lib/tripVisuals.test.ts src/lib/timeSemantics.test.ts` passed: 5 files, 47 tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 176 files, 1398 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `git diff --check` passed.
- `PLAYWRIGHT_PORT=4276 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/cloud-backup.spec.ts` passed: 12 tests.

Risk: medium, because time semantics affect navigation, trip status, sync prompts, and import confidence; changes remain in pure helpers and docs.

Stop conditions:

- Stop or split if a fix requires changing stored record shape, migration, cloud object contracts, or provider request/response contracts.
- Repair within the phase if timezone fallback changes valid display output, selected-day behavior, or cross-timezone chronology tests.

## 2026-06-23 Baseline Integration - PR4 Beta QA Governance Main Merge

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: merge the latest `origin/main` PR4 beta QA / CI governance changes into the autonomous feature branch before starting another product phase, keeping Phase 8-12 work and cowork validation isolation intact.

Scope:

- Merge `origin/main` commit `2f97045` into the feature branch.
- Preserve PR4 beta docs, desktop smoke, PWA upgrade E2E, CI Chrome install hardening, and package scripts.
- Preserve Phase 11 Playwright port isolation and Phase 12 time-semantics guardrails.
- Resolve docs conflicts by combining beta QA priorities with the updated time-semantics boundary.

No-go:

- No direct push to `main`, no provider calls, no cloud writes, no schema changes.
- Do not drop Phase 8-12 product work or PR4 governance docs.

Validation:

- Conflict marker scan, `git diff --check`, `npm run lint`, `npm run test:unit`, `npm run build`, and focused E2E for new PR4 scripts / cloud backup as feasible.

Result:

- Merged `origin/main` commit `2f97045` into the autonomous feature branch and preserved PR4 beta QA governance docs, CI hardening, desktop smoke, PWA upgrade smoke, and package scripts.
- Resolved docs conflicts by combining PR4 limited beta / QA priorities with Phase 12 time-semantics boundaries in `docs/PROJECT_STATUS.md`, `docs/ROADMAP_V4.md`, and `docs/TIMEZONE_AUDIT.md`.
- Preserved Phase 11 Playwright port isolation while keeping the PR4 desktop smoke project.
- Repaired the newly merged PWA upgrade smoke so it explicitly activates the waiting service worker with the product-supported `SKIP_WAITING` message and uses bounded waits before checking IndexedDB data retention.

Completed validation:

- Conflict marker scan passed across resolved docs, Playwright config, helpers, and ledger.
- `git diff --check` passed before and after the PWA smoke repair.
- `npm run lint` passed before and after the PWA smoke repair.
- `npm run test:unit` passed: 176 files, 1398 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `PLAYWRIGHT_PORT=4277 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e:desktop-smoke` passed: 1 test.
- Initial `PLAYWRIGHT_PORT=4278 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e:pwa-upgrade` exposed a PWA upgrade smoke waiting bug; after repair the same command passed: 1 test.
- `PLAYWRIGHT_PORT=4280 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 132 tests.

Risk: medium-high, because the merge touches CI config, Playwright config, beta QA docs, and the same status docs changed in Phase 12.

Stop conditions:

- Stop and repair if merge resolution removes Phase 8-12 files, breaks Playwright port isolation, or conflicts with PR4 CI smoke commands.

## 2026-06-23 Baseline Integration - PR5 Mobile UX Favicon CI Fix

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: merge the latest `origin/main` PR5 mobile UX / favicon CI fix into the autonomous feature branch before starting the next product phase, so local and remote E2E baselines stay aligned with main.

Scope:

- Merge `origin/main` commit `f83c577` into the feature branch.
- Preserve the PR5 `e2e/mobile-ux-a11y.spec.ts` favicon abort ignore.
- Keep the prior PR4/PWA smoke repair and Phase 8-12 product work intact.

No-go:

- No product code changes, provider calls, cloud writes, schema changes, or direct push to `main`.
- Do not change the mobile UX audit beyond the mainline PR5 fix unless validation exposes a branch-owned regression.

Validation:

- `git diff --check`, `npm run lint`, and targeted mobile UX/a11y E2E with Chrome channel when available.

Result:

- Merged `origin/main` commit `f83c577` into the feature branch.
- Preserved the PR5 favicon abort filter and extended the same narrowly scoped helper to ignore Chrome `ERR_ABORTED` for the generated Workbox registration chunk during rapid mobile UX page-hopping.
- Kept product code, provider boundaries, schema, cloud behavior, and Phase 8-12 work untouched.

Completed validation:

- `git diff --check` passed.
- `npm run lint` passed.
- Initial Chrome-channel targeted mobile UX/a11y E2E reproduced a local request abort for `/assets/workbox-window.prod.es5-*.js`.
- After the scoped Workbox abort filter, `PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_PORT=4281 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/mobile-ux-a11y.spec.ts --project "Mobile 390x844"` passed: 1 test.

Risk: low-medium, because the merge is a single E2E diagnostic helper change but it affects CI signal.

Stop conditions:

- Stop and inspect if the merge conflicts with branch-owned E2E helpers or if Chrome-channel mobile UX/a11y still fails for a non-environmental reason.

## 2026-06-23 Phase 13A - Trip Home Map Overview Entry Polish

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: make the Trip Home full-trip map overview a stronger product entry point by surfacing per-day map coverage and direct navigation into day maps / first mapped items, without adding provider calls or data-contract changes.

Scope:

- Extend the local trip map preview model with per-day map coverage summaries.
- Update `TripMapPreview` to show compact per-day entries below the full-trip preview, with clear coverage text and map/detail actions.
- Wire Trip Home to open the relevant Day Map or Item Detail from the overview.
- Keep the existing route preview, route order suggestion, map fallback, and no-auto-provider-call behavior intact.

No-go:

- No real map/search/route/provider calls beyond the already explicit route preview and route-order buttons.
- No schema, IndexedDB migration, cloud sync, route cache contract, or AI/privacy boundary changes.
- No broad Trip Home redesign outside the map overview entry.

Likely files:

- `src/lib/tripMapPreview.ts`, `src/lib/tripMapPreview.test.ts`.
- `src/components/trip/TripMapPreview.tsx`.
- `src/pages/TripWorkspacePage.tsx`.
- `e2e/trip-workspace.spec.ts`.

Validation:

- Targeted `tripMapPreview` unit tests.
- `npm run lint`, `npm run build`, `git diff --check`.
- Focused Trip Workspace E2E covering map overview entries and no mobile overflow.

Read-only mini-plan result:

- `TripMapPreview` already owns full-trip marker rendering, route preview fallback, route-order suggestion, and the `trip-map-overview` E2E surface.
- The missing product layer is not another provider call; it is a local per-day entry surface so Trip Home can answer "which day should I open on the map?".
- Safe executable scope is to extend the local preview model, add a compact horizontal day rail, and wire existing Day / Item routes.

Result:

- Extended `TripMapPreviewData` with ordered per-day coverage summaries: total items, mapped items, and first mapped item.
- Added a compact Trip Home map day rail under the full-trip preview with Day Map buttons, coverage labels, and first mapped item shortcuts.
- Wired Trip Home map shortcuts to existing canonical Day Map and Item Detail routes.
- Kept route preview fetching, route-order suggestion, map fallback, route cache, provider calls, schema, cloud sync, and AI boundaries unchanged.
- Updated roadmap and project status so Phase 13A is recorded as completed first pass.

Completed validation:

- `npm run test:unit -- src/lib/tripMapPreview.test.ts` passed: 1 file, 5 tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 176 files, 1399 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `PLAYWRIGHT_PORT=4282 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/trip-workspace.spec.ts -g "旅行工作台可以在日程和地图视图之间切换"` passed: 1 test.
- `PLAYWRIGHT_PORT=4283 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e:desktop-smoke` passed: 1 test.
- `PLAYWRIGHT_PORT=4284 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 132 tests.

Risk: medium, because Trip Home is a central route and the map preview touches MapLibre/Google fallback surfaces; data and provider boundaries remain unchanged.

Stop conditions:

- Stop and repair if per-day entries overlap the map plot, break marker rendering, trigger unexpected provider calls, or make the existing Trip Workspace / desktop smoke assertions unstable.

## 2026-06-23 Phase 13B - Day Map Marker Card Interaction Polish

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: make the Day Map marker-to-card-to-detail path more discoverable and field-ready by turning the floating marker card into a compact station navigator with an explicit detail CTA.

Scope:

- Refine the existing `MarkerPreviewCard` in `DayMapView`.
- Add a compact station rail for mapped items on the current day.
- Replace the icon-only detail affordance with an explicit "查看详情" action while preserving the existing test id / route behavior.
- Keep previous/next station navigation, map recenter, location, route cache, and fallback behavior intact.

No-go:

- No map provider, route provider, route cache, schema, cloud, AI, or privacy boundary changes.
- No new automatic route/search/place calls.
- No broader Day View layout redesign beyond the marker card interaction surface.

Likely files:

- `src/components/trip/DayMapView.tsx`.
- `e2e/map-floating-info.spec.ts`.
- Docs and ledger if completed.

Validation:

- Focused Day Map marker-card E2E.
- `npm run lint`, `npm run build`, `git diff --check`.
- Full unit and relevant E2E if the interaction changes shared map behavior.

Read-only mini-plan result:

- `DayMapView` already has marker selection, a floating card, previous/next station actions, map recenter, user location, route cache, and padding measurement.
- The weak point is discoverability: the detail action is icon-only and the user cannot directly scan/switch mapped stops from the floating card.
- Safe executable scope is the card surface and E2E assertions; route/cache/provider behavior remains unchanged.

Result:

- Added a compact station rail inside the Day Map marker card for all mapped items on the current day.
- Replaced the icon-only detail affordance with an explicit `详情` CTA while preserving `map-marker-card-open`.
- Kept previous/next station navigation and close behavior.
- Raised the marker card above the global AI command bar and increased fallback padding so the taller card does not intercept or hide map interactions.
- Updated roadmap and project status so Phase 13B is recorded as completed first pass.

Completed validation:

- Initial focused `e2e/map-floating-info.spec.ts` reproduced a real overlap bug: the global AI command bar intercepted the new detail CTA.
- After raising the card, `PLAYWRIGHT_PORT=4285 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/map-floating-info.spec.ts` passed: 7 tests.
- `npm run lint` passed.
- `npm run test:unit` passed: 176 files, 1399 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `git diff --check` passed.
- `PLAYWRIGHT_PORT=4286 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 132 tests.

Risk: medium, because the floating card determines map viewport padding and can overlap controls on 390px if its height grows.

Stop conditions:

- Stop and repair if the card overlaps map controls, pushes selected markers out of usable area, breaks return-to-map context, or weakens the no-provider-call map recenter guarantees.

## 2026-06-23 Phase 13C - Global AI Consultation Mode

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: productize the global AI command bar so harmless consultation, local confirmable actions, and provider-backed AI patch plans are clearly separated.

Scope:

- Add a read-only consultation intent/result to `globalAiCommandRouter`.
- Keep explicit write-like trip-edit commands on the existing provider-backed AI patch-plan path.
- Render consultation answers in `GlobalAiCommandBar` without send/apply confirmation and without writing local data.
- Cover the separation with router unit tests and focused global command-bar E2E.
- Update status/roadmap docs after validation.

No-go:

- No new provider proxy operation, AI patch schema, cloud sync, IndexedDB schema, route cache, search, map, ticket/blob, or AI privacy boundary changes.
- No real AI, search, route, map, Cloudflare, Supabase, or provider calls.
- No automatic fact claims about real-time openings, prices, closures, route ETA, or recent events without source-bearing search results.

Likely files:

- `src/lib/ai/globalAiCommandRouter.ts`
- `src/lib/ai/globalAiCommandRouter.test.ts`
- `src/components/ai/GlobalAiCommandBar.tsx`
- `e2e/global-ai-command-bar.spec.ts`
- Docs and ledger.

Validation:

- Focused router unit test.
- Focused global AI command-bar E2E.
- `npm run lint`, `npm run test:unit`, `npm run build`, `git diff --check`.

Read-only mini-plan result:

- The global bar already supports local replan previews, preference writes behind confirmation, ledger summary navigation, and provider-backed AI patch plans.
- The weak point is default routing: ordinary trip questions fall through to `ai_trip_edit`, which can surface provider/payload errors for harmless consultation.
- Safe executable scope is a deterministic local consultation result that summarizes current trip context and names the confirmation boundary; real provider calls remain behind explicit edit commands and existing confirmation dialogs.

Result:

- Added a `consultation` global AI intent/result for ordinary questions.
- Kept explicit write-like commands such as add/change/delete/move/reschedule on the existing provider-backed AI Trip Edit patch-plan lane.
- Rendered consultation answers in the global command bar as local, read-only results with no send confirmation, no apply action, and no IndexedDB write.
- Added focused unit and E2E coverage proving ordinary consultation does not request `/api/provider-proxy` while what-if replan still stays preview-only.
- Updated roadmap and project status so Phase 13C is recorded as completed first pass.

Completed validation:

- `npm run test:unit -- src/lib/ai/globalAiCommandRouter.test.ts` passed: 1 file, 6 tests.
- `npm run lint` passed.
- `PLAYWRIGHT_PORT=4287 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/global-ai-command-bar.spec.ts` passed: 2 tests.
- `npm run test:unit` passed: 176 files, 1401 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- Final `npm run test:unit -- src/lib/ai/globalAiCommandRouter.test.ts`, `npm run lint`, and `git diff --check` passed after the final parser keyword/doc polish.
- Final `PLAYWRIGHT_PORT=4289 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/global-ai-command-bar.spec.ts` passed: 2 tests.
- `PLAYWRIGHT_PORT=4288 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 133 tests.

Risk: medium, because command classification affects a global surface and must not steal explicit trip-edit requests from the provider-backed preview flow.

Stop conditions:

- Stop and repair if explicit edit commands no longer open the AI send confirmation, consultation makes provider requests, local write confirmation is bypassed, or the global bar overlaps bottom navigation / map controls again.

## 2026-06-23 Phase 14A - Item Detail Field Action Deck

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: turn Item Detail into a more field-ready onsite page by consolidating time, neighboring stops, route actions, place navigation, and bound tickets into a compact action deck near the top of the page.

Scope:

- Add a local derived Item Detail field context helper for previous/next stop labels, time range, coordinate readiness, route availability, and ticket summary.
- Replace the current passive onsite summary with an action-oriented field deck that surfaces route-to-here, open-place, open-ticket, and previous/next stop context.
- Keep existing map links, bottom previous/next controls, ticket preview, place lookup, content enrichment, and replan preference behavior intact.
- Add unit and E2E coverage for the field deck and no-horizontal-overflow mobile baseline.
- Update roadmap/project status after validation.

No-go:

- No schema, IndexedDB migration, cloud sync, route cache, ticket/blob storage, provider contract, AI privacy, or map provider changes.
- No real AI, search, route, map, Cloudflare, Supabase, or provider calls.
- No claims about live opening hours, real-time traffic, prices, closures, transit status, or recent facts.
- No broad Item Detail redesign outside the onsite action surface.

Likely files:

- `src/lib/itemFieldContext.ts`
- `src/lib/itemFieldContext.test.ts`
- `src/pages/ItemDetailPage.tsx`
- `src/pages/ItemDetailPage.test.tsx`
- `e2e/item-detail.spec.ts`
- Docs and ledger.

Validation:

- Focused item field context unit tests.
- Focused Item Detail page unit tests.
- Focused Item Detail E2E on mobile.
- `npm run lint`, `npm run build`, `npm run test:unit`, `git diff --check`.

Read-only mini-plan result:

- Item Detail already has a first onsite summary, map links, tickets, place lookup, content enrichment, and replan preferences.
- The remaining product gap is not another provider call; it is an integrated onsite action deck that answers "what do I need at this stop right now?" without forcing the traveler to scan multiple sections.
- Safe executable scope is local derivation and presentation; all external actions remain explicit links or existing confirmation-gated flows.

Risk: medium, because Item Detail is a central route and the new top surface must not overlap the fixed bottom action bar or weaken existing map/ticket/provider boundaries.

Stop conditions:

- Stop and repair if the field deck overlaps on 390px mobile, breaks source-view return behavior, creates provider calls, hides ticket preview access, or changes existing place lookup / content enrichment write confirmation semantics.

Result:

- Added `buildItemFieldContext` as a local derived model for Item Detail position, time, neighboring stops, coordinate readiness, route/place actions, and ticket summary.
- Replaced the passive onsite summary with a field action deck that surfaces the current stop, previous/next stop context, route-to-here links, open-place links, and first bound ticket access near the top of Item Detail.
- Kept existing bottom previous/next controls, source-view return behavior, ticket preview, place lookup, content enrichment, replan preferences, map links, provider contracts, schema, route cache, cloud sync, and AI/privacy boundaries unchanged.
- Added focused unit coverage for field context derivation and page-level field deck assertions.
- Extended focused Item Detail E2E to cover the field deck, route/place links, no-coordinate disabled state, top ticket preview access, and mobile no-horizontal-overflow checks.

Completed validation:

- `npm run test:unit -- src/lib/itemFieldContext.test.ts src/pages/ItemDetailPage.test.tsx` passed: 2 files, 11 tests.
- `npm run lint` passed.
- `PLAYWRIGHT_PORT=4290 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/item-detail.spec.ts` passed: 10 tests.
- `npm run test:unit` passed: 177 files, 1403 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `git diff --check` passed.
- Initial full E2E exposed a stale desktop smoke test id for the replaced onsite summary; after updating the smoke to `item-field-action-deck`, `PLAYWRIGHT_PORT=4292 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/desktop-beta-smoke.spec.ts` passed: 1 test.
- `PLAYWRIGHT_PORT=4293 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 133 tests.

## 2026-06-23 Phase 16A - Ticket Library Field Filters

Status: completed

Branch: `feature/autonomous-iteration-20260620-navigation-search`

Goal: make Ticket Library feel more like a field-ready document wallet by turning the overview into actionable filters for storage mode, offline readiness, and binding state.

Scope:

- Extend ticket filtering beyond file type / unassigned to include copy files, reference locations, external links, offline-ready copy tickets, item-bound tickets, and trip-level tickets.
- Make the ticket overview stat cells clickable filter controls while preserving the existing gallery card preview / edit / delete flows.
- Show a compact active-filter summary above the gallery so users understand why a subset is visible.
- Add unit and E2E coverage for actionable overview filters and filtered preview context.
- Update roadmap/project status after validation.

No-go:

- No ticket/blob storage schema, cloud object sync, ledger, AI, provider, route cache, or privacy boundary changes.
- No real cloud/provider calls and no automatic ticket rebinding or file upload retries.
- No full ticket previewer redesign in this phase.

Likely files:

- `src/pages/TicketLibraryPage.tsx`
- `src/pages/TicketLibraryPage.test.tsx`
- `e2e/ticket-library.spec.ts`
- Docs and ledger.

Validation:

- Focused Ticket Library unit tests.
- Focused Ticket Library E2E.
- `npm run lint`, `npm run build`, `npm run test:unit`, `git diff --check`.

Read-only mini-plan result:

- Ticket Library already has gallery sections, metadata editing, preview navigation, cache actions, and ticket intelligence suggestions.
- The weak spot is scan/navigation: the overview numbers are passive, and the only filters are file type plus unassigned.
- Safe executable scope is to make existing local stats drive local filtering; all writes remain behind existing explicit buttons and confirmations.

Risk: medium, because ticket filtering changes which tickets are passed into preview navigation and must not hide or mutate ticket metadata unexpectedly.

Stop conditions:

- Stop and repair if filtered gallery sections are misleading, preview navigation loses the filtered context, edit/delete actions mutate the wrong ticket, or cache/cloud/intelligence actions are triggered by filtering.

Result:

- Extended Ticket Library filtering to storage mode, offline-ready copy tickets, item-bound tickets, trip-level tickets, and unassigned tickets while preserving existing file-type filters.
- Turned Ticket Library overview stats into clickable local filters for copy/reference/external/offline/unassigned/all.
- Added an active filter summary with a clear reset control above the gallery.
- Preserved gallery sections, preview navigation, metadata editing, delete confirmation, cache actions, cloud sync state display, and ticket intelligence suggestions.
- Added unit and E2E coverage proving overview filters update the gallery and filtered preview context.

Completed validation:

- `npm run test:unit -- src/pages/TicketLibraryPage.test.tsx` passed: 1 file, 11 tests.
- `npm run lint` passed.
- `PLAYWRIGHT_PORT=4294 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/ticket-library.spec.ts` passed: 7 tests.
- `npm run test:unit` passed: 177 files, 1404 tests.
- `npm run build` passed with the existing large-chunk warning and PWA `generateSW`.
- `git diff --check` passed.
- Initial full E2E exposed two UX issues: active Ticket Library stat labels had insufficient contrast, and Trip Home map overview first-item shortcuts were 36px touch targets. Both were repaired within this phase.
- `PLAYWRIGHT_PORT=4297 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e -- e2e/mobile-ux-a11y.spec.ts` passed: 1 test after repair.
- `PLAYWRIGHT_PORT=4298 PLAYWRIGHT_WORKERS=1 PLAYWRIGHT_REUSE_SERVER=0 npm run test:e2e` passed: 133 tests.

## 2026-07-24 Release Candidate Closeout

Status: completed locally; remote same-SHA verification follows the authorized `main` push.

Goal:

- Close the CI build failure, simplify the remaining high-density mobile surfaces, complete direct global-AI navigation behavior, reconcile the Supabase release schema, and replace stale status/planning documents with one current baseline.

Scope:

- UI consistency audit across Day, Item, Ticket Library, Settings/PWA, and the global AI surface.
- Frontend plus provider runtime type coverage, Playwright CI diagnostics, and PWA update semantics.
- Supabase read-only production audit, local empty-database migration validation, and forward-only production repair for confirmed schema/index gaps.
- Current status, readiness, release notes, design rules, QA evidence, and post-beta roadmap.

No-go:

- No automatic AI writes, no unconfirmed ticket/cloud deletion, no provider secrets in browser code or reports, no destructive migration, and no unsupported realtime claims.

Result:

- Collapsed secondary Day/live/settings/add-ticket surfaces while keeping timeline and gallery first.
- Added real ticket thumbnail coverage, mobile long-text containment, and 44px close/reset controls.
- Made global AI ticket navigation direct, query-aware, focus-safe, and self-closing.
- Changed PWA activation to user-confirmed refresh and exposed the short deployment SHA.
- Fixed the missing provider operation type and added real typecheck coverage for Pages runtime and Travel Inbox Worker.
- Restored the missing companion migration history file.
- Added and deployed forward migrations for account AI preferences plus three Companion ticket foreign-key indexes.
- Replaced stale project status, readiness, release notes, and roadmap documents.

Validation:

- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check` passed.
- `npm run test:unit` passed: 180 files, 1447 tests.
- PWA upgrade passed: 1 test.
- Full Playwright passed: 137 tests in approximately 5.3 minutes.
- Supabase local empty-database reset passed.
- Production SQL confirmed account AI preference table, four RLS policies, private trigger, and authenticated CRUD grants.
- Security/performance advisors rerun after DDL; the newly reported missing foreign-key indexes were repaired.

Residual:

- Physical iPhone Safari/iOS PWA and Android Chrome recording.
- Bundle splitting for app, MapLibre, OCR/PDF.
- Supabase leaked-password protection decision and preview-tested consolidation of duplicate ticket SELECT policies.
- Universal AI Action Gateway v1 for arbitrary supported natural-language task composition.

## 2026-07-25 Universal AI Action Gateway V1

Status: merged to `main` as `5477ce6`.

Branch: `feature/ai-action-gateway-v1`

Goal:

- Replace keyword-only routing with a constrained natural-language action gateway for opening tickets, enriching places, and repairing trips.

Result:

- Added versioned action plan, step, definition, registry, prepared-plan, and run-result contracts.
- Added deterministic planning plus the privacy-filtered `ai_action_plan` Provider Proxy fallback.
- Restricted planning to `ticket.open@1`, `place.enrich@1`, and `trip.repair@1`; unknown actions, fields, cycles, sensitive values, oversized plans, and ambiguous targets fail closed.
- Added real previews, one final confirmation for writes, travel-state fingerprints, idempotency keys, dependency ordering, partial-failure continuation, and failed-step-only retry.
- Kept ticket metadata local, preserved Provider Proxy Auth/Origin/quota/budget/kill-switch/privacy boundaries, and retained existing command routes as compatibility adapters.
- Kept the global AI surface compact with a short summary, collapsed detail, one primary action, and automatic dismissal after successful navigation.

Validation:

- Local typecheck, lint, unit, build, PWA upgrade, and full E2E passed before merge.
- PR and merged `main` SHA passed GitHub Type Check, Build, Lint, Unit Tests, and E2E Tests.
- Cloudflare Pages deployed the same `main` SHA successfully.

Residual:

- Migrate time adjustment, route preview, expense draft, and document-opening actions into the registry.
- Add unified undo/history only after the existing action adapters share one stable transaction model.

## 2026-07-25 Phase 3A - Startup Bundle Boundary And Budget

Status: merged to `main` as `cd25438` through PR #19.

Branch: `feature/pwa-bundle-budget`

Goal:

- Remove AI, Provider, map, and document-processing work from the static startup graph and turn the resulting limits into a CI contract.

Scope:

- Lazy-load the global AI command surface.
- Split route/cache pure modeling from the Provider-backed routing client.
- Stabilize Supabase vendor chunking and restore PDF parsing to a true dynamic import.
- Generate a Vite manifest and validate startup chunks and byte budgets after every production build.
- Preserve existing UI, Provider contracts, data semantics, PWA update behavior, and AI confirmation boundaries.

No-go:

- No real Provider calls, database schema changes, cloud configuration writes, route cache schema changes, or AI privacy expansion.
- No visible feature expansion or new settings.

Read-only baseline:

- Production entry JS was 947.6 kB and statically preloaded the 422.6 kB PDF parser.
- Global AI and Provider contracts were part of the entry graph through the global command bar and route-cache imports.

Result:

- Production entry JS is 476.9 kB; initial static JS is 848.2 KiB raw and 244.8 KiB gzip.
- Global AI, Provider Proxy, MapLibre, PDF, OCR, and JSZip are absent from the static startup graph.
- Build now fails above 500 KiB entry, 900 KiB initial raw, or 260 KiB initial gzip, and if any protected low-frequency chunk returns to startup.
- Navigation-aborted hashed assets are treated as benign in the mobile browser audit while HTTP failures, console errors, and other request failures remain reportable.

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run test:unit` passed: 184 files, 1471 tests.
- Focused routing/AppShell unit tests passed: 3 files, 35 tests.
- Focused global AI E2E passed: 8 tests.
- Focused mobile UX/accessibility E2E passed: 1 test.
- `npm run test:e2e:pwa-upgrade` passed: 1 test.
- `npm run test:e2e` passed: 140 tests in approximately 7.8 minutes.
- `npm run build` and the new bundle budget passed.

Residual:

- MapLibre remains a 1 MB-class dynamic chunk.
- Service Worker precache is approximately 4.1 MB and needs a separate offline/weak-network design pass.
- Physical iPhone Safari/iOS PWA and Android Chrome performance evidence is still pending.

## 2026-07-26 Phase 3B - PWA Precache And Runtime Asset Budget

Status: completed locally.

Branch: `fix/pwa-precache-budget`

Goal:

- Reduce install/update downloads without weakening the core offline trip shell or PWA data-preserving upgrade behavior.

Scope:

- Keep the app entry, auth/runtime vendors, Trip, Day, Item, and Ticket Library code in the precache.
- Move MapLibre, PDF/OCR, JSZip, AI Draft, and global AI entry chunks to same-origin on-demand runtime caching.
- Remove duplicate public-asset precache entries.
- Extend the production build check with precache uniqueness, required-core, forbidden-optional, runtime-route, and byte budgets.
- Add built-dist browser coverage for optional assets being absent before first use and cached after first use.

No-go:

- No Provider calls, cloud writes, data/schema changes, route cache changes, or AI/privacy contract changes.
- No claim that maps, Provider operations, search, or cloud sync work offline.
- No automatic Service Worker activation or unconfirmed page reload.

Read-only mini-plan result:

- The current generated Service Worker precaches 107 entries and approximately 4.1 MB.
- MapLibre contributes about 1.1 MB, PDF about 421 kB, and AI/Provider/OCR/archive chunks add further non-core install cost.
- Public icons, manifest, favicon, and push handler are duplicated because both `includeAssets` and Workbox globbing include them.
- Workbox supports a same-origin `/assets/` `CacheFirst` runtime route with entry-count and age limits, so optional hashed chunks can remain available after first use.

Validation:

- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Extended bundle/PWA budget passed: 2286.8 KiB, 92 unique precache entries.
- `npm run test:unit` passed: 185 files, 1472 tests.
- Focused encrypted vault/Document Center tests passed: 2 files, 3 tests.
- `npm run test:e2e:pwa-upgrade` passed: 2 tests.
- `npm run test:e2e` passed: 141 tests in approximately 4.0 minutes.

Risk: medium, because over-filtering can make a core offline route fail while under-filtering preserves the current install cost.

Stop conditions:

- Stop and repair if Home/Trip/Day/Item/Ticket code leaves the precache, optional assets fail to populate runtime cache, upgrade activation changes, IndexedDB data is lost, or the generated Service Worker caches Provider/API responses.

Result:

- Reduced generated Service Worker precache from about 4.15 MiB/107 entries to about 2.28 MiB/92 entries.
- Kept the app entry, Trip, Day, Item, Ticket Library, and Travel Document Center dependency graphs in the precache.
- Moved MapLibre, PDF/OCR, JSZip, AI Draft, and global AI entry chunks to a same-origin `/assets/` `CacheFirst` cache limited to 80 entries and 30 days.
- Removed duplicated public icon/manifest entries.
- Made encrypted vault backup load JSZip only when export/import is requested, so ticket/document pages can open offline without loading archive code.
- Added build failures for duplicate/oversized precache manifests, missing core chunks, optional heavy chunks returning to precache, and missing runtime cache configuration.
- Added built-dist browser evidence for first-offline core navigation, runtime asset reuse while offline, and IndexedDB-preserving Service Worker upgrades.

Residual:

- Provider Proxy client/contract chunks remain in the precache because Trip Workspace and Item Detail statically import Provider-backed feature panels; moving them safely requires a separate feature-island refactor.
- MapLibre remains a 1 MB-class first-use download.
- Weak-network interruption recovery, multiple historical-version upgrades, and multi-tab activation remain to be covered.

## 2026-07-26 Phase 3C - GitHub Actions Node 24 Runtime

Status: completed locally.

Branch: `fix/github-actions-node24`

Goal:

- Remove the Node 20 action-runtime deprecation warnings emitted by otherwise successful CI runs.

Scope:

- Upgrade the official checkout, Node setup, and failure-artifact actions to supported Node 24 releases.
- Preserve the Node 24 application matrix, npm cache behavior, job graph, timeouts, and E2E environment.

No-go:

- No application, dependency, Provider, cloud, or deployment behavior changes.

Validation:

- Workflow diff and YAML syntax check passed locally.
- `git diff --check` passed.
- GitHub-hosted PR CI is the authoritative runtime validation.

Result:

- `actions/checkout` now uses v6, `actions/setup-node` v6, and `actions/upload-artifact` v6.
- All selected action releases use Node 24 and support current GitHub-hosted runners.

## 2026-07-26 Phase 3D - Provider Network Client On-Demand Boundary

Status: completed locally.

Branch: `feature/provider-client-on-demand`

Goal:

- Keep core offline trip pages independent from the Provider network execution implementation without changing Provider behavior or safety contracts.

Scope:

- Preserve the existing `providerProxyClient` public API through a lightweight facade.
- Keep synchronous configuration, session identity, and typed errors in a small shared module.
- Dynamically import the full authenticated request, validation, and response-normalization implementation only when a Provider operation runs.
- Exclude the emitted implementation chunk from the Service Worker precache and enforce the boundary from the generated manifest.
- Extend built-dist PWA coverage to prove the implementation is absent while core Trip, Day, Item, and ticket navigation remains available offline.

No-go:

- No Provider contract, Auth, Origin, quota, privacy, confirmation, schema, route-cache, or cloud behavior changes.
- No real Provider calls.

Read-only baseline:

- Trip Workspace and Item Detail statically reached the 31.7 KiB Provider client chunk, so Workbox had to precache it for core offline navigation.
- The client also contained lightweight synchronous config and error behavior that core pages legitimately need.

Result:

- `providerProxyClient.ts` is now a 2.1 KiB compatibility facade and dynamically imports the 31.7 KiB network implementation.
- A 1.7 KiB shared module preserves synchronous config, session IDs, and the exact `ProviderProxyClientError` identity used by callers.
- The network implementation is absent from the precache; the generated precache is approximately 2.21 MiB/94 entries.
- Build validation requires a dedicated dynamically imported Provider implementation and rejects its actual manifest file if it returns to the precache.
- Existing UI, Provider request schemas, Auth headers, source-bearing results, preview/confirmation gates, stale guards, and retry behavior remain unchanged.

Validation:

- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- Provider client focused unit tests passed: 31 tests.
- `npm run test:unit` passed: 185 files, 1472 tests.
- `npm run test:e2e:pwa-upgrade` passed: 2 tests.
- `npm run test:e2e` passed: 141 tests in approximately 4.1 minutes.

Residual:

- The 94.6 KiB Provider contract remains shared because core local validation and multiple feature models depend on it.
- A future per-operation contract split must preserve local rejection of unknown fields, sensitive fields, invalid plans, and malformed Provider responses.

## 2026-07-26 Phase 3E - PWA Multi-Tab Update And Runtime Recovery

Status: completed locally.

Branch: `feature/pwa-update-resilience`

Goal:

- Prove that a waiting PWA update does not reload an existing tab before confirmation, that one confirmed update moves all open tabs to the same version, and that interrupted first-use asset downloads recover without caching partial content.

Scope:

- Extend the real built-distribution PWA test server with deterministic update and interrupted-download controls.
- Cover two-tab waiting, explicit activation, cross-tab controller convergence, page reload behavior, and IndexedDB preservation.
- Cover a failed first request for an on-demand asset, a successful retry, runtime-cache population, and full offline reuse.
- Change application lifecycle code only if the built artifact violates the update contract.

No-go:

- No real Provider, map, search, route, AI, cloud, or external network calls.
- No changes to IndexedDB schema, Service Worker update consent, Provider contracts, or user-visible navigation.
- No automatic activation or reload before explicit update confirmation.

Likely files:

- `e2e/pwa-upgrade.spec.ts`
- `src/components/PwaLifecycleController.tsx` and focused tests only if required by the failing built-dist evidence.
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- Focused built-dist PWA upgrade tests.
- Typecheck, lint, full unit suite, production build, full serial E2E, and `git diff --check`.

Risk:

- Medium: Service Worker activation is shared by an origin, so the tests must distinguish consent-gated activation from the expected controller change in already-open tabs.

Stop conditions:

- Stop and repair if an update activates before confirmation, tabs remain on mixed controllers after confirmation, local IndexedDB data changes, a partial response enters the runtime cache, or offline core navigation regresses.

Result:

- Added a two-tab real-build upgrade test that holds v2 in `waiting` while both tabs continue on v1 without reloading.
- The existing prompt-mode Workbox lifecycle already converges both tabs on v2 after one explicit `更新并重启` confirmation, so no application lifecycle behavior changed.
- The same test verifies both documents reload onto the new controller and the shared IndexedDB marker remains intact.
- The built-dist server can now interrupt a selected asset response after one-third of the body, allowing the runtime-cache test to prove that incomplete content is not cached.
- A later full download is cached exactly once and returns the same complete byte length while offline.
- Service Worker version and document-load probes now retry only the expected execution-context race caused by the confirmed cross-tab reload.

Validation:

- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1472 tests.
- `npm run build` passed; bundle budget passed at 848.3 KiB initial JS, 244.8 KiB gzip, and 2261.2 KiB/94-entry precache.
- Focused built-dist PWA tests passed: 3 tests; a three-repeat stability run passed 9/9.
- The first full serial E2E run exposed an expected `controllerchange` navigation race in the new probe; after the scoped retry repair, the final run passed all 142 tests in approximately 5.5 minutes.
- `git diff --check` passed.

Residual:

- Multiple historical release versions, offline edits followed by online sync recovery, and storage-quota pressure still need separate matrices.
- Physical iPhone Safari/iOS PWA and Android Chrome weak-network evidence remains part of Beta QA.

## 2026-07-26 Universal AI Action Gateway V1.1 - Navigation And Time

Status: merged to `main` as `edd0e95` through PR #17.

Branch: `feature/action-gateway-navigation-time`

Goal:

- Move common page opening and explicit itinerary-time changes into the registered Action Gateway so natural-language commands execute through the same strict validation, short preview, confirmation, stale-plan, and history path.

Scope:

- Add a read-only semantic workspace navigation action with an enum target rather than a route string.
- Add a local-write itinerary-time action with a semantic item target and validated `HH:mm` values.
- Deterministically recognize explicit page-opening commands and unambiguous time changes; unresolved commands may still use the structured planner.
- Preserve duration when only a new start time is supplied and the existing same-day duration is valid.
- Cover local planning, catalog privacy, schema rejection, runtime navigation, write confirmation, stale protection, and mobile E2E.

No-go:

- No arbitrary route, function, database operation, item ID, token, file, or Provider payload supplied by the planner.
- No automatic write, no bypass of the one final confirmation, and no weakening of the travel-state fingerprint.
- No real AI, map, route, search, cloud, or Provider calls.
- No change to IndexedDB schema, cloud sync semantics, or existing ticket/place/repair behavior.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- Focused unit and E2E tests plus project status/roadmap/ledger.

Validation:

- Focused Action Gateway and Provider contract tests.
- Typecheck, lint, full unit suite, production build, focused mobile E2E, full serial E2E, and `git diff --check`.

Risk:

- Medium: time edits are user data writes and must remain semantic-targeted, previewed, confirmation-gated, and rejected after any intervening trip change.

Stop conditions:

- Stop and repair if a navigation action accepts a route value, a time action accepts malformed or ambiguous input, any write occurs during planning/prepare, duration preservation crosses a day without explicit data, or stale plans can write.

Result:

- Added `workspace.open@1` with a fixed semantic target enum for documents, home, inbox, ledger, map, search, settings, and the current trip; route strings and unknown targets are rejected locally.
- Added `item.time.update@1` with semantic item resolution and strict `HH:mm` validation.
- A start-only change preserves a valid same-day duration; a change that would cross midnight requires an explicit end time.
- Time preparation is read-only, the compact preview shows the before/after range, and the database write occurs only after the single final confirmation.
- Time writes reuse the shared trip fingerprint, reject stale prepared plans, and append a Trip Intelligence applied-change record.
- Deterministic local planning now handles explicit page-opening and time-change commands without a Provider request; unresolved requests remain constrained to the registered action catalog.
- Added 390px E2E coverage proving semantic navigation auto-executes, time changes remain unchanged before confirmation, duration is preserved after confirmation, and neither path calls Provider Proxy.

Validation:

- Focused Action Gateway tests passed: 19 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1476 tests.
- `npm run build` passed; bundle budget passed at 848.3 KiB initial JS, 244.8 KiB gzip, and 2262.9 KiB/94-entry precache.
- Focused mobile Action Gateway E2E passed: 2 tests.
- A focused five-repeat PWA stability run passed all 15 tests after one unrelated full-suite timing failure.
- The final full serial E2E run passed all 144 tests in approximately 5.6 minutes.
- `git diff --check` passed.

Residual:

- Route preview, expense-draft creation, add/delete/reorder edits, and broader selection contracts remain on compatibility paths.
- Cross-midnight time edits require a future date-aware action contract rather than inferring a next-day end.
- Real Provider planning remains intentionally uncalled in this phase; contract, privacy, and failure behavior are covered with local and mocked tests.

## 2026-07-26 Universal AI Action Gateway V1.2 - Route And Expense Draft

Status: merged to `main` as `2252fc8` through PR #18.

Branch: `feature/action-gateway-route-expense`

Goal:

- Move explicit route-preview generation and manual expense-draft creation into the registered Action Gateway while retaining one final confirmation, stale-plan protection, bounded Provider access, and short results.

Scope:

- Add a route-preview action with trip/day scope and semantic day targets.
- Prepare route readiness locally; call the configured route Provider and write route cache only after confirmation.
- Add an expense-draft action with a short title, positive decimal amount, optional ISO currency/date, and an enumerated category.
- Resolve ledger defaults locally and always create `draft`/`needs_review` records with tracked sync and Trip Intelligence history.
- Deterministically recognize unambiguous route generation and simple manual expense commands; unresolved commands may use the structured planner.
- Cover strict schema rejection, prepare-time non-mutation, Provider request timing, stale-state rejection, compact mobile previews, and final navigation.

No-go:

- No route strings, database IDs, arbitrary categories, account data, payment, settlement, confirmed expenses, deletion, or cancellation selected by the planner.
- No Provider call during route preparation and no expense Provider call.
- No real AI, map, route, search, cloud, or Provider calls.
- No IndexedDB schema, cloud contract, Provider Proxy contract, or route-cache format changes.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- Focused unit and E2E tests plus project status/roadmap/ledger.

Validation:

- Focused Action Gateway, ledger, route, and Provider contract tests.
- Typecheck, lint, full unit suite, production build, focused mobile E2E, full serial E2E, and `git diff --check`.

Risk:

- Medium-high: route generation consumes bounded Provider quota and expense creation is a synced finance write, even though the resulting record stays a draft.

Stop conditions:

- Stop and repair if route preparation calls Provider, a route or expense writes before confirmation, an expense can become confirmed, malformed amounts/currencies/categories pass validation, or stale plans can write route/ledger state.

Result:

- Added `route.preview@1` with day/trip scope and semantic day targets; planning and preparation only inspect local itinerary coordinates and route-cache readiness.
- Route Provider requests and cache writes now occur only after the single final confirmation. Successful generation records Trip Intelligence history and opens the selected day map.
- Added `ledger.expense.draft@1` with strict title, positive decimal amount, ISO-style currency/date, and fixed-category validation.
- Expense execution always creates a tracked `draft` / `needs_review` record with unknown payment status and no payer; the AI cannot select confirmed, paid, settled, cancelled, or arbitrary database fields.
- Expense preparation resolves ledger defaults locally, refuses missing setup, and rechecks settings and participant fingerprints before writing.
- Each prepared run carries a stable execution ID. Expense source fingerprints and an atomic IndexedDB check/create transaction prevent duplicate drafts during concurrent execution or retry, while a new command run can still create a distinct expense.
- Retry compares structured confirmation flags and prepared-action fingerprints; changed route configuration or newly materialized write previews return to preview and confirmation instead of reusing an earlier approval.
- A route response that cannot be persisted is now a retryable failure rather than a false success.
- Deterministic planning handles explicit route generation and simple expense commands without an AI Provider request; unresolved commands remain limited to the registered catalog.
- Added 390px E2E coverage proving route requests/cache and expense records remain absent before confirmation, details stay folded, and each plan exposes one confirmation path.

Validation:

- Focused Action Gateway tests passed: 26 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1483 tests.
- `npm run build` passed; bundle budget passed at 849.0 KiB initial JS, 244.9 KiB gzip, and 2266.1 KiB/94-entry precache.
- Focused mobile Action Gateway E2E passed: 3 tests.
- The full serial E2E run passed all 146 tests in approximately 5.6 minutes.
- `git diff --check` passed.
- A read-only protected-boundary review found three retry/idempotency/cache-result defects; all three were fixed and the reviewer verified the repairs.

Residual:

- Add/delete/reorder edits and more complex ledger updates remain on compatibility paths.
- Route execution intentionally uses the configured existing Provider/cache contract; this phase used mocked Provider responses and made no real calls.
- Cross-module undo and more page-level selection contracts remain future work.

## 2026-07-26 Universal AI Action Gateway V1.3 - Item Create And Reorder

Status: completed locally.

Branch: `feature/action-gateway-item-create-reorder`

Goal:

- Move explicit itinerary-item creation and same-day reordering into the registered Action Gateway without exposing database IDs, arbitrary patches, or unconfirmed writes.

Scope:

- Add an item-create action with a semantic day target, short title, and optional validated time.
- Append one new item through an idempotent tracked mutation; retries must not duplicate the item.
- Add a same-day reorder action that moves one semantic item before/after another item or to the first/last position.
- Resolve all targets locally, show compact before/after previews, and execute only after the single final confirmation.
- Reject stale trip state and atomically reject changed day membership/order.
- Deterministically recognize unambiguous add and reorder commands; unresolved commands may use the structured planner.
- Cover strict schema rejection, ambiguity, idempotency, stale state, confirmation gating, compact mobile UI, and sync/history recording.

No-go:

- No deletion, cross-day move, arbitrary item patch, database ID, coordinate, ticket, note, cloud, payment, or Provider-selected function/route.
- No Provider call for deterministic item creation or reordering.
- No real AI, map, route, search, cloud, or Provider calls.
- No IndexedDB schema, cloud contract, Provider Proxy contract, or ticket/blob changes.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- `src/db/repositories.ts`
- `src/db/trackedMutations.ts`
- Focused unit and E2E tests plus project status/roadmap/ledger.

Validation:

- Focused Action Gateway and tracked-mutation tests.
- Typecheck, lint, full unit suite, production build, focused mobile E2E, full serial E2E, and `git diff --check`.

Risk:

- Medium: both actions mutate synced itinerary data, so semantic resolution, final confirmation, idempotency, and stale-order checks must all hold.

Stop conditions:

- Stop and repair if planning or preparation writes data, unknown fields or IDs pass validation, a retry duplicates an item, reordering crosses days, or any write can occur after the trip/day order changes without a fresh confirmation.

Result:

- Added `item.create@1` with a semantic day target, short title, and optional validated same-day time range; deterministic commands append the item locally without a Provider call.
- Added `day.items.reorder@1` with semantic target/anchor resolution and fixed first/last/before/after positions; runtime resolution is scoped to one day and rejects ambiguous or cross-day anchors.
- Provider plans cannot provide database IDs, arbitrary patches, coordinates, notes, tickets, routes, functions, or unknown fields for either action.
- Planning and preparation remain read-only. Both actions expose one compact preview and write only after the existing final confirmation dialog.
- Item creation uses a stable execution-scoped item ID. Reusing the same execution cannot duplicate the item, while a separate user command can still intentionally create another item.
- Core item mutations, item sync outbox entries, stable-ID Trip Intelligence records, and history outbox entries now commit in one IndexedDB transaction for these actions; any side-effect failure rolls back the complete operation.
- The persisted Trip Intelligence change is also the operation marker. A retry can return idempotently only when that marker and the complete target membership/order still match.
- Reorder checks the expected membership and order before accepting a no-op; different execution IDs racing from the same baseline result in one success and one stale-plan rejection.
- Added 390px E2E coverage proving neither action calls Provider or writes before confirmation, details stay folded, one final confirmation is shown, and the final day order is correct.

Validation:

- Focused Action Gateway tests passed: 32 tests.
- Sync/history persistence was included in a 39-test focused run.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1489 tests.
- `npm run build` passed; bundle budget passed at 850.2 KiB initial JS, 245.3 KiB gzip, and 2270.6 KiB/94-entry precache.
- Focused mobile Action Gateway E2E passed: 2 tests.
- The full serial E2E run passed all 148 tests in approximately 5.7 minutes.
- `git diff --check` passed.
- A read-only protected-boundary review found post-commit sync/history and stale no-op defects; atomic persistence, stable operation markers, full membership comparison, and fault/concurrency tests resolved every reported issue.

Residual:

- Deletion and cross-day movement remain on the compatibility path because they need a higher-risk contract and clearer undo behavior.
- A new command invocation intentionally receives a new execution ID; explicit duplicate item creation remains possible when the user separately confirms it.
- Real Provider planning remains intentionally uncalled; schema, privacy, confirmation, idempotency, rollback, and stale-state behavior are covered locally and with mocks.

## 2026-07-26 Universal AI Action Gateway V1.4 - Cross-Day Item Move

Status: merged to `main` as `d3389f5` through PR #21.

Branch: `feature/action-gateway-cross-day-move`

Goal:

- Move one existing itinerary item between days through the registered Action Gateway while preserving semantic targeting, one final confirmation, atomic sync/history persistence, idempotent retry, and stale-plan protection.

Scope:

- Add `item.move@1` with a semantic item target, semantic destination day, optional semantic source day, and fixed first/last/before/after placement.
- Resolve source and destination membership locally and show a compact source-to-destination preview.
- Atomically compact the source day, insert into the destination day, update the moved item's day, enqueue every affected item, and record Trip Intelligence history.
- Reuse a stable operation marker so retries never move the item twice.
- Reject execution if either day's membership/order changes after preview.
- Deterministically recognize unambiguous cross-day move commands without a Provider request.
- Cover strict schema rejection, ambiguity, destination anchor scope, idempotency, stale state, confirmation gating, compact mobile UI, sync outbox, and history.

No-go:

- No deletion, arbitrary item patch, database ID, route string, coordinate, note, ticket/blob, cloud, payment, or Provider-selected function.
- No same-day reorder through this action and no automatic fallback that changes the requested destination.
- No Provider call for deterministic cross-day move commands.
- No real AI, map, route, search, cloud, or Provider calls.
- No IndexedDB schema, cloud contract, Provider Proxy contract, route-cache, ticket/blob, or AI privacy-boundary change.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- `src/db/repositories.ts`
- `src/db/trackedMutations.ts`
- Focused unit and E2E tests plus project status/roadmap/ledger.

Validation:

- Focused Action Gateway, repository, and tracked-mutation tests.
- Typecheck, lint, full unit suite, production build, focused 390px E2E, full serial E2E, and `git diff --check`.

Risk:

- Medium-high: one confirmation changes membership and ordering in two synced days, so both baselines and every affected outbox/history write must remain atomic.

Stop conditions:

- Stop and repair if planning or preparation writes data, unknown fields or IDs pass validation, the target or anchor resolves outside the intended day, retry moves twice, either day can change after preview without fresh confirmation, or any partial mutation/history/outbox state commits.

Result:

- Added `item.move@1` with semantic target, optional semantic source day, required semantic destination day, and fixed first/last/before/after placement.
- Deterministic Chinese commands support Arabic and common Chinese day ordinals and stay fully local; unambiguous cross-day moves make no Provider request.
- Validation rejects unknown fields, internal IDs, same semantic source/destination, missing destination anchors, multiple moves, and plans that mix move/create/reorder structural writes.
- Preparation resolves the target and any anchor only inside their intended days, then captures complete source and destination membership/order baselines.
- Execution atomically compacts the source day, inserts into the destination day, updates the moved item's `dayId`, queues every changed item, and appends stable-ID Trip Intelligence history.
- Moving to another day clears any completed/skipped execution state instead of carrying a stale onsite status into the new date.
- A failed outbox/history side effect rolls back the full move. A retry checks the persisted operation marker and both final day orders before returning idempotently.
- Any source or destination membership/order change after preview becomes a fresh-confirmation error without a partial write.
- The compact preview's single `确认执行` button is now the final confirmation; the redundant second confirmation dialog was removed across registered write actions.
- Mock planning rejects unresolved cross-day targets instead of substituting an unrelated repair action.
- Added 390px E2E coverage proving details stay folded, only one confirmation click is exposed, neither day changes before confirmation, the final order is correct, and Provider Proxy is never called.

Validation:

- Focused Action Gateway, Provider, repository, and tracked-mutation run passed: 6 files and 74 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1496 tests.
- `npm run build` passed; bundle budget passed at 852.7 KiB initial JS, 245.8 KiB gzip, and 2274.7 KiB/94-entry precache.
- Focused 390px cross-day move E2E passed.
- The full serial E2E run passed all 149 tests in approximately 7.1 minutes.
- `git diff --check` passed.
- Read-only protected-boundary reviews found stale execution state, blocked idempotent replay, mock misrouting, duplicate confirmation, in-flight command contamination, and concurrent retry defects; execution-scoped state guards, a synchronous action mutex, and delayed double-click E2E coverage resolved every reported issue.
- The final review found no remaining high- or medium-risk issue.

Residual:

- Deletion remains outside the registry until its undo and ticket-binding behavior has an explicit contract.
- Cross-day move preserves the item's existing transport fields and ticket bindings; it does not infer new transport details.
- Real Provider planning remains intentionally uncalled; deterministic planning, schema/privacy boundaries, confirmation, rollback, idempotency, and stale-state behavior are covered locally and with mocks.

## 2026-07-26 Universal AI Action Gateway V1.5 - Reversible Item Delete And Unified Undo

Status: merged to `main` at `2117432` through PR #22.

Branch: `feature/action-gateway-delete-undo`

Goal:

- Delete one semantically selected itinerary item through the registered Action Gateway without deleting its tickets, ledger links, transport records, or blobs, and restore that deletion through one shared, durable undo contract used by AI and manual deletion.

Scope:

- Add `item.delete@1` with an optional semantic day and required semantic item target; no database IDs, arbitrary patches, or Provider-selected functions.
- Add `history.undo@1` with the fixed `item_delete` kind and an optional semantic item target; resolve the latest unique applicable operation locally.
- Preserve ticket metadata, ticket blobs, ledger references, and transport data while the item is absent.
- Store complete before/after day snapshots in the existing synced operation-record table, with explicit operation kind, fingerprint, and item scope.
- Atomically delete/restore the item, normalize the full day order, enqueue item and operation sync, and persist a stable Trip Intelligence marker.
- Reject delete or undo when the relevant item/day state changed after preview; retries must never delete or restore twice.
- Route existing manual item deletion through the same reversible service and provide a compact immediate undo affordance in the day timeline.
- Keep one final confirmation in the global AI surface and deterministic local planning for explicit delete/undo commands.

No-go:

- No ticket metadata/blob deletion, booking cancellation, refund, payment, ledger mutation, transport mutation, day/trip deletion, bulk deletion, or permanent purge.
- No Provider call for deterministic delete/undo commands.
- No Provider-supplied record ID, item ID, route, function, snapshot, operation fingerprint, or internal status.
- No new IndexedDB table, Supabase table, object-sync type, or production database migration.
- No real AI, map, route, search, cloud, or Provider calls.

Likely files:

- `src/types.ts`
- `src/db/repositories.ts`
- `src/db/trackedMutations.ts`
- `src/lib/itemDeletion.ts`
- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- `server/providerProxy/actionPlanProvider.ts`
- `src/components/trip/DayTimelineView.tsx`
- Focused repository, sync, planner, validation, runtime, component, and E2E tests plus roadmap/status updates.

Validation:

- Focused reversible-delete, sync/history, Action Gateway, Provider, and component tests.
- Typecheck, lint, full unit suite, production build, focused 390px E2E, full serial E2E, PWA upgrade coverage, and `git diff --check`.

Risk:

- High: deletion removes a synced core object and undo resurrects it, while tickets and financial references must remain untouched and cross-device operation history must converge.

Stop conditions:

- Stop and repair if any ticket/blob, ledger, booking, or transport record is deleted or changed.
- Stop and repair if deletion/undo writes before confirmation, accepts an ID/snapshot from Provider, replays twice, ignores changed day state, or commits partial item/history/outbox state.
- Stop and repair if generic replan UI consumes item-delete operation records as adaptive replans or if remote operation payloads lose the undo snapshot.

Result:

- Added `item.delete@1` and `history.undo@1` with strict semantic-only inputs, fixed local-write risk, one deletion/undo per plan, structural-write separation, and no Provider-selected IDs, snapshots, fingerprints, statuses, routes, or functions.
- Deterministic Chinese delete and undo commands stay local. Commands involving tickets, bookings, payments, refunds, ledger entries, or whole-trip deletion remain outside the registered deletion path.
- The reversible repository contract captures complete day/item snapshots and full-content fingerprints, compacts the remaining day order, rejects stale item/day state, and restores the exact original item order.
- Manual and AI deletion now use the same outer IndexedDB transaction for the item mutation, changed-order item upserts, operation record, object-sync outbox/state, and Trip Intelligence history.
- Ticket metadata, ticket blobs, ledger links, orders, and transport records remain untouched while an item is absent and remain linked after restoration.
- Delete and undo retries verify the durable operation marker plus the full applied or restored snapshot before returning idempotently; concurrent stale executions require a fresh preview and confirmation.
- Existing adaptive-replan consumers now explicitly ignore item-deletion operation records, while object sync preserves operation kind, scope, delete/apply fingerprints, and undo fingerprint.
- The day timeline uses the shared reversible service and shows a compact immediate undo action. Item-detail deletion uses the same contract and both surfaces explain that related records remain.
- Added 390px E2E coverage proving one final confirmation, no Provider call, no pre-confirmation write, preserved ticket/ledger records, exact order restoration, folded details, and no horizontal overflow.

Validation:

- Focused reversible-delete, sync/history, Action Gateway, Provider, component, and affected-page tests passed: 9 files and 182 tests; targeted runtime/tracked-mutation reruns passed 40 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 185 files and 1506 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2285.3 KiB/94-entry precache.
- Focused 390px delete/undo E2E passed.
- The full serial E2E run passed all 150 tests in approximately 5.8 minutes, including PWA upgrade and desktop Beta smoke coverage.
- `git diff --check` passed.
- A protected-boundary review found and resolved an invalid nested Dexie transaction-table argument and test-suite timing instability; the final local review found no remaining high- or medium-risk issue.

Residual:

- Undo is intentionally rejected after the affected day changes again; the user must generate a fresh operation instead of overwriting later edits.
- Preserved ticket and ledger references can temporarily point to an absent item until undo, but their metadata, files, financial state, and source links remain intact.
- Real Provider planning remains intentionally uncalled; deterministic planning, mock Provider normalization, schema/privacy boundaries, confirmation, rollback, idempotency, concurrency, and stale-state behavior are covered locally.

Remote verification:

- PR #22 checks passed: Lint, Type Check, Unit Tests, Build, E2E Tests, and Cloudflare Pages.
- The post-merge `main` GitHub Actions run passed all five jobs for `2117432d6967de629dc8a0e679e49b014a144e9f`.
- Cloudflare Pages deployed the same commit successfully.
- Supabase project `rfpcooafakuvgrdlfxpg` remained `ACTIVE_HEALTHY`; schema lint returned no warning-level errors. Existing migration-history drift was recorded without production writes.

## 2026-07-26 Universal AI Action Gateway V1.6 - Live State And Replan Preferences

Status: merged to `main` at `68ad822` through PR #23.

Branch: `feature/action-gateway-live-state-preferences`

Goal:

- Let a traveler mark a semantic itinerary item completed, skipped, or active again and update its bounded replan preferences through the registered Action Gateway with one confirmation, durable history, idempotency, and stale-item protection.

Scope:

- Add `item.execution.update@1` with a required semantic item target, optional semantic day, and fixed `completed`, `skipped`, or `active` state.
- Add `item.replan.preference.update@1` with a required semantic item target, optional semantic day, and only the existing fixed preference enums plus bounded buffer/minimum-stay minutes.
- Deterministically recognize explicit Chinese completion, skip, restore, must-keep, movable, optional, weather, mobility, buffer, and stay-duration commands without a Provider call.
- Resolve item/day scope locally, reject ambiguity, and show a short before/after preview with one final confirmation.
- Commit the item update, object-sync entry, stable Trip Intelligence operation marker, and history in one IndexedDB transaction.
- Treat a repeated execution as idempotent only when the durable marker and complete intended item state match.
- Reject execution if the target item changes after preview; independent stale commands must not overwrite each other.
- Keep existing Live Mode controls and compatibility router working while registered commands take precedence.

No-go:

- No arbitrary item patch, title/note/address/coordinate mutation, route generation, deletion, ticket/blob mutation, ledger/order/payment mutation, or Provider-selected function.
- No Provider-supplied item/day ID, timestamp, execution metadata, history ID, operation fingerprint, or database field.
- No automatic completion or skipping based on the clock, location, Provider output, or model inference.
- No new IndexedDB/Supabase table, cloud contract, route-cache contract, ticket/blob contract, or production migration.
- No real AI, map, route, search, cloud, or Provider calls.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- `src/lib/itemStateUpdates.ts`
- `server/providerProxy/actionPlanProvider.ts`
- Focused planner, validation, runtime, transaction, Provider, and 390px E2E tests plus project status/roadmap updates.

Validation:

- Focused state/preference, sync/history, Action Gateway, Provider, and affected compatibility tests.
- Typecheck, lint, full unit suite, production build, focused 390px E2E, full serial E2E, PWA upgrade coverage, and `git diff --check`.

Risk:

- Medium-high: both actions change synced onsite behavior and future replan decisions, so semantic targeting, stale-item checks, transactional history, and idempotent retries must remain exact.

Stop conditions:

- Stop and repair if planning/preparation writes data, Provider fields escape the registry, an action writes without confirmation, a stale item is overwritten, a retry creates duplicate history, or item/outbox/history can partially commit.

Result:

- Added `item.execution.update@1` with semantic item/day targets and fixed `completed`, `skipped`, and `active` states. No time, location, or model inference can change progress automatically.
- Added `item.replan.preference.update@1` with only the existing flexibility, priority, weather, and mobility enums plus bounded buffer and minimum-stay minutes.
- Deterministic Chinese completion, skip, restore, fixed/movable/optional, weather, mobility, buffer, and stay commands stay local and take precedence over the compatibility router.
- Validation allows one bounded item-state write per plan and rejects unknown fields, internal IDs, timestamps, arbitrary patches, invalid enums, fractional/out-of-range minutes, and mixed local writes.
- Provider prompts and mock planning expose only registered semantic fields. Malicious Provider responses containing item IDs, timestamps, patches, histories, or fingerprints fail normalization.
- Preparation performs read-only semantic resolution, rejects ambiguous or missing targets, captures the exact item `updatedAt`, and produces a compact before/after preview.
- Execution commits the item, trip timestamp, object-sync outbox/state, and stable Trip Intelligence marker/history in one IndexedDB transaction. Outbox failure rolls back the complete operation.
- Retries require both the durable marker and intended final item state; a changed target requires a fresh preview and confirmation instead of overwriting the user.
- Added a 390px browser flow proving details remain folded, each write exposes one final confirmation, no data changes before confirmation, and deterministic commands make no Provider request.

Validation:

- Focused Action Gateway, compatibility router, Provider contract/handler/client, and item-state transaction run passed: 9 files and 248 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 186 files and 1520 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2289.1 KiB/94-entry precache.
- Focused 390px progress/preference E2E passed.
- The full serial E2E run passed all 151 tests in approximately 5.7 minutes, including PWA upgrade and desktop Beta smoke coverage.
- `git diff --check` passed.
- A read-only protected-boundary review found negated/question commands could be misread as writes and quoted targets could lose precedence to positional words. Both were fixed; concurrent replay and preference-only stale baselines gained regression coverage, and the final review found no remaining high- or medium-risk issue.

Residual:

- The actions intentionally update one item at a time; bulk progress changes and free-form field patches remain outside the registry.
- Restoring `active` clears the completed/skipped status but does not infer a new time, order, route, or live-mode event.
- Real Provider planning remains intentionally uncalled; deterministic planning, mock Provider normalization, field allowlists, confirmation, rollback, idempotency, and stale-item behavior are covered locally.

Remote verification:

- PR #23 checks passed: Lint, Type Check, Unit Tests, Build, E2E Tests, and Cloudflare Pages.
- The post-merge `main` CI run `30210896226` passed all five jobs for `68ad822f06e9fcebe0a61b353f976b857c2ec950`.
- Cloudflare Pages deployed the same commit successfully.
- Supabase project `rfpcooafakuvgrdlfxpg` remained `ACTIVE_HEALTHY`; schema lint returned no warning-level errors. The previously recorded migration-history drift was unchanged and no production write was made.

## 2026-07-27 Universal AI Action Gateway V1.7 - Adaptive Disruption Replan

Status: implemented and locally validated; pending merge and remote verification.

Branch: `feature/action-gateway-adaptive-replan`

Goal:

- Turn an explicit traveler-reported delay, late arrival, closure, cancellation, or unsuitable-weather event into a local real preview and one-confirmation adaptive replan through the registered Action Gateway.

Scope:

- Add `trip.replan.apply@1` with a fixed disruption-kind enum, optional bounded delay minutes, optional semantic item/day target, and fixed registered strategy values only.
- Deterministically recognize explicit Chinese late/delay/closure/cancellation/weather commands; hypothetical or interrogative what-if commands remain read-only in the compatibility preview and never write.
- Resolve the affected item/day locally, build the actual adaptive-replan option from current trip, ticket, ledger, and preference data, and show only a short impact preview.
- Require one final confirmation before creating a disruption event, applying item patches, and persisting a reversible replan record.
- Commit affected items, event, applied replan record, object-sync outbox/state, trip timestamp, and stable Trip Intelligence history in one IndexedDB transaction.
- Use a full local baseline covering trip/day/item state, replan preferences, ticket bindings, and ledger impacts; reject any change after preview.
- Make retries idempotent only when the durable marker, event, record, and complete final item snapshot agree.
- Keep tickets, blobs, ledger entries, bookings, payments, and transport orders unchanged; surface their impacts as warnings only.

No-go:

- No Provider-selected item/day/event/record ID, patch, snapshot, timestamp, route, database field, function, evidence, or free-text note.
- No automatic inference from clock, geolocation, weather Provider, route Provider, or background state; the user must explicitly report the disruption.
- No ticket/blob deletion, booking cancellation, refund, payment, ledger mutation, cloud permission change, or whole-trip deletion.
- No real AI, map, route, search, cloud, or Provider calls.
- No IndexedDB/Supabase schema change, object-sync type change, route-cache contract change, or production migration.

Likely files:

- `src/lib/ai/actionGateway/types.ts`
- `src/lib/ai/actionGateway/registry.ts`
- `src/lib/ai/actionGateway/validation.ts`
- `src/lib/ai/actionGateway/planner.ts`
- `src/lib/ai/actionGateway/runtime.ts`
- `src/lib/adaptiveReplanActions.ts`
- `src/lib/adaptiveReplanning.ts`
- `server/providerProxy/actionPlanProvider.ts`
- Focused planner, validation, runtime, adaptive-replan transaction, Provider, compatibility, and 390px E2E tests plus roadmap/status updates.

Validation:

- Focused adaptive-replan, sync/history, Action Gateway, Provider, and compatibility tests.
- Typecheck, lint, full unit suite, production build, focused 390px E2E, full serial E2E, PWA upgrade coverage, and `git diff --check`.

Risk:

- High: one confirmation may update several synced itinerary items and create durable event/history records, while financial, ticket, booking, and transport data must remain untouched.

Stop conditions:

- Stop and repair if hypothetical text writes data, a Provider field escapes the registry, preparation writes, a stale baseline executes, a retry applies twice, protected related data changes, or any item/event/record/outbox/history subset can partially commit.

Result:

- Registered `trip.replan.apply@1` with bounded disruption kinds, semantic day/item targets, delay minutes, and three fixed strategies; no Provider-selected IDs, patches, fields, functions, routes, or persistence data enter execution.
- Explicit traveler-reported disruptions produce a real local preview. What-if, assumptions, embedded questions, factual negations, protected cancellation language, and negated action commands remain read-only.
- Provider plans are validated against both the action registry and the original command in the client and Provider Proxy, rejecting legal-but-unrelated actions and partial downgrades of whole-trip repair requests.
- Explicit Chinese and ISO dates resolve as day targets. A delay that crosses midnight produces a short manual-handling warning instead of silently rewriting another day.
- Only business-changed items are persisted. Relevant-day membership, trip, day, item, preferences, ticket metadata, and ledger impacts are protected by the confirmation baseline.
- Apply and undo commit item changes, disruption event, replan record, object-sync outbox/state, trip timestamp, and stable Trip Intelligence history atomically. Undo restores only this replan's changed items.
- Idempotent replay requires the durable marker, event, record, strategy, and complete final snapshot to agree; partial or stale state is rejected.
- Tickets, blobs, ledger entries, bookings, payments, transport orders, cloud permissions, and schemas remain unchanged. No real Provider or cloud call was made.

Validation:

- Focused Action Gateway and adaptive-replan unit runs passed, including negation, Provider semantic binding, stale baselines, cross-midnight behavior, atomic rollback, changed-only persistence, and idempotent retry coverage.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1546 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2293.3 KiB/94-entry precache.
- Focused Action Gateway and desktop Beta smoke E2E passed all 19 tests at 390px and 1440px.
- The full serial E2E run passed all 152 tests in approximately 5.7 minutes, including PWA upgrade and desktop Beta smoke coverage.
- `git diff --check` passed before final staging.

Review:

- Two read-only protected-boundary reviews identified negation ambiguity, legal-but-unrelated Provider actions, date targeting, cross-midnight handling, overbroad undo scope, non-atomic outbox writes, unchanged item persistence, and insufficiently explicit previews.
- Each issue was repaired with focused regression coverage before the full validation run.

## 2026-07-28 Travel Inbox Bounded Batch Import

Status: merged and remotely verified.

Branch: `fix/travel-inbox-batch-import`

Goal:

- Make the real UK itinerary material folder importable without duplicate files, one Provider request per file, quota storms, or dozens of confirmation previews.

Scope:

- Deduplicate local-folder files by SHA-256 content while retaining path fingerprints for incremental scans.
- Resolve uniquely matching trips locally before using AI classification.
- Combine up to 120 assigned sources into one preview, split Provider payloads into at most two 60-source requests, and namespace merged candidate IDs.
- Limit automatic cloud-source processing to two concurrent requests and keep multi-trip automatic batches within the same two-call budget.
- Preserve every account-source reference on the combined preview and remove every source only after the existing final confirmation succeeds.
- Clean temporary inbox entries after partial Provider failure so retry does not duplicate extracted material.
- Add one compact mobile bulk target/action row and keep the existing per-source fallback.

No-go:

- No automatic itinerary write, ticket deletion, cloud permission change, Provider contract change, schema version bump, or production migration.
- No raw ticket/blob payload in Provider requests beyond the existing extracted-text contract.
- No real AI, map, route, search, cloud, or Provider call during local validation.

Result:

- A 78-file folder now fits one account-source batch and one final preview while Provider requests stay bounded to two calls.
- Exact duplicate content under different paths is queued once.
- Successful batch apply completes all local/cloud source references; stale-baseline and final-confirmation behavior remains unchanged.
- A failed second Provider request removes temporary entries and leaves the original account sources available for retry.
- The 390px account inbox shows one `整理 N 项` action without horizontal overflow.

Validation:

- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1550 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2300.3 KiB/94-entry precache.
- Focused mobile Travel Inbox E2E passed all 3 tests.
- The full serial E2E run passed all 153 tests in approximately 5.9 minutes, including PWA upgrade and desktop Beta smoke coverage.
- `git diff --check` passed.

Residual:

- A batch that expands beyond 120 extracted sources is returned for manual assignment instead of silently omitting material.
- More than 120 account sources are handled in later bounded batches.

Remote verification:

- PR #26 merged to `main` as `701c90318d4e3e05ab608660e67fd185d7e10887`.
- The same-SHA GitHub Actions run `30342360466` passed Type Check, Unit Tests, Lint, Build, and all 153 serial E2E tests.
- Cloudflare Pages deployed the same commit successfully.

## 2026-07-28 Travel Inbox Real-Data Preflight Hardening

Status: merged and remotely verified.

Branch: `fix/travel-inbox-manual-batch`

Goal:

- Remove the remaining local-file ingestion failures found while preparing the requested real UK itinerary import.

Scope:

- Treat Markdown files as local text sources in manual uploads and persistent folder scans.
- Process one manual multi-file selection as one local extraction and at most one existing-trip Provider request instead of one request per file.
- Track extraction failures by input position so duplicate file names cannot hide a failed source.
- Keep the 20 MB local extraction boundary, but record and display a compact skipped-item count instead of silently dropping oversized files.
- Preserve the existing extracted-text-only Provider contract and final confirmation gate.

No-go:

- No Provider contract, IndexedDB schema version, cloud sync, ticket/blob storage, or AI privacy-boundary change.
- No automatic itinerary write and no real Provider call during implementation validation.
- No silent import of oversized files into offline storage.

Validation:

- Focused extraction, local-folder, and Travel Inbox component tests.
- Typecheck, lint, full unit suite, production build, focused 390px E2E, full serial E2E, and `git diff --check`.

Risk:

- Medium: the change expands a user-selected import batch and local source coverage while retaining existing privacy, quota, and confirmation boundaries.

Stop conditions:

- Stop and repair if a manual file selection triggers more than one Provider request, a source file is sent instead of extracted text, a failed source is lost, an oversized folder file is silently omitted, or any itinerary data changes before final confirmation.

Result:

- Manual multi-file upload now performs one local extraction and one optional Provider recognition for up to 60 selected files.
- Markdown materials are accepted by both manual upload and persistent local-folder scanning.
- Failed files are associated by stable input position, including duplicate file names, and remain retryable as error entries.
- Oversized supported folder files remain outside local extraction and storage, but the connector now records a concise skipped-item status instead of silently dropping them.
- Provider requests remain extracted-text only, and imported itinerary changes still require the existing final confirmation.

Validation:

- Focused extraction, local-folder, and Travel Inbox component tests passed: 3 files and 23 tests.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1554 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2300.8 KiB/94-entry precache.
- Five focused 390px Travel Inbox E2E tests passed, including two-file single-request recognition and final-confirmation protection.
- The full serial E2E run passed all 153 tests in approximately 5.7 minutes, including PWA upgrade and desktop Beta smoke coverage.
- `git diff --check` passed.

Remote verification:

- PR #27 merged to `main` as `f5e9d7fd4413ffb1ef954fe27c03f2483df9ddce`.
- The same-SHA GitHub Actions run `30345527088` passed Type Check, Unit Tests, Lint, Build, and E2E Tests.
- Cloudflare Pages deployed the same commit successfully.

## 2026-07-28 Real UK Workbook OOXML Compatibility

Status: merged and remotely verified.

Branch: `fix/real-import-preflight`

Goal:

- Make the real UK itinerary workbook readable by the same local extraction path used by Travel Inbox.

Scope:

- Accept optional XML namespace prefixes on workbook, relationship, shared-string, worksheet, row, cell, value, and text tags.
- Preserve support for existing unprefixed workbook fixtures and relative relationship targets.
- Add a generated namespace-prefixed OOXML regression fixture with an absolute worksheet target.
- Verify the existing real HTML plan and current UK workbook through a temporary local-only preflight without Provider or account writes.

No-go:

- No workbook content, personal file path, extracted personal text, or temporary preflight fixture committed to the repository.
- No Provider, cloud, account, IndexedDB schema, ticket/blob, or confirmation-boundary change.

Result:

- The current UK workbook now yields a local spreadsheet source with no extraction warning.
- The existing HTML plan remains locally extractable.
- The requested older `20260624.xlsx` file is still absent; only the newer `20260709.xlsx` workbook is available locally.
- The ticket folder contains 78 files and 49 unique hashes; one 39.6 MB album PDF remains above the explicit 20 MB extraction boundary.

Validation:

- Focused workbook extraction tests passed: 8 tests, including the namespace-prefixed OOXML fixture.
- The temporary real-data preflight passed and was deleted before staging.
- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1555 tests.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2301.0 KiB/94-entry precache.
- One unrelated Ticket Library setup timeout passed immediately in isolation; the complete serial rerun then passed all 153 tests in approximately 5.9 minutes.
- `git diff --check` passed.

Risk:

- Low: parsing broadens only accepted OOXML tag spelling and does not change Provider data, persistence, or write behavior.

Remote verification:

- PR #28 merged to `main` as `465d08ba10727dcb7e743f69ded86841270ee727`.
- The same-SHA GitHub Actions run `30347936823` passed Type Check, Unit Tests, Lint, Build, and all 153 serial E2E tests.
- Cloudflare Pages deployed the same commit successfully.

## 2026-07-28 PWA Upgrade Recovery Matrix

Status: merged and remotely verified.

Branch: `feature/pwa-upgrade-recovery-matrix`

Goal:

- Extend the real-build PWA evidence from one adjacent update to repeated release upgrades and storage-pressure recovery without losing IndexedDB data or serving partial runtime assets.

Scope:

- Exercise one installed PWA through three sequential service-worker revisions, including an offline IndexedDB edit between releases.
- Verify every update remains waiting until the existing final user confirmation, all open tabs converge on the selected release, and local data survives each activation.
- Apply an explicit Chromium origin quota during an on-demand asset fetch, verify the app still receives the complete network response, and ensure no incomplete runtime entry is retained.
- Restore storage headroom, retry the same asset, and verify one complete cached response remains available offline.
- Keep the current Workbox cache names, expiration policy, precache boundary, and application update UI unchanged.

No-go:

- No production Provider, cloud, account, route, search, map, AI, or storage calls.
- No Service Worker cache-policy change, IndexedDB schema change, sync contract change, or user-visible UI change.
- No fixture that depends on a historical production artifact or mutable remote deployment.

Likely files:

- `e2e/pwa-upgrade.spec.ts`
- `docs/BETA_QA_RECORD.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`

Validation:

- Production build and focused built-dist PWA E2E.
- Repeated focused stability run.
- Typecheck, lint, full unit suite, full serial E2E, and `git diff --check`.

Risk:

- Medium: browser quota APIs and service-worker activation races can make a weak test look green or flaky unless exact controller versions, response byte lengths, cache entries, and IndexedDB markers are checked.

Stop conditions:

- Stop and repair if an update activates before confirmation, tabs remain on mixed versions, an offline edit disappears, a quota failure returns partial data as successful, a partial asset enters cache, or retry cannot restore offline availability.

Result:

- Added a two-tab `v1 → v2 → v3` real-build sequence. Both updates remain waiting until the existing update button is confirmed, then every tab reloads onto the selected controller version.
- An IndexedDB marker created on v1 and edited while v2 is offline remains unchanged after v3 activation and both document reloads.
- Applied a real Chromium origin quota with only 64 KiB headroom before requesting the MapLibre chunk. The complete network response still reaches the app and no partial runtime-cache entry remains.
- Resetting the quota allows the existing interrupted-download check and a complete retry to succeed; the exact complete byte length remains available offline.
- Hardened the content-enrichment component test wait against full-suite scheduler pressure after validation exposed a transient timeout that could leak unfinished requests into the next test.
- No application cache policy, UI, IndexedDB schema, sync contract, Provider boundary, or production data changed.

Validation:

- `npm run typecheck` passed for the app, Provider runtime, and Travel Inbox Worker.
- `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1555 tests. The initially exposed content-enrichment timing failure passed in isolation and after the bounded wait hardening.
- `npm run build` passed; bundle budget passed at 868.3 KiB initial JS, 249.6 KiB gzip, and 2301.0 KiB/94-entry precache.
- Focused built-dist PWA E2E passed all 4 tests; a five-repeat stability run passed all 20 executions.
- The full serial E2E run passed all 154 tests in approximately 6.1 minutes.

Remote verification:

- PR #29 merged to `main` as `1990dcb28b0487772dd7e923274107f37a20891c`.
- The same-SHA GitHub Actions run `30350154086` passed Type Check, Unit Tests, Lint, Build, and E2E Tests.
- Cloudflare Pages deployed the same commit successfully.

## 2026-07-28 Offline Account Sync Recovery

Status: merged and remotely verified.

Branch: `feature/offline-sync-recovery`

Goal:

- Prove that an authenticated Beta PWA keeps offline itinerary edits local, then automatically resumes the existing one-to-one account sync when connectivity returns without duplicate uploads or lost object changes.

Scope:

- Seed a matching local trip and account fixture, then edit the trip and one itinerary item while Chromium reports offline.
- Verify the account fixture stays unchanged, the local object outbox remains pending, and the local edit remains readable offline.
- Restore connectivity through the browser network state and let the existing `online` handler resume auto snapshot and object sync.
- Verify the account snapshot and object rows contain the edited values, pending outbox entries are removed, auto-sync state becomes synced, and a reload preserves the local edit.
- Keep all cloud behavior inside the existing E2E Supabase fixture.

No-go:

- No real Supabase, Provider, AI, map, route, search, ticket/blob, or production call.
- No cloud overwrite semantics, object merge rules, outbox schema, IndexedDB schema, auth contract, or user-visible UI change.
- No forced timer shortcut that bypasses the real browser `offline` / `online` transition.

Likely files:

- `e2e/cloud-backup.spec.ts`
- `docs/BETA_QA_RECORD.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`

Validation:

- Focused cloud-backup E2E and repeated recovery stability run.
- Typecheck, lint, full unit suite, production build, full serial E2E, and `git diff --check`.

Risk:

- Medium: the test must distinguish true online-event recovery from a direct helper upload and must assert both snapshot and object-sync state so a partially successful path cannot pass.

Stop conditions:

- Stop and repair if any account fixture changes while offline, a pending object disappears before upload, online recovery duplicates an object, the outbox remains stuck after success, auto state reports synced before cloud state changes, or reload loses the local edit.

Result:

- Added an authenticated account fixture with one stable one-to-one cloud backup plus local trip/day/item records.
- A real Chromium offline transition now proves trip and itinerary-item edits remain in IndexedDB, enqueue exactly two object mutations, and do not change the account snapshot or object rows.
- Restoring connectivity through the browser network state exercises the existing `online` handler without a direct upload helper.
- Online recovery updates the existing snapshot in place, writes exactly one trip and one item object row, drains the outbox, marks the auto snapshot synced, and preserves both edits after reload.
- The stable cloud backup ID uses the production hash contract so the fixture cannot accidentally model a historical duplicate as the current one-to-one backup.
- No application code, IndexedDB schema, cloud contract, Provider boundary, real account, or production service changed.

Validation:

- The focused recovery test passed and a ten-repeat stability run passed 10/10.
- The complete `e2e/cloud-backup.spec.ts` passed all 13 tests.
- `npm run typecheck` and `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1555 tests.
- `npm run build` passed; bundle budget remained at 868.3 KiB initial JS, 249.6 KiB gzip, and 2301.0 KiB/94-entry precache.
- The first full serial E2E run had one unrelated AI draft `beforeEach` navigation timeout; that test passed in isolation and in a ten-repeat run.
- A clean full serial E2E rerun passed all 155 tests in approximately 5.9 minutes.

Remote verification:

- PR #30 merged to `main` as `f825112b634e522bdd9ee49e250bc916fdaf7aed`.
- The same-SHA GitHub Actions run `30352682116` passed Type Check, Unit Tests, Lint, Build, and E2E Tests.
- Cloudflare Pages deployed the same commit successfully.

## 2026-07-28 Historical PWA Production Migration Matrix

Status: implemented and locally validated; pending merge and remote verification.

Branch: `feature/pwa-historical-migration-matrix`

Goal:

- Prove that actual production source revisions can migrate through their generated Service Workers on one browser origin into the current candidate without forcing activation or losing real TripMap IndexedDB data.

Scope:

- Generate production Vite/PWA distributions from the fixed, previously deployed `main` revisions `4c8f60ec93d2029e6b13b89b27a3b8855d8bf847` and `4c7489352f0d8ddb6195c1b61727a9a845fbbd4a`.
- Serve each immutable build in sequence on one local origin, followed by the current candidate `dist`.
- Create a real sample trip in the first historical build, make an offline IndexedDB edit after the first migration, and verify the current build still opens the edited trip.
- Verify each new worker remains waiting until the product update action, open tabs converge after confirmation, and obsolete precache versions are cleaned.
- Keep CI able to resolve the pinned historical commits without downloading mutable deployment artifacts.

No-go:

- No real Cloudflare deployment download, Provider, AI, map, route, search, account, Supabase, ticket/blob, or production data call.
- No application Service Worker policy, IndexedDB schema, cloud sync contract, update UI, or runtime cache behavior change.
- No moving branch/tag selector, shallow-history fallback, synthetic replacement app, or unpinned remote release input.

Likely files:

- `e2e/pwa-upgrade.spec.ts`
- `.github/workflows/ci.yml`
- `docs/BETA_QA_RECORD.md`
- `docs/PROJECT_STATUS.md`
- `docs/ROADMAP_V4.md`

Validation:

- Focused historical production migration E2E and repeated stability run.
- Existing built-dist PWA suite.
- Typecheck, lint, full unit suite, production build, full serial E2E, and `git diff --check`.

Risk:

- Medium: historical source must build reproducibly with the pinned lock-compatible toolchain, and swapping asset roots must not create a transient mixed release that hides a real migration failure.

Stop conditions:

- Stop and repair if a pinned revision is missing, a historical build differs from its declared commit, a worker activates before confirmation, tabs remain split, the sample trip or offline edit disappears, obsolete precaches survive the final activation, or CI needs a mutable network artifact.

Result:

- Added a history builder that validates each fixed commit, Git tree, and package-lock object before extracting the source and running its actual Vite/PWA production build.
- The older lock installs with its own checked-in `.npmrc`; dependency reuse is isolated by lock-object cache, while the matching current lock reuses the workspace installation.
- CI E2E checkout now has full Git history so the pinned revisions resolve without a branch/tag fallback or mutable deployment download.
- Added one same-origin browser matrix from deployed `4c8f60ec` to deployed `4c748935`, then to the current candidate distribution.
- Both transitions remain waiting while two tabs stay on the old controller, then converge only after the existing `更新并重启` action.
- A real sample trip created in the first historical app survives both migrations. Its title, edited directly in IndexedDB while the middle release is offline, remains visible and opens in the current candidate.
- The final release leaves exactly one active precache, proving obsolete historical precaches were cleaned.
- No application Service Worker policy, IndexedDB schema, update UI, cloud/provider contract, production service, or real user data changed.

Validation:

- The focused historical migration passed; a five-repeat stability run passed 5/5.
- `npm run test:e2e:pwa-upgrade` passed all 5 tests.
- `npm run typecheck` and `npm run lint` passed.
- `npm run test:unit` passed: 187 files and 1555 tests.
- `npm run build` passed; bundle budget remained at 868.3 KiB initial JS, 249.6 KiB gzip, and 2301.0 KiB/94-entry precache.
- The full serial E2E run passed all 156 tests in approximately 7.3 minutes.
- `git diff --check` passed.

## 2026-08-05 UI V3 S1-S3 Structural Qualification

Status: implemented and locally validated; final branch-head remote, physical-device, and production qualification pending.

Branch: `feature/ui-v3-selected-target`

Goal:

- Close the M6 structural plan without changing visible behavior, Golden output, data contracts, Provider contracts, or AI write protections.

Result:

- S1 split Settings and Ticket Library into route entries, controller hooks, ViewModels, and presentation components.
- S2 split Trip, Day, and Item data aggregation, view models, menus, map loading, and presentation boundaries.
- S3 split Global AI orchestration from its command-bar shell and split AI Draft into request-form state, Provider/draft orchestration, and focused map, variant, import, and workspace views.
- Action Gateway registry validation, privacy filtering, real preview, one final confirmation, stale-state protection, idempotency, and failed-step retry behavior remained unchanged.
- No IndexedDB/Supabase schema, sync semantics, route cache, ticket/blob storage, Provider contract, secret, or real Provider call changed.

Commits:

- S1: `1d6dfb4`, documentation receipt `73fe5af`.
- S2: `e9aedaa`, `fb5abf8`, `012ed76`.
- S3: `193b8ca`, `3a9fb8c`.

Validation:

- `npm run typecheck`, `npm run lint -- --quiet`, and `npm run build` passed.
- `npm run test:unit` passed: 191 files and 1578 tests.
- AI Draft focused unit tests passed 118/118; AI Draft, form, and Golden focused E2E passed 47/47.
- `npm run test:e2e:serial` passed 175/175 in approximately 6.6 minutes.
- `npm run test:e2e:pwa-upgrade` passed 5/5 in approximately 46 seconds.
- Bundle budget passed at 468.2 KiB entry, 852.4 KiB initial JS, 245.5 KiB initial gzip, and 2337.3 KiB/114-entry precache.
- S1 remote baseline `73fe5af` passed GitHub Actions run `30992807064` and Cloudflare Pages Preview deployment `4e2542bd-19b8-442d-90b8-8f1697dad436`.
- Final candidate `0b464be` passed GitHub Actions run `30998260337`; Lint, Type Check, Unit Tests, Build, and E2E Tests all passed, with E2E completing in approximately 5 minutes 28 seconds.
- Cloudflare Pages Preview deployment `d2399786-4796-431f-8f9b-3e4311ea5a26` is Active for the same `0b464be` source revision.

## 2026-08-06 UI V3 Product Fidelity P0-P8

Status: in progress.

Branch: `feature/ui-v3-product-fidelity`

Goal:

- Implement the complete `UI_V3_PRODUCT_FIDELITY_PLAN.md` contract so the four core travel surfaces derive their density and visual quality from real, attributable media, structured travel objects, sourced realtime facts, direct document actions, and road-aware maps.

Scope:

- P0: freeze one deterministic product-fidelity fixture, a design-to-code difference ledger, and a media rights manifest.
- P1-P3: add versioned media, brand, travel-object, and realtime-fact contracts; controlled adapters; shared presentation components; and Provider Proxy boundaries.
- P4-P6: add explainable document linking, one-confirmation writes, direct ticket opening, route-aware map details, and the selected Today, Trip, Documents, and Item Detail compositions.
- P7-P8: finish responsive states, accessibility, motion, performance, design-target comparison, full automated validation, simulator qualification, and remote release receipts.

No-go:

- No generated or untraceable image may impersonate a real place, hotel, ticket, carrier, insurer, route, or current fact.
- No arbitrary remote media URL, AI-selected logo, private ticket blob, OCR body, secret, Provider payload, or internal network address may cross the media boundary.
- No stale or source-less fact may be presented as current; no write may bypass Action Gateway preview, one final confirmation, idempotency, or stale-state protection.
- No return to card walls, persistent AI copy, stacked bottom surfaces, decorative gradients, or placeholder density.

Likely files:

- `src/types.ts`, `src/db/*`, `src/lib/media/*`, `src/lib/realtime/*`, `src/lib/travelObjects/*`
- `server/providerProxy/*`, `src/lib/ai/providerProxyContract.ts`
- `src/components/home/*`, `src/components/trip/*`, `src/components/documents/*`, `src/pages/ItemDetailPage.tsx`, `src/components/DayMap.tsx`, `src/index.css`
- `e2e/fixtures/product-fidelity-v1.json`, `e2e/assets/product-fidelity/*`, focused unit/component/E2E tests, and Golden/design comparison tooling
- `docs/UI_V3_PRODUCT_FIDELITY_BASELINE.md`, project status/roadmap/release evidence, and licensed fixture media

Validation:

- Per-phase focused unit, contract, component, and E2E tests plus `git diff --check` before each phase commit.
- Final typecheck, lint, full unit suite, production build, full serial E2E, built-dist PWA migration suite, fixed viewport design comparison, light/dark and 200% text checks.
- iPhone Simulator Safari/home-screen PWA and Android Emulator Chrome/WebView qualification; physical devices remain optional.
- After push, verify the same SHA in GitHub Actions, Cloudflare Pages, and relevant Supabase/provider diagnostics without exposing secrets or raw responses.

Risk:

- High: the work crosses media security, Provider contracts, cloud-compatible object semantics, ticket permissions, route rendering, responsive composition, and release validation. Each protected boundary remains isolated behind versioned schemas, deterministic mocks, focused tests, and a phase receipt.

Stop conditions:

- Stop the affected phase if rights cannot be verified, a remote asset can escape the Provider allowlist, a migration loses or rewrites existing data, an AI/provider response can select an arbitrary resource or function, a write bypasses confirmation/stale guards, a realtime fact lacks source/expiry, or a core viewport overflows or stacks fixed surfaces.

P0 result:

- Added the canonical four-scenario `product-fidelity-v1` fixture with one coherent 12-day UK trip, structured flight/rail/lodging/insurance/document records, explainable links, route geometry, and sourced realtime facts.
- Added seven licensed photo variants and four reviewed brand marks under the E2E-only asset boundary; production builds do not copy or precache the fixture media.
- Recorded author, source, license, derivative operation, integrity hash, dimensions, and byte budget for every asset.
- Added a deterministic integrity checker that rejects missing or altered files, path escapes, unreviewed formats, oversized media, and executable/external SVG references.
- Added the design-to-code difference ledger with explicit Visual P0/P1/P2 ownership and allowed platform differences. Missing Provider data or missing fields remain open rather than approved.

P0 validation:

- `npm run check:fidelity-assets` passed for all 11 assets.
- Both JSON fixtures passed strict `jq` parsing; the canonical fixture contains 1 trip, 12 days, 9 key items, 6 documents, 7 media records, and 4 realtime facts.
- `git diff --check` passed.

P1 result:

- Added strict `TravelMediaAssetV1` and `BrandIdentityV1` contracts. Render references are limited to a Google Places photo resource name, a reviewed fixture asset ID, or an existing private ticket ID; arbitrary URLs and unknown fields are rejected.
- Added a controlled brand registry for Air China, LNER, National Rail, and Allianz. Unknown or URL-shaped values use a generic Lucide icon instead of selecting an unreviewed asset.
- Extended Place Details with a fixed photo field mask and normalized photo references, dimensions, Google attribution, and source links.
- Added a two-stage Place Photo proxy. It obtains a Google-issued media location, accepts only HTTPS Google media hosts, refuses redirects, streams at most 3 MB, rejects SVG and non-image MIME types, parses image dimensions from bytes, and returns private, `nosniff` media responses.
- Reused the existing Provider Proxy Auth, Origin, edge identity, place quota, daily budget, and kill-switch controls for `place_photo`; no Provider key, resolved media URL, or raw payload is returned to the client.
- Added `TravelObjectMedia`, `MediaFallback`, and `BrandMark` with fixed ratios, lazy loading, expired/error fallbacks, focal-point cropping, source attribution, and object URL cleanup.
- Kept licensed fidelity images under the E2E-only boundary. Production code resolves fixture IDs only when the existing E2E bypass build flag is enabled, and the normal production build does not copy the fixture photos.
- Updated the canonical fixture to the strict media contract and added a test proving every fixture media ID is registered exactly once.
- No IndexedDB/Supabase schema, ticket Blob semantics, AI write path, route cache, production fact claim, or real Provider call changed.

P1 validation:

- Focused media, brand, Provider contract/client/provider/handler, operations guard, and quota tests passed: 11 files and 156 tests.
- The canonical fixture contract test passed for all seven media records and the seven controlled fixture IDs.
- `npm run typecheck`, `npm run lint`, and `npm run build` passed.
- `npm run test:unit` passed: 198 files and 1617 tests.
- Bundle budget passed at 468.2 KiB entry, 852.4 KiB initial JS, 245.5 KiB initial gzip, and 2340.2 KiB/114-entry precache.
- `git diff --check` passed.

P2 plan:

- Goal: make flights, rail segments, lodging, insurance, admissions, and documents render from one versioned travel-object model instead of page-local filename and note heuristics.
- Scope: add optional schema-compatible structured fields to existing ticket/transport records; define lodging and insurance input contracts without adding storage tables; normalize local transport imports with field evidence; build one collection/selectors for Today, Timeline, Documents, and Item Detail; validate the canonical fixture through the same builders.
- No-go: no IndexedDB version, Supabase migration, unencrypted PNR/order-number persistence, Provider call, ticket Blob/OCR-body exposure, automatic write, or page redesign in this phase.
- Likely files: `src/types.ts`, `src/lib/transportImport.ts`, `src/lib/travelObjects/*`, focused tests, the product-fidelity fixture, and only the minimal current import form wiring needed to retain normalized fields after confirmation.
- Validation: schema/normalization/privacy/ViewModel tests, import component tests, canonical fixture assertions, typecheck, lint, full unit suite, production build, and `git diff --check`.
- Risk: medium-high because optional record fields flow through IndexedDB and cloud object payloads even though no index or table changes.
- Stop conditions: stop and repair if a sensitive booking value leaves the encrypted vault, a page needs to parse raw Provider/import payloads, old records fail normalization, fixture objects need fabricated fields, or any optional field changes current sync semantics.

P2 result:

- Added versioned ticket display fields, transport field evidence, lodging/insurance input contracts, and one `TravelObjectViewModelV1` collection for Today, Timeline, Documents, and Item Detail consumers.
- Normalized local transport imports into carrier/airport/station codes, terminals/platforms, dates/times, and source confidence while keeping PNR, order number, and seat inside the encrypted booking secret.
- Extended existing-trip AI import with strict, provider-safe ticket date/time/category fields. Unknown fields and private identifiers are rejected or omitted; confirmed writes retain evidence and structured metadata.
- Added deterministic media, lodging, insurance, ticket, flight, rail, and encrypted-secret records to the canonical fixture and validated every record through production parsers/builders.
- Ticket metadata updates now preserve structured fields when older callers omit the new property, while an explicit `undefined` still clears it. Object-sync field merge now tracks the structured ticket object and reports divergent edits as one resolvable conflict.
- No IndexedDB schema/version, Supabase table, ticket Blob contract, route cache, real Provider call, or automatic write behavior changed.

P2 validation:

- Focused import, contract, privacy, repository, sync-merge, Provider normalization, and fixture ViewModel tests passed: 9 files and 76 tests.
- `npm run typecheck` and `npm run lint` passed.
- `npm run test:unit` passed: 200 files and 1635 tests.
- `npm run build` passed; bundle budget remained at 468.4 KiB entry, 852.6 KiB initial JS, 245.6 KiB initial gzip, and 2347.2 KiB/114-entry precache.
- `npm run check:fidelity-assets`, strict fixture JSON parsing, and `git diff --check` passed.

P3 plan:

- Goal: make every user-visible current weather, opening, route ETA, flight/rail, and ticket status consume one strict `RealtimeFactV1` contract with source, observation time, expiry, confidence, and a controlled opaque reference.
- Scope: add kind-specific fact schemas, TTL policy, selection/stale fallback, a bounded cache, and compact source/freshness UI; adapt current Place Details and Route Preview results; add an authenticated Open-Meteo weather operation plus mock/disabled modes; adapt flight/rail and ticket status through the same contract without overwriting booking or ticket records.
- Provider boundary: weather requests contain only a controlled subject, coordinates, location label, date, and IANA time zone. The proxy uses one fixed HTTPS host, rejects redirects/unknown fields/oversized or malformed responses, and reuses existing Origin, Auth, edge quota, daily budget, kill switch, and sanitized error handling.
- No-go: no new IndexedDB or Supabase schema, raw Provider body, arbitrary source URL, AI-selected fact/resource ID, background polling, automatic itinerary write, order/ticket mutation, or unlabelled mock/expired state.
- Likely files: `src/lib/realtime/*`, `src/components/realtime/*`, `src/lib/ai/providerProxyContract.ts`, `src/lib/providerProxyClient*`, `server/providerProxy/weatherProvider.ts`, `server/providerProxy/providerProxyHandler.ts`, Provider guard/quota tests, current Place/Route/flight adapters, and the canonical fixture contract test.
- Validation: schema/TTL/cache/privacy tests; Place/Route/Weather/flight/rail/ticket adapter tests; weather Provider normalization and handler Auth/Origin/quota/budget/kill-switch tests; component tests for current/stale/unavailable states; typecheck, lint, full unit suite, production build, and `git diff --check`.
- Risk: high because a new real network operation crosses the Provider Proxy and current-fact claims can mislead users if timestamps, source, or fallback state are wrong.
- Stop conditions: stop and repair if a fact without a source or expiry validates, an expired fact renders as current, Provider input can select a URL or internal ID, redirects or oversized payloads are followed, privacy fields cross the request, mock data loses its label, or a fact mutates durable travel data.

P3 result:

- Added a strict, versioned `RealtimeFactV1` union for current/forecast weather, place opening, route ETA, flight/rail status, and ticket readiness. Every fact requires a controlled subject, allowlisted source, observation/expiry times, confidence, bounded opaque reference, and a kind-specific TTL.
- Added current/stale/future selection, a bounded validated cache with stale fallback, and deterministic adapters for Place Details, Route Preview, flight/rail snapshots, and local ticket readiness. No adapter writes back to durable travel records.
- Added the authenticated `weather_forecast` Provider Proxy operation with deterministic mock/disabled modes and a fixed-host Open-Meteo adapter. The adapter refuses redirects, caps responses at 512 KiB, requests one date and a fixed field set, and returns only strict request-bound facts.
- Reused shared Origin, Auth, edge quota, account/IP/global daily budgets, the new isolated `weather` quota group and kill switch, short error semantics, and sanitized diagnostics. Unknown fields, URL/provider selection, sensitive context, malformed values, source mismatches, duplicate kinds, and excessive TTLs fail closed.
- Added a compact one-line source/freshness component for current, stale, and unavailable states. It exposes neither raw references nor Provider diagnostics and remains width-bounded at the 320px floor.
- Added a Cloudflare D1 migration that preserves existing usage/control/alert rows while extending only the constrained Provider group enum with `weather`; this is required so the existing fail-closed daily budget path works in production. No IndexedDB/Supabase schema, booking/ticket record, route cache, automatic write, background polling, raw Provider payload, or real Provider call changed.

P3 validation:

- Focused realtime contract/cache/adapter/UI, weather contract/provider/handler/client, diagnostics, operations guard, and quota tests passed: 13 files and 86 tests.
- `npm run typecheck` and `npm run lint` passed.
- `npm run test:unit` passed: 209 files and 1696 tests.
- `npm run build` passed; bundle budget remained at 468.4 KiB entry, 852.6 KiB initial JS, 245.6 KiB initial gzip, and 2357.7 KiB/114-entry precache.
- `npm run check:fidelity-assets` and `git diff --check` passed.
- The D1 `0002 -> 0003` in-memory migration check preserved existing usage, alert, and disabled-control state, added the enabled weather control, and accepted weather usage and alert rows.

P4 plan:

- Goal: connect imported ticket/document metadata to the correct itinerary object through explainable local matching, one Action Gateway confirmation, direct ticket opening, and a shared link status consumed by the travel-object ViewModel.
- Scope: add a strict non-persistent document-link contract and deterministic matcher; register `ticket.bind@1` with semantic-only inputs; add real prepare/preview/execute behavior with per-record stale guards, idempotency, partial retry, and tracked sync writes; expose a bounded multi-ticket suggestion plan for import completion; retain exact local ticket navigation and ambiguous gallery fallback.
- No-go: no IndexedDB or Supabase schema, ticket Blob/OCR-body read, arbitrary URL/provider call, internal ID in Provider-planned args, original-file mutation, order cancellation, permission bypass, silent overwrite of an existing binding, or write outside the Action Gateway confirmation path.
- Likely files: `src/lib/documentLinking/*`, `src/lib/travelObjects/*`, `src/lib/ai/actionGateway/*`, `server/providerProxy/actionPlanProvider.ts`, focused fixture/contract/runtime tests, and only minimal ViewModel fields required to expose confirmed/suggested/conflict state.
- Validation: link schema and scoring tests; ambiguous/conflict/long-name/privacy cases; Action Gateway registry, validation, planner, Provider mock, confirmation, stale-state, idempotency, partial retry, and permission-preserving tests; canonical fixture validation; typecheck, lint, full unit suite, production build, fidelity asset check, and `git diff --check`.
- Risk: high because binding updates both ticket metadata and itinerary ticket IDs and then enters object sync, while Provider planning must remain restricted to semantic targets.
- Stop conditions: stop and repair if any unconfirmed write occurs, a stale or pre-bound ticket is silently overwritten, a Provider can select an internal ID or unknown field, matching reads ticket contents, a failed step repeats a successful write, item/ticket references diverge, or member visibility is widened.

P4 result:

- Added a strict, versioned, non-persistent `TravelDocumentLinkV1` contract and deterministic metadata matcher. Existing references become confirmed links; bounded text/date/time/category evidence can produce suggestions or conflicts without reading ticket Blobs, OCR bodies, arbitrary URLs, or Provider payloads.
- Registered `ticket.bind@1` in the shared Action Gateway with semantic ticket and itinerary names only. Deterministic and Provider planners reject unknown fields, internal IDs, URLs, ambiguity, and implicit writes; import completion can prepare at most six non-conflicting targets under one final confirmation.
- Added real prepare, compact preview, transactional execute, direct exact-ticket navigation, Trip Intelligence history, object-sync tracking, persisted idempotency, and partial retry behavior. The original file, structured fields, title, note, category, and assigned-member visibility are preserved.
- Added atomic ticket, previous-item, and target-item baselines around the reciprocal ticket/item update. Global trip fingerprints and repository-level compare-and-write checks both require a fresh preview when either side changes; missing or ambiguous prior links fail before any write.
- Exposed confirmed, suggested, and conflict link state through the shared travel-object ViewModel and updated the canonical product-fidelity fixture to the versioned evidence contract. No IndexedDB/Supabase schema, ticket Blob format, Provider contract outside the registered action plan, permission model, or real Provider call changed.

P4 validation:

- Focused repository, Action Gateway runtime, and ticket-binding-plan tests passed: 3 files and 70 tests.
- `npm run lint` passed; `npm run test:unit` passed with 211 files and 1712 tests.
- `npm run build` passed, including typecheck and bundle budget: 469.1 KiB entry, 853.4 KiB initial JS, 245.8 KiB initial gzip, and 2359.2 KiB/114-entry precache.
- `npm run check:fidelity-assets`, strict fixture JSON parsing, and `git diff --check` passed.
- The complete mobile Global AI command-bar E2E spec passed at `390x844`: 20 tests, including one-confirmation binding, pre-confirmation no-write, exact-ticket navigation, assigned-member visibility preservation, stale-plan rejection, and partial retry without duplicate success writes.

P5 plan:

- Goal: make the day map an honest, route-aware travel surface with real cached road geometry, a visibly distinct active segment, numbered stops, current location, one coherent place sheet, and short route degradation states.
- Scope: add a pure day-map experience ViewModel derived from ordered itinerary objects and the existing `RouteCacheEntry`; render road/mixed/estimated/unavailable states and source freshness without exposing cache keys; add a transport-aware active-route overlay to both MapLibre and Google adapters; reuse the existing explicit route generator for a user-triggered recalculation; unify external navigation, transport duration, ticket count, exact ticket entry, and place detail in the selected-stop sheet; extend deterministic map E2E with seeded road geometry, active segment, location, refresh, degradation, canvas, fit-bound, and overlap assertions.
- No-go: no route-cache database version, signature, expiry, provider request/response, quota, authentication, map-key, realtime-fact, itinerary, ticket, or cloud-sync contract change; no background route call, raw Provider error, straight line styled or labelled as a road route, user location persisted, second bottom Sheet, or real Provider request during local validation.
- Likely files: `src/lib/dayMapExperience.ts`, `src/lib/mapEngine.ts`, `src/lib/maplibreAdapter.ts`, `src/lib/googleMapsAdapter.ts`, `src/components/DayMap.tsx`, `src/components/trip/DayMapView.tsx`, `src/components/trip/DayWorkspaceView.tsx`, focused unit/component tests, `e2e/map-v3-visual.spec.ts`, `e2e/map-floating-info.spec.ts`, and the existing product-fidelity route fixture only if its shape needs alignment.
- Validation: pure ViewModel route/status/navigation tests; map engine and component tests for active geometry, transport mode, explicit refresh, failure fallback, exact ticket entry, and compact text; `320x568` through `1440x900` layout checks; MapLibre canvas/marker/route/location/controls/single-Sheet assertions; route request counts; typecheck, lint, full unit suite, production build, fidelity asset check, and `git diff --check`.
- Risk: medium-high because the map has two engine adapters and camera padding must remain stable while route status and place-sheet content change; route refresh touches the existing local cache through the established generator.
- Stop conditions: stop and repair if route generation occurs without a user action, a failed refresh discards valid cached geometry, current location expands a far-away itinerary viewport, straight geometry receives road styling, cache/provider internals enter product copy, a ticket opens without the current item scope, or any overlay/Sheet/control overlaps at a required viewport.

P5 result:

- Added one pure day-map experience ViewModel that orders mapped stops, derives numbered markers, active transport mode, ticket count, external navigation, route metrics, and honest `road | mixed | estimate | unavailable` presentation from the existing itinerary and route-cache contracts.
- Added transport-aware active-route overlays to both MapLibre and Google adapters. Cached road geometry remains visually distinct from dashed sequence estimates; straight lines are never labelled or styled as road routes.
- Kept route generation strictly user-triggered through the compact route-status control. A failed refresh preserves the last valid cache or current estimate, returns a short message, and can be retried without a background Provider call.
- Consolidated date/sequence, time, transport duration, address, ticket count, exact-ticket entry, external navigation, and item detail into one selected-place Sheet. The Sheet keeps one primary navigation action and uses a compact `详情` command at narrow widths.
- Connected ephemeral current location without persisting it or allowing a far-away coordinate to expand the trip camera. Added measured camera padding for the date selector, route status, location control, notice, and Sheet.
- Aligned the canonical fixture so day road geometry and the optional origin connector are separate semantic objects. No route-cache schema/signature, Provider contract, quota/authentication, realtime-fact, itinerary, ticket, or cloud-sync contract changed.

P5 validation:

- Focused map-link, day-map ViewModel, and DayMapView tests passed: 3 files and 38 tests.
- Product-fidelity map E2E passed for seeded road geometry, active walking segment, numbered stops, current location, nonblank map canvas, exact ticket opening, zero background Provider requests, failed-refresh preservation, retry, and successful road-route replacement: 2 tests.
- Existing floating-info and V3 map suites passed together with the product map suite: 10 tests on the `Mobile 390x844` project. The V3 suite additionally validated `320x568`, `390x844`, `430x932`, `768x1024`, and `1440x900` with no horizontal overflow or overlay/Sheet/control overlap.
- A deterministic `390x844` light-mode capture was visually inspected; the map remained the full-bleed primary surface, real route geometry remained legible, and the selected-place Sheet retained a single dominant action.
- `npm run typecheck`, `npm run lint`, and `npm run test:unit` passed: 212 files and 1720 tests.
- `npm run build` passed with the bundle budget at 469.1 KiB entry, 853.5 KiB initial JS, 245.8 KiB initial gzip, and 2370.1 KiB/114-entry precache.
- `npm run check:fidelity-assets`, strict fixture JSON parsing, and `git diff --check` passed.

P6 plan:

- Goal: recompose pre-departure Today, active Today, the day itinerary, Documents, and Item Detail around the shared travel-object, media, brand, realtime-fact, document-link, and map ViewModels so the selected four-screen target is reflected by real product data rather than page-local heuristics.
- Scope: add a read-only presentation runtime that combines existing trips/days/items/tickets with transport bookings and segments, controlled media, optional lodging/insurance inputs, and bounded realtime facts; expose the same collection to all five surfaces; add a compact preparation composition, media-led active stop, media timeline rows, structured document metadata, and media/detail reuse; add deterministic product-fidelity E2E and captures at the canonical `390x844` state.
- Runtime data boundary: normal product media can come only from private ticket previews, validated cached media, or a photo reference returned for an already-confirmed Places identity through the existing Provider Proxy. E2E-only lodging, insurance, media, and realtime inputs use one strict session fixture envelope gated by the existing E2E build flag; production bundles do not import fixture JSON or its assets.
- Interaction contract: each first viewport retains one primary action; AI, Search, More, filters, repair details, and technical tools stay on demand; missing rich data collapses naturally to the existing object fields without placeholder copy or fabricated images/facts.
- No-go: no IndexedDB/Supabase schema, ticket Blob format, transport/cloud semantics, Provider request/response, media allowlist, realtime TTL, Action Gateway confirmation, route cache, navigation route, or write behavior change; no arbitrary URL, unverified logo, source-less current fact, page-local raw Provider parsing, background location lookup for an unconfirmed place, or effect-image data embedded in production components.
- Likely files: `src/lib/travelObjects/*`, `src/lib/media/*`, one presentation hook, shared travel-object presentation components, `HomePage`/Today views, `DayViewPage`/timeline, ticket library rows, Item Detail, focused tests, `e2e/helpers.ts`, and a dedicated product-fidelity composition spec.
- Validation: runtime schema/privacy/cache tests; component tests for sparse/rich/long states and action priority; canonical four-screen E2E at `390x844`; required viewport no-overflow checks; no unexpected Provider calls with complete fixture data; visual comparison against the selected target; typecheck, lint, full unit suite, production build, fidelity asset integrity, and `git diff --check`.
- Risk: medium-high because five routes must consume one display model without widening sensitive fields, creating fetch loops, breaking ticket previews, or regressing fixed mobile surfaces.
- Stop conditions: stop and repair if fixture-only records enter production paths, private fields cross Provider-safe summaries, an unknown media/fact passes validation, page load triggers lookup for an unconfirmed place, a ticket/media action loses its exact object scope, a sparse page invents density, or any required viewport overflows or shows more than one dominant action.

P6 result:

- Added one read-only presentation runtime that combines existing trip records, transport bookings/segments, private ticket-image previews, validated media cache, sourced realtime facts, and a strict E2E-only supplement envelope. The envelope rejects unknown fields, cross-trip data, oversize input, invalid media/facts, and sensitive extras.
- Added a bounded media cache and a controlled Google Place Details photo adapter. Automatic media lookup is attempted only for an item that already has a confirmed `placeId`; missing or failed media stays absent without inventing a replacement or exposing Provider diagnostics.
- Rebuilt pre-departure Today around structured route, flight, lodging, insurance, weather, and one primary itinerary action. Rebuilt active Today around a real-media next-stop Hero, countdown, transport, exact ticket action, one navigation action, and the existing real map.
- Added media-led continuous day timeline rows, structured Documents metadata and link status, brand fallback for travel documents without a viewable page, and a real-media Item Detail Hero. Sparse records retain the prior compact text layouts.
- Added E2E-only build emission for seven licensed WebP fixtures. A normal production build contains no fixture directory or fixture reference in the service worker; no fixture JSON or licensed test photo is imported by production components.
- Added deterministic five-surface browser coverage at `390x844`. The complete fixture produced zero Provider requests, loaded all expected media, retained exact ticket scope, kept one primary action, and had no horizontal overflow.

P6 validation:

- New cache, Place-photo, strict runtime-envelope, and shared ViewModel tests passed: 4 files and 10 tests.
- Focused page/component regressions passed: 4 files and 39 tests.
- Product-fidelity composition E2E passed: 5/5 for pre-departure Today, active Today, itinerary, Documents, and Item Detail; all five captures were visually inspected.
- `npm run typecheck`, `npm run lint -- --quiet`, and `npm run test:unit` passed: 215 files and 1726 tests.
- Normal `npm run build` passed at 469.4 KiB entry, 853.8 KiB initial JS, 245.9 KiB initial gzip, and 2441.5 KiB/120-entry precache. The increased entry and precache remain within the existing budget.
- `npm run check:fidelity-assets`, normal-build fixture exclusion checks, and `git diff --check` passed.
