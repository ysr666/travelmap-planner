# TripMap Phase Ledger

This ledger records autonomous iteration phases. Each phase is bounded before edits begin, then updated with validation and follow-up notes after completion.

## 2026-06-14 - Phase 12F-mini: Timezone Boundary Hardening

Status: completed

Goal:

- Align implemented Trip / Day / Item timezone support with tests and docs.
- Close safe local validation gaps around cross-timezone item dates and timezone inference fallback behavior.

Scope:

- Add a guard so cross-timezone itinerary item arrival dates cannot be earlier than the current day date.
- Add focused tests for the itinerary item timezone form and timezone inference helper using mocked provider proxy behavior.
- Update timezone audit docs to describe the current implemented baseline.

No-go:

- No IndexedDB or Supabase schema changes.
- No real provider, AI, search, route, map, cloud, or mailbox calls.
- No route cache, provider proxy contract, AI privacy, ticket/blob, or cloud semantic changes.

Likely files:

- `src/components/ItineraryItemForm.tsx`
- `src/components/ItineraryItemForm.test.tsx`
- `src/lib/timeZoneInference.test.ts`
- `docs/TIMEZONE_AUDIT.md`

Validation:

- `npm run test:unit -- src/components/ItineraryItemForm.test.tsx src/lib/timeZoneInference.test.ts src/lib/timeZone.test.ts`
- `npm run build`
- `npm run lint`
- `npm run test:unit`
- Relevant E2E only if code impact expands beyond form/helper behavior.

Risk level: low

Stop conditions:

- Validation failure points into protected schema/cloud/provider boundaries.
- A fix requires real provider calls or migration semantics.
- Unrelated user-owned tracked changes appear.

Result:

- Added the missing autonomous-iteration default to `AGENTS.md`: long runs should continue through multiple safe, high-value phases and may include Codex-designed improvements within roadmap boundaries.
- Added a cross-timezone itinerary form guard so arrival date cannot be earlier than the current Day date.
- Added mock-only `timeZoneInference` tests for empty query, missing proxy config, coordinate-based inference, and provider failure fallback.
- Updated `docs/TIMEZONE_AUDIT.md` to reflect the current Trip / Day / Item timezone baseline.

Validation:

- `npm run test:unit -- src/components/ItineraryItemForm.test.tsx src/lib/timeZoneInference.test.ts src/lib/timeZone.test.ts` passed.
- `npm run build` passed with existing bundle size warning.
- `npm run lint` passed.
- `npm run test:unit` passed: 141 files, 1195 tests.
- `npm run test:e2e -- e2e/full-page-forms.spec.ts` passed: 6 tests.

## 2026-06-14 - Phase 13B-mini: Marker-triggered Day Map Card

Status: completed

Goal:

- Move Day View map interaction closer to the roadmap target: marker click opens a lightweight item card, and the card opens Item Detail.
- Add focused test coverage for the marker-card interaction path.

Scope:

- Keep DayMapView marker card hidden until a marker is selected.
- Close marker card without leaving stale selected-card state.
- Fix the DayMapView unit-test mock so it uses the real `onSelectItem` prop.
- Add tests for no automatic card, marker-triggered card display, close, and open-item behavior.

No-go:

- No MapLibre lifecycle rewrite.
- No route cache signature or route-generation behavior changes.
- No real map, route, provider, search, AI, cloud, or browser geolocation calls.
- No visual redesign beyond the interaction state.

Likely files:

- `src/components/trip/DayMapView.tsx`
- `src/components/trip/DayMapView.test.tsx`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- `npm run test:unit -- src/components/trip/DayMapView.test.tsx`
- `npm run build`
- `npm run lint`
- `npm run test:unit`
- Relevant Day View E2E only if unit coverage exposes broader behavior changes.

Risk level: low-medium

Stop conditions:

- Fix requires MapLibre adapter lifecycle changes.
- Fix requires route cache/provider behavior changes.
- Validation failure points outside local marker-card interaction.

Result:

- Day Map marker card no longer appears automatically when the map becomes ready.
- Selecting a marker opens the lightweight item card; closing the card also clears the selected marker state.
- DayMapView unit tests now mock the real `onSelectItem` prop and cover marker-triggered card display, item-detail open, and close behavior.
- Map floating-info E2E now matches the marker-triggered product flow by explicitly selecting markers before asserting card content.

Validation:

- `npm run test:unit -- src/components/trip/DayMapView.test.tsx` passed: 8 tests.
- `npm run build` passed with existing bundle size warning.
- `npm run lint` passed.
- `npm run test:unit` passed: 141 files, 1197 tests.
- Initial `npm run test:e2e -- e2e/map-floating-info.spec.ts` failed because old assertions expected an automatic marker card.
- Updated E2E expectations to the new marker-triggered behavior.
- Re-run `npm run test:e2e -- e2e/map-floating-info.spec.ts` passed: 7 tests.
- Final `npm run lint` after E2E edits passed.

## 2026-06-14 - Phase 15A: SwiftUI-like Design System Baseline

Status: completed

Goal:

- Establish `docs/DESIGN_SYSTEM.md` so future UX phases have a shared visual and interaction baseline.
- Capture the current grouped-list, surface, sheet, form, map, and mobile QA rules without changing runtime code.

Scope:

- Document existing tokens and component conventions from `src/index.css` and `src/components/ui`.
- Define page composition rules for Trip Home, Day View, Item Detail, Ticket Library, Settings, and AI/provider surfaces.
- Update roadmap/status docs to mark Phase 15A complete.

No-go:

- No code, schema, cloud, provider, AI privacy, route cache, or ticket/blob behavior changes.
- No screenshots or visual assets.
- No broad copy rewrite outside docs.

Likely files:

- `docs/DESIGN_SYSTEM.md`
- `docs/ROADMAP_V4.md`
- `docs/PROJECT_STATUS.md`
- `docs/agent/PHASE_LEDGER.md`

Validation:

- `git diff --check`

Risk level: low

Stop conditions:

- Documentation requires product decisions that conflict with implemented UI.
- Documentation would imply protected schema/provider/cloud changes.

Result:

- Added `docs/DESIGN_SYSTEM.md` with the SwiftUI-like grouped-list, surface, button, form, sheet, map, Trip Home, Day View, Item Detail, Ticket Library, AI/provider, and visual QA rules.
- Updated `docs/ROADMAP_V4.md` to mark Phase 15A complete.
- Updated `docs/PROJECT_STATUS.md` to include the design system baseline in completed project status.

Validation:

- `git diff --check` passed.
