# Provider Proxy

TripMap uses a provider proxy so production route and AI requests can use owner-provided provider keys without shipping those keys to the PWA.

## Security Boundary

- The browser calls a TripMap-owned endpoint, normally `/api/provider-proxy`.
- The proxy calls Google Routes, OpenRouteService, and AI providers with server-side runtime secrets.
- Server-only secrets must be runtime bindings such as `OPENROUTESERVICE_API_KEY` and `GOOGLE_ROUTES_API_KEY`.
- Server-only secrets must never be exposed through `VITE_*` variables, IndexedDB, zip backups, Supabase backups, AI import/export, tests, or frontend bundles.
- A browser-visible Google Maps JavaScript rendering key is different: it is inherently public and must be restricted by referrer in Google Cloud. It must not be reused as a server-only Google Routes secret.

## Cloudflare Pages Function

The first backend target is a Cloudflare Pages Function:

- Entry: `functions/api/provider-proxy.ts`
- Reusable edge-compatible logic: `server/providerProxy/*`
- Runtime env is read from the Pages Function context/env binding.
- The handler does not read provider secrets from `import.meta.env`.

Local Cloudflare worker development can use uncommitted local files such as `.dev.vars` or `.env` for worker runtime secrets. Do not commit those files, and do not mirror provider secrets into `VITE_*` variables.

## Request Contract

Current operation:

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

The current quota guard is intentionally small:

- In-memory/dev-only request windows.
- Per-browser `quotaSessionId` plus server-observed IP placeholder.
- Max route requests per window default: 60 requests per 60 seconds.
- Max ai_trip_edit_plan requests per window default: 10 requests per 60 seconds.
- Max travel_search requests per window default: 20 requests per 60 seconds.
- `ai_trip_edit|` and `travel_search|` quota buckets are isolated from `route|`, `ai_draft|`, and `ai_draft_repair|`.

This is not real abuse protection. The browser session id is spoofable. Before public launch, replace the in-memory store with durable KV, Supabase, Redis, or equivalent, and combine account/session/IP/fingerprint-like server signals where legally and technically appropriate.

## Frontend Behavior

Production proxy mode is enabled with:

```env
VITE_ROUTE_PROXY_URL=/api/provider-proxy
VITE_ROUTE_PROXY_PROVIDER=openrouteservice
```

`VITE_ROUTE_PROXY_PROVIDER` must be concrete so local route cache identity remains stable. The frontend may have `source: "proxy"` at runtime, but persisted route cache entries remain provider-specific.

If the proxy URL is absent, legacy direct local/dev route behavior remains so existing local QA and direct-provider tests keep working. Normal users should not be asked to enter provider keys, and Settings must not expose Google/ORS key fields.

## What Moves Behind The Proxy

Now:

- Manual day route generation can use the proxy when configured.
- Trip Home route generation can use the proxy after user confirmation.
- Trip Home map preview still reads cached route geometry or displays straight lines; it does not silently call providers.
- AI draft generation can use the proxy after user confirmation.
- AI draft repair can use the proxy after user confirmation and only updates the draft preview.
- AI trip edit planning can use the proxy after user confirmation and only returns a patch plan preview; applying the patch requires a second local confirmation.
- `travel_search` foundation exists as a typed provider proxy operation, but current runtime is mock/disabled only and no UI calls it.

Later:

- Route order suggestion should become a separate proxy operation.
- Real web search provider integration should remain a separate proxy operation with its own contract, quota, source display, and write confirmation boundary.

## Travel Search Operation

The `travel_search` operation reserves a source-bearing search contract for future travel/web search. It is not a real-time fact source yet.

Current runtime behavior:

- `TRIPMAP_PROVIDER_PROXY_MOCK=1` returns deterministic mock results only.
- Mock results use `source: "mock"`, `travel.example` URLs, and warning `当前为模拟搜索结果，不代表实时网页信息。`
- Without a real search provider, non-mock runtime returns `provider_unavailable`.
- `future_search` is a reserved response source for future real providers and must not be returned by the current implementation.
- No search API key/env exists, no external search API is called, and no frontend UI calls this operation.

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
- `searchType`: optional, `general`, `place`, `opening_hours`, `tickets`, `transport`, or `reviews`; default `general`.
- `maxResults`: optional integer 1-10; default 5.
- Sensitive fields such as `apiKey`, `providerKey`, `Authorization`, `headers`, `ticketBlobs`, `cloudToken`, `routeCache`, and `fullTrip` are rejected as `invalid_request`.

Success shape:

```json
{
  "ok": true,
  "operation": "travel_search",
  "source": "mock",
  "query": "杭州博物馆 营业时间",
  "results": [
    {
      "id": "mock-example",
      "title": "模拟搜索结果",
      "url": "https://travel.example/search/mock-example",
      "sourceDomain": "travel.example",
      "snippet": "模拟搜索片段，不代表实时网页信息。",
      "retrievedAt": "2026-01-01T00:00:00.000Z",
      "confidence": "low"
    }
  ],
  "warnings": ["当前为模拟搜索结果，不代表实时网页信息。"]
}
```

## AI Trip Edit Plan Operation

The `ai_trip_edit_plan` operation creates a safe patch plan for an already-saved local trip. It does not write IndexedDB, call route providers, create tickets, upload cloud snapshots, or call `travel_search`.

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

- Durable quota store (KV / Supabase / Redis) to replace in-memory Map.
- Origin allowlist and account/session/IP controls.
- Billing and abuse protection.

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
- Web search: not integrated. Current AI does not look up real-time opening hours, tickets, transportation, weather, reviews, events, or web sources, and must not claim it did.

Future AI provider work should keep web search separate from repair. Search should be a new provider proxy operation with sourced results shaped around title, URL, snippet, `retrievedAt`, source/domain, confidence, quota, and source display in the UI.

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

Search readiness is classification-only for AI flows in this release. The server helper can mark that a future search operation might be relevant for opening hours, tickets, closures, transport disruption, recent reviews, or events, but AI draft generation and repair do not call search.

- No search provider key or env var is defined.
- No `webSearchEnabled` field is added to public AI request payloads.
- No AI prompt should claim web search happened.
- `travel_search` exists only as a provider proxy foundation: mock succeeds in mock mode, default runtime returns `provider_unavailable`, and no page uses it yet.
- Future sourced search results should include title, URL, snippet, `retrievedAt`, source/domain, and confidence.

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
