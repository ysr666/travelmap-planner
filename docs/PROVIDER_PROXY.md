# Provider Proxy

TripMap uses a provider proxy so production route and AI requests can use owner-provided provider keys without shipping those keys to the PWA.

## Security Boundary

- The browser calls a TripMap-owned endpoint, normally `/api/provider-proxy`.
- The proxy calls Google Routes, OpenRouteService, AI providers, search providers, and Google Places with server-side runtime secrets.
- Server-only secrets must be runtime bindings such as `OPENROUTESERVICE_API_KEY`, `GOOGLE_ROUTES_API_KEY`, `GOOGLE_MAPS_PLATFORM_API_KEY`, `TRIPMAP_AI_API_KEY`, `TRIPMAP_SEARCH_API_KEY`, and `TRIPMAP_GOOGLE_PLACES_API_KEY`.
- Server-only secrets must never be exposed through `VITE_*` variables, IndexedDB, zip backups, Supabase backups, AI import/export, tests, or frontend bundles.
- A browser-visible Google Maps JavaScript rendering key is different: it is inherently public and must be restricted by referrer in Google Cloud. If TripMap uses the same actual Google Maps Platform key value for browser maps, Routes, and Places, mirror that value into the server runtime as `GOOGLE_MAPS_PLATFORM_API_KEY`; the proxy must not read it from `VITE_*`.

## Cloudflare Pages Function

The first backend target is a Cloudflare Pages Function:

- Entry: `functions/api/provider-proxy.ts`
- Reusable edge-compatible logic: `server/providerProxy/*`
- Runtime env is read from the Pages Function context/env binding.
- The handler does not read provider secrets from `import.meta.env`.

Cloudflare Pages production and preview deployments must configure real provider env through Pages environment variables/secrets so they are exposed to the Function as `context.env`. For Tavily travel search, set `TRIPMAP_SEARCH_PROVIDER=tavily` and `TRIPMAP_SEARCH_API_KEY` as a server-side Pages secret/env value.

Local Cloudflare worker development can use uncommitted local files such as `.dev.vars` or `.env` for worker runtime secrets where the runtime supports them. However, `wrangler pages dev` should be treated like Pages Functions: real provider values must be injected as Pages-compatible bindings/secrets, and local QA must not assume `.env.local` or `--env-file` values are present in `context.env`. Do not commit local env files, and do not mirror provider secrets into `VITE_*` variables.

## Request Contract

Route preview operation:

```json
{
  "operation": "route_preview",
  "provider": "openrouteservice",
  "tripId": "trip-id",
  "dayId": "day-id",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "coordinates": [[139.1, 35.1], [139.2, 35.2]],
  "segments": [
    {
      "fromCoordinateIndex": 0,
      "toCoordinateIndex": 1,
      "segmentIndex": 0,
      "mode": "car",
      "profile": "driving-car",
      "fromItemId": "item-a",
      "toItemId": "item-b"
    }
  ]
}
```

Limits in this foundation:

- Max 25 coordinates per request.
- Max 24 route segments per request.
- Max 7 days per future batch request.
- Supported providers in the wire contract: `google`, `openrouteservice`, `auto`.
- Frontend route cache identity must still use a concrete provider: `google` or `openrouteservice`, never `proxy`.

Route order suggestion operation:

```json
{
  "operation": "route_order_suggestion",
  "provider": "auto",
  "tripId": "trip-id",
  "dayId": "day-id",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "items": [
    {
      "id": "item-a",
      "title": "Museum",
      "locationName": "Museum",
      "address": "Address",
      "coordinate": { "lat": 48.8606, "lng": 2.3376 }
    }
  ]
}
```

Limits and boundaries:

- Max 10 items per request.
- At least 2 items must include valid coordinates.
- The request whitelist rejects notes, tickets, cloud state, route cache, provider keys, headers, raw coordinates arrays, full trip DB, and other extra fields.
- The frontend calls this operation only after the user clicks “查看建议（仅建议）”.
- Real v1 supports Google Routes waypoint optimization only; `auto` prefers `GOOGLE_ROUTES_API_KEY`, then falls back to the shared server-side `GOOGLE_MAPS_PLATFORM_API_KEY`. ORS optimization is deferred because it is a separate public VROOM-backed endpoint rather than the existing route preview API.
- Google route order requests use `optimizeWaypointOrder: true`, `TRAFFIC_UNAWARE`, `DRIVE`, and exact `X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline,routes.optimizedIntermediateWaypointIndex`.
- The Google request body contains only origin/destination/intermediate coordinates; it does not include trip/day IDs, item IDs, titles, addresses, notes, route cache, tickets, cloud state, or provider secrets.

Ledger operations:

- `exchange_rate` sends a date, one base currency, and one or more quote currencies to Frankfurter v2. The response records the requested date, latest effective date not after it, source URL, and retrieval time. It is a daily reference rate, not a live bank or card rate.
- `ai_expense_extract` is optional and confirmation-gated. It accepts only locally extracted, redacted text plus participant display names represented by request-local aliases. It never accepts files, blobs, email addresses, user IDs, cloud state, encrypted documents, route cache, or provider keys.
- AI expense extraction returns editable suggestions only. It never writes ledger records; the user must confirm the preview locally.

## Response Contract

Success:

```json
{
  "ok": true,
  "operation": "route_preview",
  "provider": "openrouteservice",
  "route": {
    "lineStrings": [[[139.1, 35.1], [139.2, 35.2]]],
    "segments": [
      {
        "coordinates": [[139.1, 35.1], [139.2, 35.2]],
        "kind": "road",
        "segmentIndex": 0,
        "distanceMeters": 1200,
        "durationSeconds": 600
      }
    ],
    "status": "road",
    "warnings": []
  }
}
```

Route order suggestion success:

```json
{
  "ok": true,
  "operation": "route_order_suggestion",
  "provider": "google",
  "suggestedItemIds": ["item-a", "item-c", "item-b"],
  "unchangedItemIds": [],
  "summary": "已根据路线服务生成当前日顺序建议。",
  "warnings": [],
  "distanceMeters": 1800,
  "durationSeconds": 900,
  "retrievedAt": "2026-05-26T00:00:00.000Z"
}
```

`route_order_suggestion` responses must contain exactly the same coordinate-bearing item IDs that were eligible for reordering. The provider cannot create, delete, rename, or edit items. Browser apply keeps non-coordinate items in their original slots, then renumbers only the selected day’s `sortOrder` after a confirmation dialog. It does not generate route geometry, write route cache, write cloud data, create tickets, or call AI/search.

Errors are normalized and must not pass raw provider bodies to the frontend:

- `provider_unavailable`
- `quota_exceeded`
- `invalid_request`
- `provider_error`
- `network_error`
- `unsupported`

## HTTP Safety

The proxy foundation:

- Accepts `POST` for route preview.
- Returns `405` for unsupported methods.
- Requires `Content-Type: application/json`.
- Handles `OPTIONS` for CORS preflight.
- Supports an origin allowlist placeholder through `TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS`.
- Must not log full request bodies because coordinates and trip/day ids may be sensitive.

Production should define an explicit origin allowlist. Same-origin deployment usually avoids browser CORS, but the allowlist still matters for alternate domains and staging.

## Quota Guard

The provider proxy uses an internal async quota layer before any provider call. Cloudflare D1 is used only when an explicit `TRIPMAP_PROVIDER_QUOTA_D1` binding exists; otherwise local/dev runs use a deterministic in-memory fallback.

Request processing order is fixed in hardened environments (`production` and `preview`): method/body size, Origin rejection, edge IP minute limit, Bearer presence, Supabase Auth verification, environment/D1 kill switch, daily and operation minute quotas, then the provider adapter. The proxy ignores client account fields and `quotaSessionId` after authentication; only the verified Supabase `user.id` and Cloudflare request IP participate in production identity.

Current operation minute bucket limits:

- `route|`: 60 requests per 60 seconds.
- `search|`: 20 requests per 60 seconds.
- `place|`: 30 requests per 60 seconds.
- `ai_draft|`: 10 requests per 60 seconds.
- `ai_draft_repair|`: 5 requests per 60 seconds.
- `ai_trip_edit|`: 10 requests per 60 seconds.
- `fx|`: 30 requests per 60 seconds.
- `ai_expense_extract|`: 5 requests per 60 seconds.

`route_preview` and `route_order_suggestion` both use the `route|` bucket. Quota is consumed before any mock or real provider call; over-limit and durable-storage-failure paths return normalized HTTP 429 `quota_exceeded`.

Production and trusted preview also enforce a separate `edge_ip|` bucket at 120 requests per minute before authentication. Each validated provider operation then consumes separate account and IP minute rows. Preview and production daily counters use separate namespaces.

Production daily budgets:

| Scope | AI | Search | Place | Route | FX |
| --- | ---: | ---: | ---: | ---: | ---: |
| Account | 20 | 20 | 60 | 100 | 30 |
| IP | 100 | 100 | 300 | 500 | 150 |
| Global | 200 | 200 | 600 | 1000 | 300 |

Trusted preview uses 25% of these limits, rounded up. At 70% and 90% of a global group budget, a redacted alert event is recorded. At 100%, the request is rejected and that group is disabled until the next UTC day. `provider_controls` supports immediate `global`, `ai`, `search`, `place`, `route`, and `fx` controls; `TRIPMAP_PROVIDER_PROXY_KILL_SWITCH` is the environment fallback.

Quota identity combines available server-side signals before hashing:

- Verified Supabase `user.id` for account rows.
- `CF-Connecting-IP`, or the first `X-Forwarded-For` value when present, for IP rows.
- `quotaSessionId` is retained only for local/development compatibility and is ignored in hardened environments.

Rows are stored as `<bucket><sha256(identity)>`; raw IP, raw session id, request headers, provider keys, SQL errors, stack traces, and internal row ids are never returned to the frontend. Production deployments should provide reliable IP/session signals. The anonymous fallback is only a last-resort local/dev path and is not sufficient abuse protection for public traffic.

When a D1 binding is present, quota consume is a guarded atomic SQL path. The runtime does not create tables or indexes. Apply the checked-in migrations under `cloudflare/d1/migrations/`; `0002_provider_operations_hardening.sql` adds daily usage, controls, and alert events without changing provider contracts.

Production rollout status, 2026-06-22: `0002_provider_operations_hardening.sql` has been applied to `tripmap_provider_quota`; `provider_controls` contains enabled `global`, `ai`, `search`, `place`, `route`, and `fx` controls; `tripmap-provider-maintenance` is deployed with an hourly cron. Pages production and preview configs include `TRIPMAP_PROVIDER_PROXY_ENV`, `TRIPMAP_PROVIDER_PROXY_REQUIRE_AUTH`, and `TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS`. Production code uses those settings after the PR3 deployment reaches `main`.

The foundation table remains:

```sql
CREATE TABLE IF NOT EXISTS provider_quota (
  id TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS provider_quota_expires_at_idx
ON provider_quota (expires_at);
```

If the binding is absent, the proxy falls back to in-memory storage for local/dev. If the binding exists but prepare/query fails or the table is missing, the proxy fails closed with HTTP 429 and normalized `quota_exceeded`; the provider is not called. `Retry-After` may be returned only when a reset time is safely known.

`tripmap-provider-maintenance` runs hourly from `wrangler.provider-maintenance.jsonc`. It removes expired minute rows, daily rows older than 8 days, sent alerts older than 30 days, restores expired automatic budget controls, and retries pending redacted alerts when a free verified-destination Email Service binding is available.

Cloudflare Email Service can send to a verified destination for free, but it still requires a Cloudflare routing domain and a verified destination address. If those prerequisites are absent, do not enable a paid sender: threshold rows remain pending in D1 while all hard limits continue to apply.

## Frontend Behavior

Production proxy mode is enabled with:

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

`VITE_ROUTE_PROXY_PROVIDER` must be concrete so local route cache identity remains stable. The frontend may have `source: "proxy"` at runtime, but persisted route cache entries remain provider-specific.

If the proxy URL is absent, route generation is unavailable and the UI falls back to straight-line previews or existing route cache entries. The frontend must not read OpenRouteService, Google Routes, or Google Places provider secrets from `VITE_*`, localStorage, IndexedDB, or the browser-visible Google Maps JavaScript key. Normal users should not be asked to enter provider keys, and Settings must not expose Google/ORS/Places key fields.

## What Moves Behind The Proxy

Now:

- Manual day route generation can use the proxy when configured.
- Trip Home route generation can use the proxy after user confirmation.
- Trip Home map preview still reads cached route geometry or displays straight lines; it does not silently call providers.
- Browser-side Google Routes order optimization is disabled; it must become a separate server proxy operation before returning.
- AI draft generation can use the proxy after user confirmation.
- AI draft repair can use the proxy after user confirmation and only updates the draft preview.
- AI trip edit planning can use the proxy after user confirmation and only returns a patch plan preview; applying the patch requires a second local confirmation.
- AI Trip Edit may call `travel_search` once after send confirmation when explicit search intent is detected, then attach compact source summaries to the edit-plan request.
- `travel_search` can use mock/disabled mode or the server-side Tavily adapter when `TRIPMAP_SEARCH_PROVIDER=tavily` and `TRIPMAP_SEARCH_API_KEY` are configured.
- Item Detail can manually call `place_lookup` when the user opens the lookup panel and clicks search; selecting a candidate still requires a confirmation before updating that single item.
- Travel Ledger can call `exchange_rate` while saving an expense, with local date/currency-pair caching and manual-rate fallback.
- Travel Ledger can call `ai_expense_extract` at most once per confirmed batch preview; the response remains a preview until the user creates drafts.

Later:

- Route order suggestion should become a separate proxy operation.
- Opening hours, ratings, reviews, photos, phone, and website fields for places remain deferred because they may change cost, field tiers, privacy, and UI expectations.

## Travel Search Operation

The `travel_search` operation is the only source-bearing web search contract. AI Trip Edit can use it only after the send confirmation; no source-bearing result means no realtime claim.

Current runtime behavior:

- `TRIPMAP_PROVIDER_PROXY_MOCK=1` returns deterministic mock results and takes priority over real search env.
- `TRIPMAP_SEARCH_PROVIDER=mock` returns deterministic mock results.
- Mock results use `source: "mock"`, `travel.example` URLs, and warning `当前为模拟搜索结果，不代表实时网页信息。`
- `TRIPMAP_SEARCH_PROVIDER=disabled` returns `unsupported`.
- Missing search provider env returns `provider_unavailable`.
- `TRIPMAP_SEARCH_PROVIDER=tavily` with `TRIPMAP_SEARCH_API_KEY` calls Tavily from the server proxy only and returns normalized `source: "future_search"` results.
- Tavily keys stay server-only in Pages environment variables/secrets or local Pages-compatible bindings. Never put them in `VITE_*`, IndexedDB, backups, screenshots, logs, reports, command-line arguments, or user-facing settings.
- Tavily free/dev usage is credit and rate-limit constrained; real search still passes through the proxy `search|` quota bucket before any provider fetch.

Request contract:

```json
{
  "operation": "travel_search",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "query": "杭州博物馆 营业时间",
  "locale": "zh-CN",
  "region": "CN",
  "searchType": "opening_hours",
  "maxResults": 5
}
```

Limits:

- `query`: required, 1-300 characters after trimming.
- `locale`: optional, `zh-CN` or `en-US`.
- `region`: optional, max 80 characters.
- `searchType`: optional, `general`, `opening_hours`, `ticket_price`, `official_site`, `transport`, or `nearby_food`; default `general`. Legacy aliases such as `place`, `tickets`, and `reviews` are rejected.
- `maxResults`: optional integer; missing defaults to 5, integers 1-5 are accepted, and integers above 5 are clamped to 5. Zero, negative numbers, decimals, and strings are rejected.
- Sensitive fields such as `apiKey`, `providerKey`, `authorization`, `headers`, `ticketBlobs`, `ticketIds`, `cloudToken`, `routeCache`, `coordinates`, `items`, `itineraryItems`, `days`, `trip`, and `fullTrip` are rejected recursively as `invalid_request`.

Success shape:

```json
{
  "ok": true,
  "operation": "travel_search",
  "source": "future_search",
  "query": "杭州博物馆 营业时间",
  "retrievedAt": "2026-05-26T08:00:00.000Z",
  "results": [
    {
      "title": "杭州博物馆开放信息",
      "url": "https://example.org/visit",
      "displayUrl": "example.org/visit",
      "domain": "example.org",
      "snippet": "来源摘要片段。",
      "sourceType": "official",
      "retrievedAt": "2026-05-26T08:00:00.000Z",
      "confidence": "high"
    }
  ]
}
```

Clients must treat search success parsing as strict: each result needs a safe HTTP(S) `url`, `displayUrl`, `domain`, `title`, `snippet`, and `retrievedAt`. Unsafe schemes such as `javascript:` or `data:` are rejected rather than displayed.

Tavily request policy:

- The proxy sends only a compact search request: `query`, capped `max_results`, `search_depth: "basic"`, and disabled answer/raw-content/image options.
- The proxy does not send trip DB, days/items, coordinates, notes, tickets, blobs, cloud state, route cache, provider keys, client headers, locale, region, or `searchType` to Tavily.
- Tavily response data is normalized into the existing contract. Raw provider body fields such as answer, raw content, images, usage, request IDs, headers, provider errors, stack traces, `Authorization`, `Bearer`, or the API key are never returned.
- `sourceType` and `confidence` are best-effort derived fields. If Tavily returns no usable safe source URLs, the proxy returns an empty result set with a generic warning; AI Trip Edit must treat that as no source.

## Place Lookup Operation

The `place_lookup` operation supports manual, per-item Google Places candidate lookup from Item Detail. It is not auto-enrichment and it is not batch update. Search results are transient until the user selects one and confirms the write.

Runtime behavior:

- `TRIPMAP_PROVIDER_PROXY_MOCK=1` returns deterministic mock candidates and takes priority over real place env.
- `TRIPMAP_PLACE_PROVIDER=mock` returns deterministic mock candidates.
- `TRIPMAP_PLACE_PROVIDER=disabled` returns `unsupported`.
- Missing place provider env returns `provider_unavailable`.
- `TRIPMAP_PLACE_PROVIDER=google_places` with `TRIPMAP_GOOGLE_PLACES_API_KEY`, or shared fallback `GOOGLE_MAPS_PLATFORM_API_KEY`, calls Google Places API New from the server proxy only.
- Google Places / Maps Platform server keys stay server-only in `.env.local`, `.dev.vars`, or deployment runtime bindings. Never read them from `VITE_*`, IndexedDB, backups, screenshots, logs, reports, or user-facing settings.
- Real lookup remains proxy-quota-gated under `place|` before any provider fetch.

Request contract:

```json
{
  "operation": "place_lookup",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "query": "明治神宫 1-1 Yoyogikamizonocho",
  "locale": "zh-CN",
  "region": "JP",
  "maxResults": 5
}
```

Limits:

- `query`: required, 1-200 characters after trimming.
- `locale`: optional, `zh-CN` or `en-US`.
- `region`: optional Google `regionCode`, accepted only as a trimmed 2-letter alpha value and normalized to uppercase.
- `maxResults`: optional integer; missing defaults to 5, integers 1-5 are accepted, and integers above 5 are clamped to 5. Zero, negative numbers, decimals, and strings are rejected.
- Sensitive fields such as tickets, files, OCR, blobs, cloud state, route cache, full local DB, notes, provider keys, headers, coordinates, items, days, and trip objects are rejected recursively as `invalid_request`.

Success shape:

```json
{
  "ok": true,
  "operation": "place_lookup",
  "source": "google_places",
  "retrievedAt": "2026-05-26T08:00:00.000Z",
  "results": [
    {
      "placeId": "places/abc123",
      "displayName": "明治神宫",
      "formattedAddress": "1-1 Yoyogikamizonocho, Shibuya City, Tokyo",
      "location": { "lat": 35.6764, "lng": 139.6993 },
      "googleMapsUri": "https://maps.google.com/?cid=123",
      "provider": "google_places",
      "retrievedAt": "2026-05-26T08:00:00.000Z"
    }
  ]
}
```

Google Places request policy:

- Endpoint: `POST https://places.googleapis.com/v1/places:searchText`.
- Body contains only `textQuery`, capped `pageSize`, optional `languageCode`, and optional `regionCode`.
- Header `X-Goog-FieldMask` is exactly `places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri`.
- Wildcard field masks (`*`) are never used. Opening hours, ratings, reviews, photos, phone, and website are intentionally not requested in this foundation.
- The proxy does not send trip DB, days/items, coordinates, notes, tickets, blobs, OCR, cloud state, route cache, provider keys, client headers, or AI context to Google Places.
- Google Places response data is normalized into the contract. Malformed candidates are dropped; malformed top-level responses return a normalized provider error. Raw provider bodies, headers, stack traces, `Authorization`, `Bearer`, and the API key are never returned.
- Google documents the Text Search New endpoint and recommends field masks for cost and latency control: https://developers.google.com/maps/documentation/places/web-service/text-search and https://developers.google.com/maps/documentation/places/web-service/choose-fields.

Item Detail write boundary:

- The lookup panel query is prefilled only from visible `locationName`, `address`, and `title`.
- Opening the item does not call the provider. The user must open the panel and click search.
- Selecting a candidate opens a confirmation dialog. Cancel makes no item change.
- Confirm updates only the current item: `locationName`, `address`, and `lat`/`lng` when the candidate includes valid coordinates.
- `googleMapsUri` is displayed only transiently and is not persisted because `ItineraryItem` has no existing safe field for it.
- Lookup does not generate routes, clear route cache, create or alter tickets, upload cloud snapshots, or call AI.

## AI Trip Edit Plan Operation

The `ai_trip_edit_plan` operation creates a safe patch plan for an already-saved local trip. It does not write IndexedDB, call route providers, create tickets, upload cloud snapshots, or call `travel_search` internally. When the UI has already performed a confirmed `travel_search`, it may attach compact source summaries to this request.

Runtime behavior:

- `TRIPMAP_PROVIDER_PROXY_MOCK=1` returns a deterministic mock patch plan.
- `TRIPMAP_AI_PROVIDER=openai_compatible` with complete server-side AI env calls the configured AI provider.
- Missing AI env returns `provider_unavailable`.
- Real provider output follows rawText → JSON extraction → `validateAiTripEditPatchPlan`.
- Invalid JSON, invalid IDs, forbidden fields, coordinates, ticket/route/cloud/provider fields, or unknown operations return `invalid_response`.
- Source is `mock` for mock mode and `future_ai` for real provider output.

Request contract:

```json
{
  "operation": "ai_trip_edit_plan",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "command": "第二天太满了，帮我放松一点",
  "searchResults": {
    "query": "杭州 西湖 开放时间",
    "source": "mock",
    "retrievedAt": "2026-01-01T00:00:00.000Z",
    "results": [
      {
        "title": "西湖开放时间模拟来源",
        "url": "https://travel.example/search/west-lake-hours",
        "displayUrl": "travel.example/search/west-lake-hours",
        "domain": "travel.example",
        "snippet": "模拟来源片段，不代表实时信息。",
        "retrievedAt": "2026-01-01T00:00:00.000Z",
        "sourceType": "official",
        "confidence": "medium"
      }
    ]
  },
  "context": {
    "trip": {
      "id": "trip-id",
      "title": "杭州两日",
      "destination": "杭州",
      "startDate": "2026-07-10",
      "endDate": "2026-07-11"
    },
    "days": [
      {
        "id": "day-id",
        "date": "2026-07-10",
        "title": "第一天",
        "items": [
          {
            "id": "item-id",
            "dayId": "day-id",
            "title": "西湖",
            "startTime": "09:00"
          }
        ]
      }
    ]
  }
}
```

Context boundary:

- Includes stable trip/day/item IDs, titles, dates, times, optional location text, optional coarse coordinate state, transport mode/duration, and ticket count/bound state only.
- Default strips notes. When AI Privacy allows note summary/full notes, only the allowed summary or note text is sent.
- Never sends ticket IDs, ticket filenames/content/blob, exact coordinates, route cache, cloud token/status, provider keys, URLs, or full local DB.
- Sensitive fields such as `apiKey`, `providerKey`, `Authorization`, `headers`, `ticketIds`, `ticketBlobs`, `ticketMetas`, `fileName`, `routeCache`, `localDb`, `fullTrip`, coordinates, cloud fields, and URLs are rejected as `invalid_request`.

Success shape:

```json
{
  "ok": true,
  "operation": "ai_trip_edit_plan",
  "source": "mock",
  "patchPlan": {
    "summary": "把西湖安排改得更明确。",
    "operations": [
      {
        "type": "update_item_title",
        "itemId": "item-id",
        "title": "西湖深度散步",
        "reason": "把标题改得更明确。"
      }
    ],
    "warnings": []
  }
}
```

Patch whitelist:

- `update_item_title`
- `update_item_time`
- `update_item_location_text`
- `update_item_note`
- `update_item_transport`
- `add_item`
- `remove_item`
- `move_item`
- `reorder_day_items`
- `update_day_title`

Validation rejects unknown operation types, unknown fields, forbidden sensitive fields, invalid IDs, invalid times, unsafe reorder lists, and plans with more than 20 operations. No-op plans are valid only with a clear warning. The UI must keep two confirmation gates: one before sending sanitized context, and one before applying the validated patch locally. Before applying, Trip Home reloads fresh IndexedDB state and rejects stale previews. Ticket-bound items are not AI-deleted; `ticketMetas`, `ticketBlobs`, route cache, cloud data, and backups are not touched.

## AI Trip Draft Operation

The `ai_trip_draft` operation allows the AI Draft page to request draft generation through the provider proxy.

### Request Contract

```json
{
  "operation": "ai_trip_draft",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "destination": "东京",
  "startDate": "2025-04-01",
  "endDate": "2025-04-05",
  "pace": "moderate",
  "preferTransport": "mixed",
  "mealTimeProtection": true,
  "mustVisitText": "浅草寺、秋叶原",
  "avoidText": "不要购物商场",
  "freeTextRequirement": "带老人出行，节奏放慢"
}
```

Limits:

- Destination: required, max 200 characters.
- Dates: strict YYYY-MM-DD format, endDate >= startDate, max 120 days.
- Free text fields: max 2000 characters each.
- No ticket blobs, cloud tokens, provider secrets, or API keys in the request.

### Response Contract

Success:

```json
{
  "ok": true,
  "operation": "ai_trip_draft",
  "source": "mock",
  "draft": {
    "title": "东京之旅",
    "destination": "东京",
    "startDate": "2025-04-01",
    "endDate": "2025-04-05",
    "days": [...]
  },
  "warnings": ["当前为本地示例草稿，非真实 AI 生成。"]
}
```

Errors use the same normalized error codes as `route_preview`.

### Current Behavior

- `TRIPMAP_PROVIDER_PROXY_MOCK=1`: Returns a deterministic mock draft using the same generator as the local mock button.
- `TRIPMAP_AI_PROVIDER=openai_compatible` with complete server-side env: calls the configured OpenAI-compatible AI provider.
- No mock and incomplete AI env: returns `provider_unavailable`.
- Real DeepSeek `deepseek-v4-flash` generation smoke has passed through this operation.

### Quota

AI draft requests have a separate, more conservative quota:

- Max 10 requests per 60-second window (vs 60 for route_preview).
- Quota is independent from route_preview quota.
- Identity is prefixed with `ai_draft|` to isolate from route quotas.

### Frontend

The proxy button appears only when `VITE_ROUTE_PROXY_URL` and `VITE_ROUTE_PROXY_PROVIDER` are configured. When not configured, a disabled button with "当前未配置 AI 生成服务" is shown.

Before calling the proxy, a confirmation dialog explains:

- Will generate via TripMap service
- May consume service quota
- Will not auto-create trip
- Preview and confirmation still required
- Will not read ticket images/PDF

### Real Provider Boundary

When a real AI provider is configured:

- The provider key lives only in server-side env (`TRIPMAP_AI_API_KEY`).
- The frontend never sees the key and never sends provider secrets.
- The response `source` field is `"future_ai"`.
- The draft must still pass JSON extraction and `validateAiTripDraft` schema validation.
- User must still confirm before writing to IndexedDB.
- The provider does not read tickets, blobs, cloud tokens, route cache, or full local DB.

### Real Provider Infrastructure

Current phase includes server-side infrastructure for real AI provider integration. Real calls are disabled by default and only enabled by server-side env.

**Modules:**

- `aiDraftLimits.ts` — per-request resource bounds (prompt size, output tokens, free text embed limit).
- `aiDraftPrompt.ts` — pure function that builds prompt from validated request. Free text capped at 500 chars per field. Prompt requires JSON-only output matching AiTripDraft schema.
- `aiDraftProvider.ts` / `aiDraftRealProvider.ts` — provider-agnostic interface with mock, unavailable, disabled, and OpenAI-compatible real provider implementations.
- `aiDraftResponse.ts` — extracts JSON from raw AI output (pure JSON or fenced blocks), validates against `validateAiTripDraft`. Returns `invalid_response` on failure.

**Prompt boundary:**

- Prompt does not include: ticket blobs, ticket images/PDF, cloud tokens, provider keys, full database, route cache, precise coordinates.
- Prompt instructs: dates must be YYYY-MM-DD, times must be HH:mm, no tickets, no routes, no cloud fields, no provider metadata, no fabricated transit line numbers, no route reordering.

**Response boundary:**

- Raw model output goes through `extractAiDraftJson` → `validateAiTripDraft`.
- Invalid output returns `invalid_response` error; raw model text is never passed to frontend.
- Error messages are generic; they do not contain raw model output or user input.

**Error codes:**

- `provider_unavailable` — no AI provider configured.
- `unsupported` — provider or operation is not implemented for the selected configuration.
- `invalid_response` — AI output cannot be parsed or validated.
- `provider_error`, `network_error`, `quota_exceeded` — standard provider errors.

**Production requirements:**

- Bind and migrate `TRIPMAP_PROVIDER_QUOTA_D1` using the checked-in D1 migrations.
- Set `TRIPMAP_PROVIDER_PROXY_ENV=production`, `TRIPMAP_PROVIDER_PROXY_REQUIRE_AUTH=1`, and the canonical Origin allowlist.
- Provide Supabase public Auth configuration server-side; the proxy validates every access token before provider execution.
- Deploy the hourly maintenance Worker. Email alert delivery remains optional until the free verified-destination prerequisites exist.
- Keep upstream provider billing alerts and key rotation in place; D1 limits are an application boundary, not a replacement for provider-side controls.

### Real AI Provider Configuration

Real AI calls are disabled by default. To enable, set server-side env vars:

```env
TRIPMAP_AI_PROVIDER=openai_compatible
TRIPMAP_AI_API_KEY=your-api-key
TRIPMAP_AI_BASE_URL=https://api.example.com/v1
TRIPMAP_AI_MODEL=gpt-4o-mini
```

- `TRIPMAP_AI_PROVIDER` — `disabled` (default), `mock`, or `openai_compatible`.
- `TRIPMAP_AI_API_KEY` — server-only secret, never exposed to frontend.
- `TRIPMAP_AI_BASE_URL` — OpenAI-compatible endpoint. Recommended form: `https://.../v1`.
- `TRIPMAP_AI_MODEL` — model identifier.

For DeepSeek smoke QA, the current model is `deepseek-v4-flash` with `TRIPMAP_AI_BASE_URL` pointing to the DeepSeek OpenAI-compatible API base. Do not put the AI key in `VITE_*` env or user-facing settings.

When `TRIPMAP_AI_PROVIDER=openai_compatible` and all env vars are set, the proxy sends a `POST` to `{baseURL}/chat/completions` with `Authorization: Bearer {apiKey}`. The request contains only model, messages, max_tokens, `response_format: { type: "json_object" }`, and backend-selected reasoning fields. Default, simple, and `auto` requests use `temperature: 0.2` with `thinking: { type: "disabled" }`; backend-selected `high` requests use `thinking: { type: "enabled" }` with `reasoning_effort: "high"` and omit temperature. The upstream timeout is 60 seconds. No tickets, blobs, cloud tokens, route cache data, or provider secrets are included in the request body.

The response goes through `normalizeAiDraftProviderOutput` (JSON extraction + `validateAiTripDraft`). Invalid output returns `invalid_response`; raw model text is never passed to the frontend.

Mock mode (`TRIPMAP_PROVIDER_PROXY_MOCK=1`) always takes priority over real provider.

Frontend behavior is unchanged: the "通过旅图服务生成草稿" button triggers the same proxy flow regardless of whether mock or real provider responds. User confirmation is still required before writing to IndexedDB.

### AI Provider Runtime Notes

Current usable AI provider status:

- Real generation: usable behind `/api/provider-proxy`; DeepSeek `deepseek-v4-flash` smoke passed.
- Real repair: usable behind `/api/provider-proxy`; DeepSeek `deepseek-v4-flash` repair smoke passed.
- Trip edit plan: foundation is usable behind `/api/provider-proxy`; it returns a validated patch plan and diff preview, not a direct database write.
- Key boundary: `TRIPMAP_AI_API_KEY` stays server-side. It must not appear in frontend bundles, IndexedDB, zip backups, Supabase snapshots, reports, logs, screenshots, or docs.
- Validation path for drafts: provider raw text → JSON extraction → `validateAiTripDraft` → preview update. Import still requires final user confirmation.
- Validation path for edit plans: provider raw text → JSON extraction → `validateAiTripEditPatchPlan` → diff preview → final local apply confirmation.
- Reasoning mode: backend-managed policy, not a user-facing feature. The default path remains fast/stable JSON mode with `thinking: { type: "disabled" }`; complex tasks may be classified server-side for higher reasoning.
- Web search: available only through the explicit `travel_search` proxy operation when configured. Current AI must not claim real-time opening hours, tickets, transportation, weather, reviews, events, or web sources unless source-bearing search results were attached to the request.

Future AI provider work should keep web search separate from repair and reasoning. Search must remain the `travel_search` provider proxy operation with sourced results shaped around title, URL, display URL, domain, snippet, `retrievedAt`, source type, confidence, quota, and source display in the UI. AI tool use must cite source URLs and `retrievedAt`; it must not mix unsourced realtime claims into normal AI reasoning.

### AI Backend Reasoning Policy

Reasoning is selected server-side from operation complexity. The frontend does not expose model controls, reasoning selectors, search toggles, or localStorage-backed AI mode settings.

- Generation defaults to `off`; longer trips may be classified as `auto` or `high` from date-range and item-count signals.
- Repair defaults to `off`; many findings, critical findings, dense drafts, or long repair instructions may be classified as `auto` or `high`.
- Trip edit planning defaults to `off`; very large contexts or long edit commands may be classified as `auto` or `high`.
- `off` maps to `thinking: { type: "disabled" }` and `temperature: 0.2`.
- `auto` currently maps conservatively to the same disabled-thinking request shape for this release.
- `high` maps to `thinking: { type: "enabled" }` and `reasoning_effort: "high"` and omits temperature.
- Frontend-provided repair `reasoningMode` is accepted only for compatibility and does not force provider behavior.

This policy keeps the user experience simple: users describe the travel task, while the backend chooses provider-specific reasoning behavior inside the secret-safe proxy boundary.

### AI Search Readiness

Search readiness is explicit-tool only for AI Trip Edit in this release. The UI can detect clear search intent, ask for confirmation, call `travel_search` at most once, then call `ai_trip_edit_plan` at most once with compact source summaries. There is no autonomous browsing loop or provider-internal tool calling.

- Search provider env is server-only: `TRIPMAP_SEARCH_PROVIDER=disabled|mock|tavily` and `TRIPMAP_SEARCH_API_KEY`.
- No `webSearchEnabled` field is added to public AI request payloads.
- No AI prompt should claim web search happened unless source-bearing `searchResults` are present.
- `travel_search` mock succeeds in mock mode, default runtime returns `provider_unavailable`, disabled mode returns `unsupported`, and Tavily mode returns normalized `future_search` results when the server key is present.
- Sourced search results include title, URL, display URL, domain, snippet, `retrievedAt`, source type, and confidence when derivable.
- Real search remains proxy-quota-gated under `search|`; provider free/dev quotas and rate limits are separate operational constraints.

### Real Provider Smoke QA

DeepSeek `deepseek-v4-flash` was used through the OpenAI-compatible adapter for real provider smoke tests.

**Generation smoke result:**

- User confirmation appeared before any provider request.
- After user confirmed, exactly 1 request was sent to the AI provider endpoint.
- Response went through `extractAiDraftJson` + `validateAiTripDraft` successfully.
- Preview displayed a valid draft.
- IndexedDB had zero trip/route/ticket writes before user clicked "确认导入".
- No ticket, blob, cloud token, route cache, provider metadata, API key, raw provider body, Authorization header content, or stack trace was visible in page text.
- Response `source` field was `future_ai` (not `mock`).

**Repair smoke result:**

- User clicked repair, saw ConfirmDialog, then confirmed.
- Successful smoke sent exactly 1 frontend `ai_trip_draft_repair` request to `/api/provider-proxy`.
- Server-to-DeepSeek `/chat/completions` count was not browser-observable; it is inferred as 1 from the handler's single fetch/no retry path.
- Repaired draft returned, JSON extraction succeeded, `validateAiTripDraft` passed, preview and JSON textarea updated.
- Before final import, IndexedDB counts stayed unchanged.
- No route generation/cache, ticket creation, cloud upload/delete, or sortOrder optimization occurred.
- Page/dist checks found no API key, Bearer header, raw provider body such as `choices`, or stack trace leakage.

**Security:**

- AI key configured: yes, masked.
- `.env.local` / `.dev.vars` are gitignored and never committed.
- If a key or key prefix was ever copied into chat logs or session context, consider rotating the key.

### PWA Service Worker — Local QA Note

When doing local QA or development with `wrangler pages dev`, a stale PWA service worker may cache an older build bundle. Symptoms: the page loads but the UI shows an outdated state (e.g., "当前未配置 AI 生成服务" button remains disabled even though env vars are set).

**Workaround:**

1. Unregister the service worker (browser DevTools → Application → Service Workers → Unregister).
2. Clear site data / cache (DevTools → Application → Storage → Clear site data).
3. Hard refresh the page.

This is a local dev/QA workflow issue, not a provider adapter bug.

### Local Shell Proxy Env - Local QA Note

When doing real-provider smoke QA with `wrangler pages dev`, local shell proxy variables such as `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` can affect the Workerd process even if direct DeepSeek checks are healthy. During repair diagnostics, direct DeepSeek API checks were fast and successful, while the local Pages dev proxy chain showed intermittent 30-second `network_error` timeouts.

If a real provider smoke fails only through local `wrangler pages dev`, restart the wrangler process with those proxy env vars unset before diagnosing credentials, model access, DNS, or TLS.

This is a local dev/QA workflow issue. Keep AI provider keys server-side in `.dev.vars`, `.env.local`, or deployment runtime bindings; do not add `VITE_` AI secrets or user-facing API key settings.

### Pages Binding Env - Local QA Note

`wrangler pages dev` must see real provider configuration through the Pages Function `context.env` binding path. Do not assume `.env.local`, `.dev.vars`, or `--env-file` values are automatically available to `context.env` for every local Pages run. A symptom is a real provider that works in a direct masked API check but returns normalized `provider_unavailable` through `/api/provider-proxy`.

For production and preview, configure provider values in Cloudflare Pages environment variables/secrets. For Tavily travel search:

- `TRIPMAP_SEARCH_PROVIDER=tavily`
- `TRIPMAP_SEARCH_API_KEY=<server-side secret>`

For local real-provider smoke, prefer a temporary Wrangler config or another safe Pages-compatible binding/secret injection path. Do not pass real API keys directly as command-line arguments, because process listings and shell history can expose them. If a local smoke needs to prove binding behavior without secrets, use a non-secret value such as `TRIPMAP_SEARCH_PROVIDER=mock` first.

### AI Trip Draft Repair Operation

The `ai_trip_draft_repair` operation allows the AI Draft page to request draft repair through the provider proxy.

#### Request Contract

```json
{
  "operation": "ai_trip_draft_repair",
  "requestId": "client-request-id",
  "quotaSessionId": "browser-session-id",
  "draft": { "title": "...", "destination": "...", "days": [...] },
  "qualityFindings": [
    { "ruleId": "dense_day", "severity": "warning", "title": "...", "message": "..." }
  ],
  "repairInstruction": "optional user guidance, max 1000 chars",
  "reasoningMode": "auto"
}
```

- `draft` must pass `validateAiTripDraft` before sending.
- `qualityFindings` is a sanitized subset: ruleId, severity, title, message, dayDate.
- `repairInstruction` max 1000 chars.
- `reasoningMode`: accepted for client contract compatibility only. The handler computes the final reasoning mode from backend policy; the frontend cannot force high thinking.
- No ticket blobs, cloud tokens, provider secrets, route cache, or API keys in the request.

#### Response Contract

Same shape as `ai_trip_draft` response, with `operation: "ai_trip_draft_repair"`.

#### Quota

- Max 5 requests per 60-second window.
- Identity prefix: `ai_draft_repair|` — isolated from `ai_draft|` and `route|` quotas.

### Client-Side Privacy Filtering

Before sending AI draft or repair requests to the proxy, the client applies privacy settings (`src/lib/aiPrivacyGuard.ts`):

- **Generation requests** already contain only explicit form fields — no extra data attached.
- **Repair requests**: item `note` fields are stripped or truncated based on the `allowFullNotes` and `allowNotesSummary` settings. Quality findings are filtered too.
- Privacy settings are read from `localStorage` at request time and applied as pure functions before the fetch call.
- This filtering is applied client-side; the server also validates required fields but does not enforce user privacy preferences.

#### Provider Behavior

- Mock mode: deterministic simple repair (add meal items, replace generic titles).
- Real provider: OpenAI-compatible adapter, same raw text → JSON extraction → validate flow.
- Disabled/unavailable: returns `provider_unavailable` / `unsupported`.
- Repair is draft-level only: it does not search the web, read ticket images/PDF/OCR, or modify saved trips directly.

#### Security

- No API key, raw provider body, or stack trace in response.
- Draft goes through `normalizeAiDraftProviderOutput` → `validateAiTripDraft`.
- Invalid output returns `invalid_response`.
