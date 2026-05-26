# Limited Beta Readiness Checklist

Date: 2026-05-26
Baseline audited: current `main` code, docs, and tests after branching to `docs/limited-beta-readiness`.

## A. Executive Summary

TripMap is close to a controlled limited beta for local-first trip planning, map/day viewing, ticket storage, zip backup, and one-to-one Supabase cloud save. The product should not be positioned as real-time search, booking, full navigation, realtime sync, or autonomous AI editing.

The largest beta blockers are provider abuse operations and production smoke coverage: quota now has a D1-backed foundation when `TRIPMAP_PROVIDER_QUOTA_D1` is configured, but production binding setup, origin controls, account/IP policy, budgets, and real browser plus Cloudflare Pages/worker smoke are still needed for provider-backed paths.

AI Draft generation and repair are beta-usable only with caveats: they have preview/confirm boundaries and real DeepSeek smoke, but need near-production Pages/worker smoke with the D1 quota binding before real users. AI Trip Edit patch plans are safer than direct writes because of sanitized context, diff preview, stale checks, and second confirmation, but should still be treated as foundation-only until full real-provider browser/worker QA passes.

## B. Beta Readiness Table

| Area | Status | What works now | Mock-only or disabled | Risks before beta | Required fixes before beta | Nice-to-have later | Owner | Suggested branch/task |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1. AI Draft generation | Beta-ready with caveats | Local mock draft, pasted JSON, provider proxy `ai_trip_draft`, JSON extraction, schema validation, preview, final import confirmation, DeepSeek handler smoke. | No web search; provider button disabled when proxy env is absent; local copy still says "local example" in places. | Real Pages/worker/browser path still needs near-production smoke; model may create bad places/times; D1 quota binding needs production smoke. | Run production-like Pages/worker smoke with real AI, verify no IndexedDB writes before import, no secrets/raw output in page/dist/logs, and D1 quota is configured. | Better generated-draft provenance and user copy that separates mock, real AI, and manual JSON. | Codex, Manual QA | `fix/ai-draft-production-smoke` |
| 2. AI Draft repair / quality guardrails | Beta-ready with caveats | Local quality checker flags density, overlaps, short gaps, long days, missing locations, generic titles, meals, and transport; repair goes through provider proxy, sanitized draft/findings, validation, preview update, final import confirmation. | Repair disabled without proxy; quality findings are advisory and do not block import; no OCR/ticket/web reading. | Browser/worker smoke and regression QA still needed; user may overtrust repair quality; server validates shape but client applies user privacy settings. | Run real repair Pages/worker smoke, verify note stripping/truncation in browser, and confirm repair never writes routes/tickets/cloud before final import. | More visible before/after diff and user-editable repair instruction field. | Codex, Manual QA | `fix/ai-draft-repair-smoke` |
| 3. AI Trip Edit patch-plan flow | Foundation only | Trip Home panel builds sanitized saved-trip context, calls `ai_trip_edit_plan`, validates whitelist patch operations, shows diff preview, rejects stale previews, blocks ticket-bound deletion, and requires second confirmation before IndexedDB writes. | Not a chat agent; no autonomous tools; no route/ticket/cloud side effects. | It edits real saved trips, so handler-only smoke is not enough; no undo/history; D1 quota needs production smoke; output quality is still provider-dependent. | Run real-provider browser plus Pages/worker smoke; add or confirm operational kill switch for beta; run focused E2E on stale state, ticket-bound items, and no side effects. | Undo/history, richer diffs, narrower per-operation confirmations, and multi-turn only after safety review. | Codex, Manual QA | `fix/ai-trip-edit-production-smoke` |
| 4. AI Trip Edit search integration | Foundation only | Detects explicit search intent, asks before sending, can call `travel_search` once, passes up to 3 source summaries into edit plan, and displays source cards when mock sources exist. | Real search provider is absent; source is mock or future-only; search unavailable falls back to "not connected" warning. | Users may read mock/example sources as real; citation UI is minimal; no real freshness guarantee. | Keep real-search claims out of beta copy; disable or clearly warn on search-assisted edits until a real provider and citations are shipped. | Rich citation UI, source confidence, retrieved-at display polish, official-source prioritization. | Codex, Claude QA | `fix/ai-trip-edit-search-beta-gate` |
| 5. Travel search provider proxy | Foundation only | Contract, validation, unsafe URL rejection, mock provider, unavailable provider, independent `search|` quota bucket, and no-secret checks exist. | No real search API key/env/provider; mock uses `travel.example`; non-mock runtime returns `provider_unavailable`. | It cannot answer real opening hours, ticket prices, disruptions, reviews, events, or latest info; real provider would add privacy, source quality, cost, and quota risk. | Do not promise real search in beta. Keep disabled or clearly marked as unavailable/foundation-only unless the real-provider task is separately completed and QAed. | Provider selection, official-source bias, dedupe, freshness policy, failure telemetry. | Codex | `feature/travel-search-provider` |
| 6. Route provider proxy / route generation | Beta-ready with caveats | Manual Day Map and Trip Home route preview generation can use provider proxy; route cache is local-only; straight-line fallback works; ORS/Google server keys stay behind proxy; UI requires user confirmation for Trip Home generation. | Transit/train/flight still straight fallback; bus uses road approximation; browser-side Google Routes order optimization is deferred until it has a server proxy operation. | Provider quota/cost, partial failures, stale route cache, real Google/ORS production config, and coordinates sent to route providers. | Run production route proxy smoke with ORS or Google, set origin allowlist, confirm server-only keys, and document route limitations for beta users. | Batch queue after import, better provider health UI, route telemetry without sensitive data. | Codex, Manual QA | `fix/route-proxy-beta-smoke` |
| 7. Cloud one-to-one save / backup | Beta-ready with caveats | Stable per-user/per-trip `backupId`, upsert overwrite, copy ticket file upload, restore over same trip ID, manual delete, auto-save foundation, startup/version conflict prompts, legacy multi-save display. | Not realtime sync; no E2E encryption; legacy multi-snapshot records are not auto-migrated or deleted. | RLS/storage policy misconfig, restore overwriting local data, failed copy-file restore, legacy records confusing users. | Run Supabase production/staging smoke with a beta test account, verify RLS/storage policies, and include one-to-one overwrite plus legacy-data caveats in beta docs. | E2E encryption, clearer migration/cleanup tool for old snapshots, richer conflict explanation. | Codex, Manual QA | `fix/cloud-beta-smoke` |
| 8. Ticket library / previewer | Beta-ready with caveats | Ticket gallery cards, copy/reference/external modes, image/PDF/reference/external previewer, item-bound ticket summaries, zip/cloud inclusion rules for copy files. | OCR, wallet import, booking integration, and advanced gallery filtering are absent. | Browser storage pressure, large files, external links may rot, reference paths cannot be reliably opened by PWA. | Manual QA copy/reference/external tickets on mobile; beta copy must warn about storage and sensitive documents. | Fullscreen preview polish, filters, thumbnails, OCR only after privacy review. | Manual QA, Claude QA | `qa/ticket-library-beta-pass` |
| 9. Map / Trip Home preview / Day Map | Beta-ready with caveats | Trip Home map preview exists, Day Map marker card interaction is tested, collapsed sheet is summary-first, route chip/controls work, location fallback and no-auto-route behavior are tested. | Full navigation, realtime traffic, place search/geocoding, offline map tiles, and commercial tile caching are absent. | Older docs still understate map progress; MapLibre/Google rendering may vary by device; PWA cannot guarantee offline map use. | Manual 390px and desktop visual QA on real devices, update release notes to match actual map behavior, and keep route/search limits explicit. | Place search, geocoding, category markers, richer full-trip overview. | Manual QA, Claude QA | `qa/map-beta-visual-pass` |
| 10. Privacy controls / AI Privacy Guard | Beta-ready with caveats | AI privacy settings default off; repair strips/truncates notes; Trip Edit context avoids exact coordinates, tickets, route cache, cloud status, provider keys, URLs, and full DB by default; forbidden fields are rejected in contracts. | Ticket file content switch is disabled; server does not enforce every client privacy preference beyond request shape validation. | Users may misunderstand route/provider calls that still send coordinates; AI privacy settings live only in localStorage. | Verify all provider requests in browser network logs for beta flows; add concise beta privacy copy covering AI, route providers, cloud, tickets, and localStorage settings. | Server-side privacy policy enforcement and exportable privacy report. | Codex, Manual QA | `docs/beta-privacy-copy` |
| 11. Quota / provider keys / secrets | Foundation only | Server-only route/AI/search/place keys are designed for env bindings; Settings hides provider keys; normalized errors avoid raw provider output; D1 quota foundation isolates `route|`, `search|`, `place|`, `ai_draft|`, `ai_draft_repair|`, and `ai_trip_edit|`; Google Maps JS rendering key is separated from server-only keys. | Local/dev falls back to memory when no D1 binding exists; browser session ID is spoofable; origin allowlist is only env-driven; Google Maps JS key is browser-visible by nature. | Abuse, provider spend, leaked or unrestricted browser key, missing D1 migration/binding, no account-level enforcement, no cleanup job or budget alerting. | Configure D1 binding and SQL on staging/prod, run provider quota smoke, add explicit origin allowlist, account/session/IP policy, budget/alerting, key rotation plan, and Google Maps JS domain restrictions before inviting real users. | Per-account quotas, admin dashboard, safe telemetry, cleanup job. | Codex | `qa/provider-quota-production-smoke` |
| 12. PWA / offline / service worker | Beta-ready with caveats | Vite PWA auto-update, app-shell precache, cleanup outdated caches, skip waiting, and no runtime tile caching. | No offline routes/maps/cloud/search; service worker can cache old local QA builds; commercial map tiles are not cached. | Users may see stale build after deploy; offline expectations may be too high; IndexedDB can be evicted by browser policy. | Add beta release note for refresh/update behavior, verify service worker update on staging, and tell beta users to export zip before travel. | In-app update toast and offline readiness indicator. | Codex, Manual QA | `docs/pwa-beta-update-note` |
| 13. E2E / QA baseline | Beta-ready with caveats | Unit coverage exists for provider contracts, quota, route cache/generation, AI privacy, AI draft/repair, AI Trip Edit, cloud, tickets, maps; E2E covers major local flows, AI Draft, AI Trip Edit mock/search, cloud prompts, map UX, tickets, import, forms, privacy. | This doc task did not rerun build/lint/unit/E2E; real external provider smoke is mostly deferred. | Regressions hidden by mock fixtures; local service worker stale cache; real browser/device issues. | Before beta branch cut, run `npm run build`, `npm run lint`, `npm run test:unit`, targeted E2E, full E2E when feasible, plus manual mobile QA. | Nightly smoke, CI artifacts, visual diff baselines. | Codex, Manual QA, Claude QA | `qa/limited-beta-baseline` |
| 14. Docs / user-facing copy | Beta-ready with caveats | README, provider, AI foundation, cloud, routing, import, roadmap, and this readiness checklist document current boundaries. | PROJECT_STATUS contains a few stale "not complete" map statements compared with current tested marker-card/preview behavior; no beta user guide yet. | Users may overestimate AI search, cloud sync, route navigation, or offline capability. | Add a beta user guide or release note with clear "what this beta is/is not", PWA refresh instructions, backup guidance, and AI/search disclaimers. | In-app beta banner and feedback template. | Codex | `docs/limited-beta-user-guide` |

## C. Must-Fix Before Limited Beta

1. Operationalize durable provider quota and abuse controls.
   - Configure Cloudflare D1 binding `TRIPMAP_PROVIDER_QUOTA_D1` and run the provider quota SQL migration.
   - Use reliable session/IP/server-observed signals, isolated namespaces for route, search, place, AI draft, repair, and edit, and production budget alerts.
   - Add explicit origin allowlist for deployed beta domains.

2. Complete production-like provider smoke.
   - AI Draft generation and repair through Cloudflare Pages/worker with real DeepSeek or selected provider.
   - AI Trip Edit patch-plan through real browser plus worker, including no side effects before final apply.
   - Route provider proxy through ORS or Google with server-only keys.
   - Verify page text, dist output, logs, screenshots, and reports contain no key, key prefix, `Bearer`, raw provider body, raw model output, full prompt, or stack trace.

3. Keep real travel search out of beta unless a separate real-provider task lands.
   - `travel_search` is mock/unavailable foundation today.
   - Any beta copy or UI must not imply real opening hours, ticket prices, traffic, closures, reviews, events, or latest facts.

4. Run Supabase beta smoke with real RLS and private Storage.
   - Upload, overwrite same trip, restore same trip, delete cloud save, copy-ticket file restore failure warning, and legacy multi-save display.
   - Confirm cloud restore never creates surprise duplicate local trips.

5. Publish beta expectations.
   - AI requires preview and confirmation.
   - Routes are previews, not navigation.
   - Cloud is one-to-one save, not realtime sync.
   - Export zip before travel.
   - PWA updates may require hard refresh or reinstall if stale service worker behavior appears.

6. Cut a fresh QA baseline.
   - `npm run build`
   - `npm run lint`
   - `npm run test:unit`
   - Targeted E2E for AI, cloud, map, ticket, import, route.
   - Full E2E when feasible.

## D. Safe To Beta With Caveats

- Local-first trip/day/item CRUD and hash routes.
- Zip backup/export/import, with user education that zip is still the strongest pre-travel backup.
- Ticket library and previewer for copy/reference/external tickets, with storage and sensitive-document warnings.
- Day Map and Trip Home preview, as route preview and map inspection only.
- Manual route generation through proxy after confirmation, once production route smoke and quota controls pass.
- Supabase one-to-one cloud save/restore, once RLS/storage staging smoke passes.
- AI Draft generation/repair, once D1 quota and real worker/browser smoke pass, because final import still requires confirmation.
- AI privacy controls, with clear copy that route generation sends coordinates and cloud save uploads trip data/files.

## E. Foundation-Only / Deferred

- Real travel/web search provider.
- Rich citation UI and source freshness policy.
- AI Trip Edit as a multi-turn agent or autonomous tool user.
- AI Trip Edit undo/history and richer per-operation review.
- Provider quota production smoke, abuse dashboard, cleanup job, and billing controls.
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

1. `qa/provider-quota-production-smoke` - D1 quota migration/binding smoke, origin allowlist, account/IP policy, budget alerts.
2. `qa/provider-proxy-production-smoke` - real Pages/worker smoke for AI Draft, repair, AI Trip Edit, and route proxy.
3. `qa/cloud-beta-smoke` - Supabase RLS/storage smoke for overwrite, restore, delete, copy files, and legacy records.
4. `docs/limited-beta-user-guide` - short tester guide covering backup, cloud, AI, search, routes, privacy, and PWA refresh behavior.
5. `qa/limited-beta-baseline` - build, lint, unit, targeted E2E, full E2E if feasible, plus 390px mobile visual pass.
