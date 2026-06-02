import { buildProviderProxyDiagnosticsResponse } from '../../server/providerProxy/providerProxyDiagnostics'
import type { ProviderProxyHandlerEnv } from '../../server/providerProxy/providerProxyHandler'

type ProviderProxyDiagnosticsPagesContext = {
  env: ProviderProxyHandlerEnv
  request: Request
}

export function onRequest(context: ProviderProxyDiagnosticsPagesContext) {
  const corsHeaders = getCorsHeaders(context.request, context.env)
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Allow: 'GET, OPTIONS',
      },
      status: 204,
    })
  }

  if (context.request.method !== 'GET') {
    return jsonResponse({ code: 'unsupported', ok: false, message: 'Provider proxy diagnostics only supports GET requests.' }, 405, corsHeaders, {
      Allow: 'GET, OPTIONS',
    })
  }

  return jsonResponse(buildProviderProxyDiagnosticsResponse(context.env), 200, corsHeaders)
}

function getCorsHeaders(request: Request, env: ProviderProxyHandlerEnv): Record<string, string> {
  const origin = request.headers.get('Origin')
  if (!origin) {
    return {}
  }
  const allowedOrigins = new Set((env.TRIPMAP_PROVIDER_PROXY_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean))
  if (!allowedOrigins.has(origin) && !allowedOrigins.has('*')) {
    return {}
  }
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has('*') ? '*' : origin,
    Vary: 'Origin',
  }
}

function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...corsHeaders,
      ...extraHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
    status,
  })
}
