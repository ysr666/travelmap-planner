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
