# Foundation Gap Review and Phase-2 Roadmap

Date: 2026-05-27
Baseline audited: local `main` at `f769379` after `git pull --ff-only`; no branches reported by `git branch --all --no-merged main`.
Scope: docs/planning review only. No app code, provider calls, cloud calls, schema changes, or test rewrites.

## A. Executive Summary

TripMap is close to a controlled limited beta for local-first trip planning, Day Map / Trip Home preview, ticket storage, zip backup, and one-to-one Supabase cloud save. The beta must not be positioned as booking software, realtime navigation, realtime sync, offline maps, autonomous AI editing, or guaranteed realtime search.

The largest pre-beta gaps are still operational and product-communication gaps: provider quota/key production smoke, Pages-runtime smoke for provider-backed features, Supabase RLS/storage smoke, final QA baseline, PWA refresh guidance, and beta user copy. Phase 2 should also continue the original product correction work: restore meaningful labels/content, make Trip Home central, finish map interactions, slim Item Detail, push the UI toward SwiftUI-like clarity, and improve Ticket Library presentation.

AI/search/provider foundations are real but still uneven. AI Draft generation and repair are beta-ready only after production-like smoke. AI Trip Edit, search-assisted edits, Tavily search, Google Places lookup, and route order suggestion should remain foundation-only or tightly gated until real browser Pages-runtime QA, source quality, quota, and user copy are stronger.

## B. Phase-2 Priority Table

| Priority | Area | Why it matters before/after beta | Recommended next task |
| --- | --- | --- | --- |
| P0 | Durable provider quota, key policy, and production smoke | Prevents provider abuse, spend surprises, and secret leaks for AI/search/place/route features. | `qa/provider-quota-production-smoke` |
| P0 | Supabase one-to-one cloud smoke | Cloud save is a user-trust feature and can overwrite local trips. RLS/storage must be verified with a beta account. | `qa/cloud-beta-smoke` |
| P0 | Beta user copy and caveats | Beta User Copy Pass was skipped; testers need clear promises and non-promises. | `docs/limited-beta-user-guide` |
| P0 | Final QA/release baseline | Mock-heavy coverage is broad, but real provider and device risks remain. | `qa/limited-beta-baseline` |
| P1 | AI Draft generation/repair Pages-runtime smoke | Preview/confirm boundaries exist, but real worker/browser behavior and D1 quota need proof. | `qa/ai-draft-pages-runtime-smoke` |
| P1 | AI Trip Edit production smoke/gate | It can edit real saved trips after confirmation, so it needs stricter beta gating than draft import. | `fix/ai-trip-edit-production-smoke` |
| P1 | Places/route Pages-runtime smoke after key separation | Direct smokes existed, but Pages-runtime smoke was skipped after key separation except earlier ORS route smoke. | `qa/places-route-pages-runtime-smoke` |
| P1 | PWA update/refresh guidance | Service worker stale-build behavior is a known QA/user risk. | `docs/pwa-beta-update-note` |
| P1 | Map/Trip Home/Day Map product completion | This preserves the original Trip Home centrality and marker-to-card intent. | `qa/map-beta-visual-pass` |
| P2 | Ticket Library and Item Detail polish | Mostly beta-usable, but original product direction expects grid/lightbox and compact item-bound tickets. | `qa/ticket-library-beta-pass` |
| P2 | Search source quality | Tavily adapter exists, but ranking, caching, official-source preference, and richer citations are Phase 2. | `feature/travel-search-phase2-sources` |
| P2 | SwiftUI-like design system | Needed to reduce the "AI-generated" feel, but not a beta blocker if main flows remain usable. | `docs/design-system-swiftui-pass` |

## User Original 13 Directions Mapping

| # | Original direction | Current status | What current code/docs cover | Missing / gap | Beta-critical or later | Suggested next task | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Home / overview should not be over-minimal | Partially done | Home and Trip Home have meaningful labels, counts, route/map/ticket entry points, and `PROJECT_STATUS` records that over-minimal simplification was corrected in Phase 12-pre-A/B and 12D. | Run a final copy/visual pass to catch labels that became too short or vague, including day labels and empty states. | P1 before beta copy freeze | `qa/home-overview-copy-density-pass` | Preserve clarity over clever shortening; avoid regressions like making day labels less understandable. |
| 2 | Settings entry menu is redundant | Done | Trip more-menu simplification and Settings route consolidation are reflected in current route/status docs; provider key settings are removed. | Confirm no remaining redundant entry menu on mobile QA. | P2 after core beta smoke | `qa/settings-entry-sanity-pass` | Keep Settings direct and boring; do not add provider-key submenus back. |
| 3 | Create trip / create item can move to dedicated pages | Done | Dedicated routes exist: `#/trip/new`, `#/trip/edit`, `#/item/new`, `#/item/edit`; forms moved away from cramped inline flows. | Keyboard/mobile form QA should continue as part of release baseline. | P1 release QA | `qa/full-page-form-mobile-pass` | This direction is mostly complete; treat future work as polish/regression prevention. |
| 4 | Rework trip page structure | Partially done | Trip Home, Day View, Item Detail, Ticket Library routes exist; Trip Home includes map preview; Day Map marker-card interaction is tested; route order suggestion is a preview/confirm flow. | Trip Home still needs stronger full-trip overview and clearer hierarchy; Day Map should continue moving toward marker -> light card -> detail; avoid old bottom-sheet dominance. | P1 | `qa/map-trip-home-day-view-completion-pass` | Central Trip Home remains the product anchor for Phase 2, not just a provider readiness item. |
| 5 | Add sync | Partially done | Supabase one-to-one save, manual upload/restore, auto-save foundation, startup/version checks, and conflict prompts exist. | This is cloud backup, not realtime sync. Need RLS/storage smoke, clearer beta copy, and a decision on whether "sync" should remain backup semantics for beta. | P0 | `qa/cloud-beta-smoke` | Later architecture deliberately changed "sync" into one-to-one overwrite backup semantics. Do not promise realtime sync. |
| 6 | Google Maps API loading/cache | Foundation only | Map preview and route cache exist; commercial map tiles are not cached; docs note no tile caching and service worker runtime caching is empty. | Need provider load/performance pass, legal/technical cache policy for Google/OpenFreeMap assets, and recenter/user-location work. | P2 unless map load blocks beta QA | `perf/map-loading-cache-policy-audit` | Cache only user-confirmed app data and route polylines where allowed; do not cache commercial tiles in the PWA service worker. |
| 7 | Generate routes after import based on transport mode; long-term transit hints | Foundation only | Manual route generation exists, local route cache exists, transport-mode mapping exists, Trip Home can warn routes need update; import route queue remains deferred. | Add post-import route generation queue that asks before spending quota; transit line/bus number hints remain long-term and source-dependent. | P2 after beta | `feature/import-route-generation-queue` | Must stay confirmation-gated and quota-aware; no silent provider calls after import. |
| 8 | Slim down item detail page | Partially done | Item Detail has dedicated page, item-bound tickets, prev/next navigation, place lookup confirmation, and ticket preview. | Needs clutter audit: prioritize time/place/transport/tickets/return-to-map, reduce miscellaneous controls, validate mobile density. | P2 after small beta | `feature/item-detail-slim-pass` | Product intent is on-site use, not admin-style editing density. |
| 9 | UI should feel less AI-generated, closer to SwiftUI | Foundation only | Several grouped-card and full-page layout corrections exist; roadmap records SwiftUI-like design-system direction. | Need `DESIGN_SYSTEM.md`, section/list/radius/shadow/button hierarchy rules, and a focused screen-by-screen visual pass. | P2, except severe overlap is P0/P1 | `docs/design-system-swiftui-pass` | This should guide future UI work, including beta copy and map/ticket pages. |
| 10 | Map page improvements | Foundation only | MapLibre, preview maps, route chip/controls, local route cache, marker-card tests, and fit behavior foundations exist. | Recenter, user location, exclude distant user location from fit bounds, zoom-adaptive lines/markers, and custom emoji markers remain. | P2 after beta baseline | `feature/map-controls-location-markers` | Keep user location separate from trip bounds when far away; do not imply navigation. |
| 11 | External API key / one-click trip generation / better AI prompts | Reconsidered | AI Draft generation/repair use app-provided server-side provider keys through provider proxy; prompt builders and validation exist; Settings does not expose provider key inputs. | Need production smoke, standardized prompt evolution, better generation provenance copy, and a clear decision that user-provided provider keys are out for beta. | P0/P1 for key policy, P2 for prompt quality | `fix/provider-key-policy-hardening` | Product direction changed: provider keys shifted from user-provided external keys to app-provided server-only keys for security and UX. |
| 12 | Improve ticket library display | Partially done | Ticket gallery cards, copy/reference/external storage modes, previewer, item-bound ticket summaries, and cloud/zip inclusion rules exist. | Need medium icon/grid polish around 3 per row, stronger full-screen lightbox feel, swipe/prev-next mobile QA, and compact item thumbnails for <=3 item-bound tickets. | P2 after small beta | `qa/ticket-library-beta-pass` | This is user-facing product polish, not only storage correctness. |
| 13 | AI-integrated PWA | Foundation only | AI Draft, repair, AI Trip Edit patch plan, AI privacy, provider proxy, Tavily travel_search, and Google Places lookup foundations exist. | Automatic search/display, attraction hero images, trip/attraction tips, rich citations, and proactive AI surfaces remain deferred until source quality, privacy, and provider quota are stronger. | P2/P3, with P0 safety gates for any enabled AI | `feature/ai-integrated-pwa-sourced-info` | Later architecture requires source-bearing search and confirmation gates; no unsourced realtime claims or autonomous writes. |

## C. Module-by-Module Gap Review

### 1. AI Draft Generation

- Current status: Beta-ready with caveats.
- What works now: Local mock draft, pasted JSON, provider proxy `ai_trip_draft`, JSON extraction, schema validation, preview, final import confirmation, and DeepSeek handler smoke.
- Phase-1 / mock / disabled / smoke-only: Provider button is disabled without proxy env; real provider validation is smoke-level; no web search; generated places/times still require user review.
- Missing Phase-2 work: Pages-runtime/browser smoke with D1 quota binding, no-write-before-import verification, no-secret/no-raw-output checks, better copy separating mock/manual/real AI sources.
- Beta risk: Users may overtrust draft quality or assume realtime facts.
- Recommended next task: `qa/ai-draft-pages-runtime-smoke`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Provider quota/key policy, beta AI copy, final QA baseline.

### 2. AI Draft Repair / Quality Guardrails

- Current status: Beta-ready with caveats.
- What works now: Local quality checker flags density, overlaps, short gaps, long days, missing locations, generic titles, missing meals, and missing transport; repair uses provider proxy, sanitized draft/findings, validation, preview update, and final import confirmation.
- Phase-1 / mock / disabled / smoke-only: Repair is disabled without proxy; findings are advisory; no ticket/OCR/web reading; real smoke is not a full production browser matrix.
- Missing Phase-2 work: Real repair Pages-runtime smoke, browser verification of note stripping/truncation, clearer before/after diff, optional user repair instruction UX polish.
- Beta risk: Users may treat repair as correctness guarantee.
- Recommended next task: `qa/ai-draft-repair-pages-runtime-smoke`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Provider quota/key policy, AI privacy copy, final QA baseline.

### 3. AI Trip Edit Patch-Plan Flow

- Current status: Foundation only.
- What works now: Trip Home builds sanitized saved-trip context, calls `ai_trip_edit_plan`, validates whitelist patch operations, shows diff preview, rejects stale previews, blocks ticket-bound deletion, and requires a second confirmation before IndexedDB writes.
- Phase-1 / mock / disabled / smoke-only: Not a chat agent; no undo/history; no autonomous tools; no route/ticket/cloud side effects; real browser Pages-runtime smoke is deferred.
- Missing Phase-2 work: Real-provider browser plus Pages-runtime smoke, operational beta gate/kill switch decision, focused E2E for stale state, ticket-bound items, and no side effects.
- Beta risk: It edits saved trips, so a provider or validation defect can affect real user data after confirmation.
- Recommended next task: `fix/ai-trip-edit-production-smoke`.
- Owner: Codex + Manual QA.
- Priority: P0 if enabled in beta, P1 if hidden.
- Dependencies: Provider quota/key policy, AI privacy network-log verification, beta copy.

### 4. AI Trip Edit Search Integration

- Current status: Foundation only.
- What works now: Detects explicit search intent, asks before sending, calls `travel_search` at most once, attaches up to 3 source summaries to edit planning, and displays source cards when source-bearing results exist.
- Phase-1 / mock / disabled / smoke-only: Search-assisted edit UX is minimal; richer citation/ranking and real-browser production smoke remain deferred.
- Missing Phase-2 work: Strong source card UX, retrieved-at display polish, official-source bias, clearer no-source warning, production smoke with real Tavily.
- Beta risk: Users may read sourced or mock snippets as complete realtime truth.
- Recommended next task: `fix/ai-trip-edit-search-beta-gate`.
- Owner: Codex + Claude QA.
- Priority: P1.
- Dependencies: Tavily Phase-2 source quality, beta search copy.

### 5. Tavily `travel_search`

- Current status: Foundation only.
- What works now: `travel_search` contract, validation, unsafe URL rejection, mock/disabled modes, server-only Tavily adapter, direct real adapter smoke, independent `search|` quota, and no-secret boundary.
- Phase-1 / mock / disabled / smoke-only: Source ranking/caching/official-source preference are Phase 2; real Pages/browser flow needs more smoke.
- Missing Phase-2 work: Official-source preference, dedupe, freshness policy, cache policy, source confidence tuning, failure telemetry.
- Beta risk: Bad source ranking can make AI-assisted edits look authoritative while being weakly sourced.
- Recommended next task: `feature/travel-search-phase2-sources`.
- Owner: Codex.
- Priority: P1.
- Dependencies: Durable quota, beta copy, source display UX.

### 6. Google Places Item Lookup

- Current status: Foundation only.
- What works now: Manual `place_lookup` from Item Detail, server-only Google Places key, strict FieldMask, transient candidates, confirmation before updating one item, and direct smoke/unit/E2E coverage.
- Phase-1 / mock / disabled / smoke-only: UI Pages-runtime smoke was skipped after key separation; separate server-side Places key policy remains a caveat; no opening hours/ratings/reviews/photos/phone/website persistence.
- Missing Phase-2 work: Deployed Pages-runtime smoke, key/billing policy proof, result quality copy, candidate disambiguation polish.
- Beta risk: Wrong candidate can overwrite location/address/coordinates for the item after user confirmation.
- Recommended next task: `qa/google-places-pages-runtime-smoke`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Provider key policy, D1 quota, Item Detail QA.

### 7. Route Generation / Route Preview

- Current status: Beta-ready with caveats.
- What works now: Manual Day Map and Trip Home route preview generation can use provider proxy; route cache is local-only; straight-line fallback works; ORS/Google server keys stay behind proxy; Trip Home generation is confirmation-gated.
- Phase-1 / mock / disabled / smoke-only: Transit/train/flight remain straight-line fallback; bus uses road approximation; Places / Route Pages Runtime Smoke was skipped after key separation except earlier ORS route smoke.
- Missing Phase-2 work: Pages-runtime route proxy smoke with ORS/Google after key cleanup, origin allowlist, quota/budget proof, and route limitation copy.
- Beta risk: Provider spend, partial failures, stale cache, user confusion with navigation.
- Recommended next task: `qa/route-proxy-pages-runtime-smoke`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Provider quota/key policy, PWA/update QA.

### 8. Route Order Suggestion

- Current status: Foundation only.
- What works now: `route_order_suggestion` server proxy exists; UI asks user to view suggestion, then confirm before applying current-day `sortOrder` changes; it does not write route cache/cloud/tickets or call AI/search.
- Phase-1 / mock / disabled / smoke-only: Real Google Routes smoke is deferred; v1 only uses Google Routes waypoint optimization; ORS optimization is deferred.
- Missing Phase-2 work: Real Google Routes smoke, cost/SKU policy, better warnings for non-coordinate items, route-order QA after provider-key separation.
- Beta risk: Unexpected reorder suggestions can disrupt a day plan if user confirms without understanding scope.
- Recommended next task: `qa/route-order-google-smoke`.
- Owner: Codex.
- Priority: P1.
- Dependencies: Google Routes server key policy, route quota, beta route copy.

### 9. Durable Provider Quota

- Current status: Foundation only.
- What works now: D1 quota foundation and D1 smoke passed; route/search/place/AI buckets are isolated; binding failures fail closed; raw IP/session are hashed.
- Phase-1 / mock / disabled / smoke-only: Cleanup jobs, account-level quota, admin observability, budget alerts, and deployed binding runbook remain deferred.
- Missing Phase-2 work: Production D1 migration/binding smoke, account/session/IP policy, expired-row cleanup job, admin dashboard/logs without sensitive payloads, budget alerting.
- Beta risk: Abuse, cost spikes, or accidental provider outage from quota misconfiguration.
- Recommended next task: `qa/provider-quota-production-smoke`.
- Owner: Codex.
- Priority: P0.
- Dependencies: Deployment environment, beta domain/origin list.

### 10. Provider Key Separation / Secrets

- Current status: Beta-ready with caveats.
- What works now: Server-only route/AI/search/place keys are designed for runtime env; Settings hides provider keys; frontend bundle does not use ORS/Google Routes/Places server keys; Google Maps JS key is treated as browser-visible and referrer-restricted.
- Phase-1 / mock / disabled / smoke-only: Production key restrictions, rotation policy, and post-key-separation Pages smoke are not complete.
- Missing Phase-2 work: Explicit env/key matrix, Google Maps JS domain restrictions, separate Google Routes vs Places keys, rotation plan, no-secret scans for production artifacts/reports.
- Beta risk: Key leakage or provider quota abuse.
- Recommended next task: `fix/provider-key-policy-hardening`.
- Owner: Codex.
- Priority: P0.
- Dependencies: Cloudflare/Supabase/Google project access and beta domain list.

### 11. Cloud One-to-One Save

- Current status: Beta-ready with caveats.
- What works now: Stable per-user/per-trip `backupId`, upsert overwrite, copy ticket upload, restore over same trip ID, manual delete, auto-save foundation, startup/version conflict prompts, and legacy multi-save display.
- Phase-1 / mock / disabled / smoke-only: Supabase RLS/storage beta smoke remains needed; no realtime sync; no E2E encryption; legacy records are not auto-migrated or cleaned.
- Missing Phase-2 work: Staging/prod smoke for upload, overwrite, restore, delete, copy-file restore warnings, legacy records, and RLS/storage isolation.
- Beta risk: Restore overwrites local data; RLS/storage misconfig can expose or block user data.
- Recommended next task: `qa/cloud-beta-smoke`.
- Owner: Codex + Manual QA.
- Priority: P0.
- Dependencies: Supabase beta account/project, seeded QA trips.

### 12. Ticket Library / Previewer

- Current status: Beta-ready with caveats.
- What works now: Ticket gallery cards, copy/reference/external modes, image/PDF/reference/external previewer, item-bound ticket summaries, zip/cloud inclusion rules for copy files.
- Phase-1 / mock / disabled / smoke-only: OCR, wallet import, booking integration, advanced filtering, and stronger full-screen/swipe polish are absent.
- Missing Phase-2 work: Medium icon/grid visual pass, full-screen lightbox polish, mobile prev-next/swipe QA, item-detail direct thumbnail/large icon treatment for <=3 tickets.
- Beta risk: Storage pressure and sensitive documents; external/reference tickets may not open reliably in PWA contexts.
- Recommended next task: `qa/ticket-library-beta-pass`.
- Owner: Manual QA + Claude QA.
- Priority: P2.
- Dependencies: Beta storage/privacy copy, mobile QA devices.

### 13. Map Views / Trip Home Preview / Day Map

- Current status: Beta-ready with caveats.
- What works now: Trip Home map preview, Day Map marker card interaction, summary-first collapsed sheet, route chip/controls, location fallback, no-auto-route behavior, and route cache.
- Phase-1 / mock / disabled / smoke-only: Full navigation, realtime traffic, user location/recenter, zoom-adaptive markers/lines, offline map tiles, and custom emoji markers are absent.
- Missing Phase-2 work: 390px and desktop visual QA, recenter/user-location policy, fit-bounds behavior when user is far away, zoom-adaptive line/marker styling.
- Beta risk: Device rendering issues and users expecting navigation/offline maps.
- Recommended next task: `qa/map-beta-visual-pass`.
- Owner: Manual QA + Claude QA.
- Priority: P1.
- Dependencies: Route smoke, PWA update QA.

### 14. PWA / Offline / Update Behavior

- Current status: Beta-ready with caveats.
- What works now: Vite PWA auto-update, app-shell precache, cleanup outdated caches, skip waiting, storage persistence request, no runtime tile caching.
- Phase-1 / mock / disabled / smoke-only: Offline routes/maps/cloud/search are absent; stale local service workers are a known QA issue; user-facing update guidance is weak.
- Missing Phase-2 work: Beta refresh/update note, staging service-worker update smoke, in-app update toast decision, zip-before-travel guidance.
- Beta risk: Users may see stale builds or expect offline capabilities that do not exist.
- Recommended next task: `docs/pwa-beta-update-note`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Beta user guide, staging deploy.

### 15. Privacy Controls

- Current status: Beta-ready with caveats.
- What works now: AI privacy settings default conservative; repair strips/truncates notes; Trip Edit context avoids exact coordinates, tickets, route cache, cloud status, provider keys, URLs, and full DB by default; ticket file content switch is disabled.
- Phase-1 / mock / disabled / smoke-only: Server does not enforce every client privacy preference beyond request shape validation; route/cloud/privacy copy is fragmented.
- Missing Phase-2 work: Browser network-log privacy verification for AI/search/place/route/cloud flows, concise beta privacy copy, clearer distinction between AI privacy settings and route/cloud provider data.
- Beta risk: Users may assume AI privacy settings also control route coordinates or cloud upload.
- Recommended next task: `docs/beta-privacy-copy`.
- Owner: Codex + Manual QA.
- Priority: P1.
- Dependencies: Provider smoke, cloud smoke, beta user copy.

### 16. E2E / QA / Release Process

- Current status: Beta-ready with caveats.
- What works now: Unit coverage exists for provider contracts, quota, route cache/generation, AI privacy, AI draft/repair, AI Trip Edit, cloud, tickets, maps; E2E covers major local flows and mock provider paths.
- Phase-1 / mock / disabled / smoke-only: Real external provider smoke is mostly deferred; this roadmap task itself should run docs-only checks only.
- Missing Phase-2 work: Final `build`, `lint`, `test:unit`, targeted E2E, full E2E if feasible, device visual QA, production-like provider/cloud smoke, no-secret report checks.
- Beta risk: Mock fixtures hide provider, service worker, and mobile regressions.
- Recommended next task: `qa/limited-beta-baseline`.
- Owner: Codex + Manual QA + Claude QA.
- Priority: P0.
- Dependencies: Provider/cloud smoke tasks, beta copy.

### 17. User-Facing Beta Copy

- Current status: Blocked for beta communications.
- What works now: Technical docs describe many boundaries; Settings has some PWA/offline and cloud caveats.
- Phase-1 / mock / disabled / smoke-only: Beta User Copy Pass was skipped; there is no concise tester guide that says what TripMap is and is not.
- Missing Phase-2 work: Limited beta user guide, in-app/release copy covering AI/search/routes/cloud/offline/privacy/storage, refresh instructions, backup-before-travel guidance.
- Beta risk: Users overestimate AI search, cloud sync, route navigation, or offline capability.
- Recommended next task: `docs/limited-beta-user-guide`.
- Owner: Codex.
- Priority: P0.
- Dependencies: Product decisions on enabled beta features.

## D. P0/P1 Before Limited Beta

1. `qa/provider-quota-production-smoke`
   - Configure D1 binding and migration in staging/prod.
   - Verify isolated route/search/place/AI buckets, fail-closed behavior, origin allowlist, budget alerts, and no sensitive logs.

2. `fix/provider-key-policy-hardening`
   - Document server-only key matrix for AI, Tavily, Google Places, Google Routes, ORS, and browser-visible Google Maps JS.
   - Restrict Google Maps JS key to beta domains and keep server keys out of `VITE_*`.

3. `qa/provider-proxy-production-smoke`
   - Run Pages-runtime smoke for AI Draft, repair, AI Trip Edit, route preview, route order, Tavily, and Places according to the enabled beta set.
   - Verify no raw provider body, full prompt, API key, key prefix, `Authorization`, `Bearer`, or stack trace leaks in page text, dist, logs, screenshots, or reports.

4. `qa/cloud-beta-smoke`
   - Verify Supabase Auth/RLS/private Storage with a beta account: upload, overwrite same trip, restore same trip, delete cloud save, copy-ticket missing-file warning, and legacy save display.

5. `docs/limited-beta-user-guide`
   - Say clearly: local-first, zip is safest before travel, cloud is one-to-one backup not realtime sync, routes are previews not navigation, AI writes require confirmation, search claims require sources, PWA updates may need hard refresh/reopen.

6. `qa/limited-beta-baseline`
   - Run `npm run build`, `npm run lint`, `npm run test:unit`, targeted E2E, full E2E when feasible, 390px mobile pass, and final docs/copy proofread.

## E. P2 After Small Beta

- `qa/ticket-library-beta-pass`: grid/lightbox/mobile preview polish and item-bound ticket thumbnail treatment.
- `feature/item-detail-slim-pass`: make Item Detail feel like an on-site travel card, not an admin page.
- `docs/design-system-swiftui-pass`: define grouped-list, spacing, radius, shadow, section header, warning, sheet, and button hierarchy rules.
- `feature/map-controls-location-markers`: recenter, user location, far-away fit-bounds rule, zoom-adaptive lines/markers, and emoji marker foundation.
- `feature/import-route-generation-queue`: ask after import before generating route cache by transport mode.
- `feature/travel-search-phase2-sources`: official-source preference, ranking, dedupe, freshness, cache policy, and clearer citations.

## F. Deferred Long-Term Enhancements

- Autonomous/multi-turn AI agent, background tool use, or automatic saved-trip writes.
- Automatic attraction hero images, attraction tips, and proactive trip info unless source-bearing, privacy-reviewed, quota-gated, and clearly labeled.
- Offline commercial map tiles, offline route generation, or navigation.
- Realtime cloud sync, field-level merge, multi-device collaboration, and end-to-end encrypted cloud.
- Ticket OCR, wallet import, booking integrations, passport/visa document processing.
- Full Google Places enrichment for opening hours, ratings, reviews, photos, phone, and website.
- Transit line/bus number hints until source, freshness, licensing, and UI caveats are settled.

## G. Recommended Next 10 Tasks, Ordered

1. `qa/provider-quota-production-smoke` - proves D1 quota, origin allowlist, budgets, and abuse controls before any real provider beta.
2. `fix/provider-key-policy-hardening` - locks the product decision that beta uses app-provided server keys, not user-entered external provider keys.
3. `qa/cloud-beta-smoke` - validates the original "sync" direction as current one-to-one cloud save semantics before testers rely on it.
4. `docs/limited-beta-user-guide` - completes the skipped Beta User Copy Pass and prevents overpromising AI/search/routes/cloud/offline.
5. `qa/provider-proxy-production-smoke` - smoke AI Draft, repair, Trip Edit, route, route order, Places, and Tavily in Pages runtime according to enabled scope.
6. `qa/limited-beta-baseline` - full build/lint/unit/E2E/manual pass after copy and smoke fixes land.
7. `qa/map-trip-home-day-view-completion-pass` - preserves the original Trip Home centrality and Day Map marker-to-card direction.
8. `qa/places-route-pages-runtime-smoke` - closes the skipped Places / Route Pages Runtime Smoke after key separation.
9. `qa/ticket-library-beta-pass` - advances the original ticket grid/lightbox direction and item-bound ticket display.
10. `docs/design-system-swiftui-pass` - starts the less-AI-generated SwiftUI-like design system before more UI expansion.

This order intentionally blends product directions with engineering readiness: cloud/save, beta copy, Trip Home/Day Map, tickets, and visual system are not postponed just because provider smoke is urgent.

## H. Suggested Beta Scope and Caveats

Safe beta scope after P0/P1 tasks:

- Local-first trip/day/item CRUD, Trip Home, Day View, Item Detail, and Ticket Library.
- Zip backup/export/import as the strongest pre-travel backup path.
- One-to-one Supabase cloud save/restore after RLS/storage smoke.
- Day Map and Trip Home route/map preview, clearly labeled as preview only.
- AI Draft generation/repair only after Pages-runtime provider smoke and beta copy.
- AI Trip Edit only if explicitly enabled with production smoke, confirmation gates, and fallback/kill-switch policy.
- Places lookup and route order suggestion only as manual, confirmation-gated, provider-smoked beta features.

Must not promise in beta:

- Realtime sync or collaboration.
- Turn-by-turn navigation, realtime traffic, subway/bus line correctness, offline maps, or offline route generation.
- Real-time search claims without visible source-bearing search results.
- Automatic AI editing, autonomous browsing, background enrichment, or booking actions.
- Cloud or AI handling of highly sensitive ticket/passport/visa content beyond the documented conservative boundaries.

## I. Open Questions / Decisions Needed

- Which provider-backed features are enabled for first beta testers: AI Draft only, AI Draft + repair, Places, route preview, route order, AI Trip Edit, Tavily search?
- Should AI Trip Edit be hidden, feature-flagged, or visible with caveats for the first beta cohort?
- Is the product decision final that external user provider keys stay out of Settings in favor of app-provided server keys?
- Who owns production provider budget alerts, key rotation, and D1 cleanup/admin observability?
- Which Supabase project/account is the staging beta smoke target, and who confirms RLS/private Storage policies?
- What feedback channel and bug-report template should beta users use?
- Should the beta guide be a doc-only artifact first, or should a compact in-app beta notice land before invites?
