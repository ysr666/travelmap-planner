# Provider Proxy

TripMap uses a provider proxy so production route and future AI requests can use owner-provided provider keys without shipping those keys to the PWA.

## Security Boundary

- The browser calls a TripMap-owned endpoint, normally `/api/provider-proxy`.
- The proxy calls Google Routes, OpenRouteService, and future AI providers with server-side runtime secrets.
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

Later:

- Route order suggestion should become a separate proxy operation.
- Future AI generation should reuse the same contract, quota guard, normalized errors, and server-secret boundary.

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
- No mock and no AI provider key: Returns `provider_unavailable`.
- No real AI provider integration exists yet.

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

### Future

When a real AI provider is integrated:

- The provider key lives only in server-side env (`TRIPMAP_AI_PROVIDER_KEY`).
- The frontend never sees the key.
- The response `source` field changes to `"future_ai"`.
- The draft must still pass `validateAiTripDraft` schema validation.
- User must still confirm before writing to IndexedDB.

### Real Provider Preparation

Current phase adds server-side infrastructure for future AI provider integration. No real AI calls are made.

**Modules:**

- `aiDraftLimits.ts` — per-request resource bounds (prompt size, output tokens, free text embed limit).
- `aiDraftPrompt.ts` — pure function that builds prompt from validated request. Free text capped at 500 chars per field. Prompt requires JSON-only output matching AiTripDraft schema.
- `aiDraftProvider.ts` — provider-agnostic interface with three implementations: `mock` (deterministic), `unavailable` (no key), `disabled` (key exists but no real provider yet).
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
- `unsupported` — AI provider key exists but no real provider implemented.
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

When `TRIPMAP_AI_PROVIDER=openai_compatible` and all env vars are set, the proxy sends a `POST` to `{baseURL}/chat/completions` with `Authorization: Bearer {apiKey}`. The request contains only model, messages, temperature (0.2), and max_tokens. No tickets, blobs, cloud tokens, or provider secrets are included in the request body.

The response goes through `normalizeAiDraftProviderOutput` (JSON extraction + `validateAiTripDraft`). Invalid output returns `invalid_response`; raw model text is never passed to the frontend.

Mock mode (`TRIPMAP_PROVIDER_PROXY_MOCK=1`) always takes priority over real provider.

Frontend behavior is unchanged: the "通过旅图服务生成草稿" button triggers the same proxy flow regardless of whether mock or real provider responds. User confirmation is still required before writing to IndexedDB.

### Real Provider Smoke QA

DeepSeek `deepseek-v4-flash` was used through the OpenAI-compatible adapter for a 1-request smoke test on branch `main` (commit `68df05c`).

**Request budget:** Exactly 1 real API call. Zero requests before user confirmation.

**Results:**

- Confirmation dialog appeared before any provider request.
- After user confirmed, exactly 1 request was sent to the AI provider endpoint.
- Response went through `extractAiDraftJson` + `validateAiTripDraft` successfully.
- Preview displayed a valid draft with correct title, dates, days, and itinerary items.
- IndexedDB had zero trip/route/ticket writes before user clicked "确认导入".
- No ticket, blob, cloud token, route cache, or provider metadata in request or response.
- No API key, raw provider body, Authorization header content, or stack trace visible in page text.
- Response `source` field was `future_ai` (not `mock`).

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
- `reasoningMode`: `off` (0.1), `auto` (0.2), `high` (0.4).
- No ticket blobs, cloud tokens, provider secrets, route cache, or API keys in the request.

#### Response Contract

Same shape as `ai_trip_draft` response, with `operation: "ai_trip_draft_repair"`.

#### Quota

- Max 5 requests per 60-second window.
- Identity prefix: `ai_draft_repair|` — isolated from `ai_draft|` and `route|` quotas.

#### Provider Behavior

- Mock mode: deterministic simple repair (add meal items, replace generic titles).
- Real provider: OpenAI-compatible adapter, same raw text → JSON extraction → validate flow.
- Disabled/unavailable: returns `provider_unavailable` / `unsupported`.

#### Security

- No API key, raw provider body, or stack trace in response.
- Draft goes through `normalizeAiDraftProviderOutput` → `validateAiTripDraft`.
- Invalid output returns `invalid_response`.
