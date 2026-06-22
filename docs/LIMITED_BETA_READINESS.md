# Limited Beta Readiness Checklist

Date: 2026-06-22
Baseline audited: current `main` plus the PR4 QA/docs/governance branch.

## A. Executive Summary

TripMap is close to a controlled limited beta for a productized travel management experience across Trip Home, Day View, tickets, finance, maps, optional zip archive, and one-to-one Supabase account sync. Offline-capable storage and PWA behavior remain technical capabilities; the product should not be positioned as real-time search, booking, full navigation, realtime collaboration, or autonomous AI editing.

The largest beta blockers have shifted from implementation to release discipline: account-scoped storage, Phase 12F time semantics, provider D1 budgets, Origin/Auth enforcement, maintenance cron, Supabase production smoke, and two-device intelligence smoke are implemented. Remaining beta work is final PR4 validation, desktop/PWA QA signal, physical iPhone Safari and Android Chrome recording, and bounded provider-family smoke only where real provider operations are explicitly enabled.

AI Draft generation, repair, and AI Trip Edit remain confirmation-gated. AI Trip Edit is still a patch-plan foundation rather than a conversational autonomous assistant; general questions and global AI entry points need product work so harmless consulting prompts do not fail only because they are not patch JSON.

## B. Beta Readiness Table

| Area | Status | What works now | Mock-only or disabled | Risks before beta | Required fixes before beta | Nice-to-have later | Owner | Suggested branch/task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. AI Draft generation | Beta-ready with caveats | Local mock draft, pasted JSON, provider proxy `ai_trip_draft`, JSON extraction, schema validation, preview, final import confirmation, DeepSeek handler smoke, and hardened proxy controls. | No autonomous web search; provider button disabled when proxy env is absent; local copy still says "local example" in places. | Model may create bad places/times; real provider smoke must stay bounded and no-secret. | Run release smoke only when the provider family is explicitly enabled, verify no IndexedDB writes before import, no secrets/raw output in page/dist/logs. | Better generated-draft provenance and user copy that separates mock, real AI, and manual JSON. | Codex, Manual QA | `qa/ai-draft-release-smoke` |
| 2. AI Draft repair / quality guardrails | Beta-ready with caveats | Local quality checker flags density, overlaps, short gaps, long days, missing locations, generic titles, meals, and transport; repair goes through provider proxy, sanitized draft/findings, validation, preview update, final import confirmation. | Repair disabled without proxy; quality findings are advisory and do not block import; no OCR/ticket/web reading. | User may overtrust repair quality; server validates shape but client applies user privacy settings. | Keep release smoke focused on note stripping/truncation and no route/ticket/cloud writes before final import. | More visible before/after diff and user-editable repair instruction field. | Codex, Manual QA | `qa/ai-draft-repair-release-smoke` |
| 3. AI Trip Edit patch-plan flow | Foundation only | Trip Home panel builds sanitized saved-trip context, calls `ai_trip_edit_plan`, validates whitelist patch operations, shows diff preview, rejects stale previews, blocks ticket-bound deletion, and requires second confirmation before IndexedDB writes. | Not a chat agent; no autonomous tools; no route/ticket/cloud side effects; harmless consulting prompts still need a better non-patch mode. | It edits real saved trips, so provider output quality remains product risk; no undo/history. | Run focused E2E on stale state, ticket-bound items, no side effects, and invalid provider JSON recovery. | Undo/history, richer diffs, narrower per-operation confirmations, and multi-turn only after safety review. | Codex, Manual QA | `feature/global-ai-consultation-mode` |
| 4. AI Trip Edit search integration | Foundation only | Detects explicit search intent, asks before sending, can call `travel_search` once, passes up to 3 source summaries into edit plan, and displays source cards when mock sources exist. | Real search provider is absent; source is mock or future-only; search unavailable falls back to "not connected" warning. | Users may read mock/example sources as real; citation UI is minimal; no real freshness guarantee. | Keep real-search claims out of beta copy; disable or clearly warn on search-assisted edits until a real provider and citations are shipped. | Rich citation UI, source confidence, retrieved-at display polish, official-source prioritization. | Codex, Claude QA | `fix/ai-trip-edit-search-beta-gate` |
| 5. Travel search provider proxy | Foundation only | Contract, validation, unsafe URL rejection, mock provider, unavailable provider, independent `search|` quota bucket, and no-secret checks exist. | No real search API key/env/provider; mock uses `travel.example`; non-mock runtime returns `provider_unavailable`. | It cannot answer real opening hours, ticket prices, disruptions, reviews, events, or latest info; real provider would add privacy, source quality, cost, and quota risk. | Do not promise real search in beta. Keep disabled or clearly marked as unavailable/foundation-only unless the real-provider task is separately completed and QAed. | Provider selection, official-source bias, dedupe, freshness policy, failure telemetry. | Codex | `feature/travel-search-provider` |
| 6. Route provider proxy / route generation | Beta-ready with caveats | Manual Day Map and Trip Home route preview generation can use provider proxy; route cache is local-only; straight-line fallback works; ORS/Google server keys stay behind proxy; UI requires user confirmation for Trip Home generation; Trip Home route order suggestion now uses `route_order_suggestion` proxy with preview plus confirmation before current-day `sortOrder` changes. | Transit/train/flight still straight fallback; bus uses road approximation; route order v1 uses Google Routes only and ORS optimization is deferred. | Provider cost, partial failures, stale route cache, coordinates sent to route providers, and Google waypoint optimization advanced SKU cost. | Run at most bounded release smoke with ORS or Google when enabled, confirm server-only keys, and keep route limitations in beta copy. | Batch queue after import, better provider health UI, route telemetry without sensitive data, ORS optimization adapter if needed. | Codex, Manual QA | `qa/route-proxy-release-smoke` |
| 7. Cloud account sync | Beta-ready with caveats | Stable per-user/per-trip `backupId`, object merge, copy ticket Blob, ledger/replan objects, intelligence applied changes and suggestion states, same-ID restore and startup/version prompts. Package 7 and security migrations are deployed; Companion and real two-device production smokes pass, including latest-wins and tombstone propagation. | Not realtime collaboration; no E2E encryption; legacy multi-snapshot records remain. | RLS/storage/RPC misconfiguration, restore direction mistakes, failed Blob restore. | Keep the bounded production smoke in release checks and reuse the repository-external refresh session instead of repeatedly sending OTP emails. | E2E encryption, richer sync diagnostics and legacy cleanup tooling. | Codex, Manual QA | `qa/intelligence-cross-device-smoke` |
| 8. Ticket library / previewer | Beta-ready with caveats | Ticket gallery cards, copy/reference/external modes, image/PDF/reference/external previewer, item-bound ticket summaries, zip/cloud inclusion rules for copy files. | OCR, wallet import, booking integration, and advanced gallery filtering are absent. | Browser storage pressure, large files, external links may rot, reference paths cannot be reliably opened by PWA. | Manual QA copy/reference/external tickets on mobile; beta copy must warn about storage and sensitive documents. | Fullscreen preview polish, filters, thumbnails, OCR only after privacy review. | Manual QA, Claude QA | `qa/ticket-library-beta-pass` |
| 9. Map / Trip Home preview / Day Map | Beta-ready with caveats | Trip Home map preview exists, Day Map marker card interaction is tested, collapsed sheet is summary-first, route chip/controls work, location fallback and no-auto-route behavior are tested. | Full navigation, realtime traffic, place search/geocoding, offline map tiles, and commercial tile caching are absent. | Older docs still understate map progress; MapLibre/Google rendering may vary by device; PWA cannot guarantee offline map use. | Manual 390px and desktop visual QA on real devices, update release notes to match actual map behavior, and keep route/search limits explicit. | Place search, geocoding, category markers, richer full-trip overview. | Manual QA, Claude QA | `qa/map-beta-visual-pass` |
| 10. Privacy controls / AI Privacy Guard | Beta-ready with caveats | AI privacy settings default off; repair strips/truncates notes; Trip Edit context avoids exact coordinates, tickets, route cache, cloud status, provider keys, URLs, and full DB by default; forbidden fields are rejected in contracts. | Ticket file content switch is disabled; server does not enforce every client privacy preference beyond request shape validation. | Users may misunderstand route/provider calls that still send coordinates; AI privacy settings live only in localStorage. | Verify all provider requests in browser network logs for beta flows; add concise beta privacy copy covering AI, route providers, cloud, tickets, and localStorage settings. | Server-side privacy policy enforcement and exportable privacy report. | Codex, Manual QA | `docs/beta-privacy-copy` |
| 11. Quota / provider keys / secrets | Beta-ready with caveats | Server-only route/AI/search/place keys stay in runtime env; Settings hides provider keys; production/preview enforce Origin, edge IP, Bearer, Supabase Auth, D1 minute quotas, daily budgets, provider controls, and maintenance cleanup. | Local/dev can still use memory fallback; Cloudflare Email Service alerts stay pending if no free verified sender is configured; Google Maps JS key is browser-visible by nature. | Misconfigured env/bindings or provider keys can still break real provider paths; real provider smoke must remain bounded. | Keep D1 migration/bindings in release checks, verify production diagnostics, and use provider controls for rapid rollback. | Admin-facing safe telemetry and richer budget alert delivery. | Codex | `qa/provider-proxy-release-smoke` |
| 12. PWA / offline / service worker | Beta-ready with caveats | Vite PWA auto-update, app-shell precache, cleanup outdated caches, skip waiting, no runtime tile caching, and PR4 adds a real built-dist v1 to v2 upgrade smoke with IndexedDB retention. | No offline routes/maps/cloud/search; commercial map tiles are not cached. | Users may see stale build after deploy; IndexedDB can be evicted by browser policy. | Keep refresh/update copy in beta guide and run PWA upgrade smoke before release. | In-app update toast and offline readiness indicator. | Codex, Manual QA | `qa/pwa-upgrade-smoke` |
| 13. E2E / QA baseline | Beta-ready with caveats | Unit coverage exists across provider, quota, time semantics, cloud, tickets, maps, AI and intelligence; E2E keeps full 390x844 mobile and adds focused 1440x900 desktop smoke plus PWA upgrade smoke. | Physical device checks are manual and must be recorded separately. | Mock fixtures can hide real device rendering issues; local service worker stale cache can confuse QA. | Run build, lint, unit, desktop smoke, PWA upgrade, full E2E, and manually record iPhone Safari / Android Chrome. | Nightly smoke, CI artifacts, visual diff baselines. | Codex, Manual QA | `qa/limited-beta-baseline` |
| 14. Docs / user-facing copy | Beta-ready with caveats | README, provider, AI foundation, cloud, routing, import, roadmap, project status, beta user guide, release notes and QA record document current boundaries. | In-app beta banner and feedback capture are still minimal. | Users may overestimate AI search, cloud sync, route navigation, or offline capability. | Keep `docs/BETA_USER_GUIDE.md`, `docs/LIMITED_BETA_RELEASE_NOTES.md` and `docs/BETA_QA_RECORD.md` current with each release. | In-app beta banner and feedback template. | Codex | `docs/limited-beta-user-guide` |

## C. Must-Fix Before Limited Beta

1. Finish PR4 QA and release governance.
   - Run build, lint, unit, desktop smoke, PWA upgrade smoke, full E2E when feasible, and `git diff --check`.
   - Confirm required GitHub checks and Cloudflare Pages deployment for the final merge commit.
   - Keep screenshots, local env files, local profiles and agent notes out of Git.

2. Keep provider release smoke bounded.
   - Production and preview already enforce Origin/Auth/D1 controls.
   - For real provider families, use at most the explicitly approved smoke count and verify no IndexedDB writes before confirmation.
   - Verify page text, dist output, logs, screenshots, and reports contain no key, key prefix, `Bearer`, raw provider body, raw model output, full prompt, or stack trace.

3. Keep real travel search out of beta unless a separate real-provider task lands.
   - `travel_search` is mock/unavailable foundation today.
   - Any beta copy or UI must not imply real opening hours, ticket prices, traffic, closures, reviews, events, or latest facts.

4. Maintain the production Supabase security rollout.
   - `20260620074105_harden_production_boundaries.sql` and the owner `RETURNING` forward fix are deployed; ACL/RLS/cron/index checks, advisors and Companion smoke pass.
   - The real two-device smoke passes Device A upload, fresh Device B restore, history/state recovery, latest-wins and tombstone propagation; keep cleanup assertions enabled.
   - Leaked-password protection cannot be enabled on the current Free plan; reassess after a deliberate plan upgrade rather than changing billing during rollout.

5. Publish beta expectations.
   - AI requires preview and confirmation.
   - Routes are previews, not navigation.
   - Cloud is one-to-one save, not realtime sync.
   - Export zip before travel.
   - PWA updates may require hard refresh or reinstall if stale service worker behavior appears.

6. Record physical device checks.
   - iPhone Safari: login, PWA add-to-home-screen, Trip, Day, Ticket, Settings, refresh/update behavior.
   - Android Chrome: login, Trip, Day Map, Item, Ledger, Documents, PWA refresh behavior.
   - Write results to `docs/BETA_QA_RECORD.md`; screenshots remain untracked.

## D. Safe To Beta With Caveats

- Offline-capable trip/day/item CRUD and hash routes.
- Zip backup/export/import, with user education that zip is still the strongest pre-travel backup.
- Ticket library and previewer for copy/reference/external tickets, with storage and sensitive-document warnings.
- Day Map and Trip Home preview, as route preview and map inspection only.
- Manual route generation through proxy after confirmation, with bounded provider-family release smoke when real providers are enabled.
- Supabase one-to-one cloud save/restore, once RLS/storage staging smoke passes.
- AI Draft generation/repair, because final import still requires confirmation and provider proxy controls are in place.
- AI privacy controls, with clear copy that route generation sends coordinates and cloud save uploads trip data/files.

## E. Foundation-Only / Deferred

- Real travel/web search provider.
- Rich citation UI and source freshness policy.
- AI Trip Edit as a multi-turn agent or autonomous tool user.
- AI Trip Edit undo/history and richer per-operation review.
- Abuse dashboard and richer safe telemetry.
- Full map provider layer: place search, geocoding, provider selection, and candidate caching.
- Offline maps, offline route generation, and commercial tile caching.
- Realtime cloud sync, field-level merge, multi-device collaboration, and E2E cloud encryption.
- Ticket OCR, wallet import, booking integrations, and sensitive document processing.

## F. Manual QA Checklist

- Fresh install/open: create trip, create days/items, switch schedule/map, view Trip Home, reload.
- 390px mobile: Home, Trip Home, Day Schedule, Day Map marker card, Item Detail, Tickets, Settings, AI Draft.
- AI Draft mock: generate, inspect quality card, cancel import, confirm import, verify no route/ticket/cloud writes.
- AI Draft real provider: confirm before request, exactly one frontend proxy request, valid preview, no writes before import, no secret leakage.
- AI repair real provider: warnings trigger repair button, confirm before request, note privacy respected, repaired draft revalidates, no writes before import.
- AI Trip Edit mock/real: confirm send, preview diff, cancel apply, stale-state rejection, apply simple title edit, verify no route/ticket/cloud writes.
- AI Trip Edit search intent: one confirmed search attempt, source display only when source-bearing results exist, unavailable search shows warning only.
- Route proxy: unconfigured fallback, ORS/Google success, provider unavailable fallback, cache reuse after reload, route cache clear.
- Cloud: unconfigured state, login, upload overwrite, restore overwrite, possible conflict prompt, local newer prompt, legacy multi-save list, delete cloud save.
- Tickets: empty library, add copy/reference/external, preview image/PDF/link/reference, delete ticket, item-bound ticket summary.
- PWA: install/open as standalone where possible, service worker update after a new build, hard refresh recovery for stale build, offline app shell only.
- Privacy: defaults all off, AI repair strips notes, ticket file content switch disabled, no ticket/blob/cloud/route/provider fields in AI payloads.

## G. Release / Rollback Checklist

- Confirm beta branch has clean docs and code status before build.
- Set Cloudflare env/bindings: route proxy URL/provider, server-only ORS/Google Routes key, AI/search/place provider env if enabled, `TRIPMAP_PROVIDER_QUOTA_D1`, origin allowlist, Supabase vars if cloud is enabled.
- Restrict browser-visible Google Maps JS key to beta domains in Google Cloud.
- Run production-like smoke on the deployed beta URL, not only localhost.
- Save a known-good zip backup for seeded QA trips before cloud restore tests.
- Verify PWA version/build visible in Settings and service worker serves the intended build.
- Keep travel search real provider disabled unless the dedicated search provider task shipped.
- Rollback by redeploying the previous Pages build and, if needed, rotating provider keys.
- If a provider secret or prefix appears in any report/log/chat/screenshot, rotate it before continuing beta.
- Communicate beta caveats and refresh instructions to testers before invites go out.

## H. Recommended Next 5 Tasks

1. `qa/limited-beta-baseline` - build, lint, unit, desktop smoke, PWA upgrade smoke, full E2E if feasible, plus physical device recording.
2. `feature/global-ai-consultation-mode` - let global AI answer harmless capability/help questions without forcing patch-plan JSON.
3. `qa/provider-proxy-release-smoke` - bounded real provider-family smoke after explicit approval.
4. `feature/trip-home-map-overview-polish` - Phase 13A map overview and entry optimization.
5. `feature/day-marker-card-polish` - Phase 13B marker to lightweight card to Item Detail flow.
