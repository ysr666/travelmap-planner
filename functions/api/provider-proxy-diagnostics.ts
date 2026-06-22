import { buildProviderProxyDiagnosticsResponse } from '../../server/providerProxy/providerProxyDiagnostics'
import type { ProviderProxyHandlerEnv } from '../../server/providerProxy/providerProxyHandler'
import { evaluateProviderOrigin } from '../../server/providerProxy/providerRequestSecurity'
import { resolveProviderRuntimeEnvironment } from '../../server/providerProxy/providerOperationsGuard'

type ProviderProxyDiagnosticsPagesContext = {
  env: ProviderProxyHandlerEnv
  request: Request
}

export function onRequest(context: ProviderProxyDiagnosticsPagesContext) {
  const origin = evaluateProviderOrigin(context.request, context.env, resolveProviderRuntimeEnvironment(context.env))
  if (!origin.allowed) {
    return jsonResponse({ code: 'invalid_request', ok: false, message: 'Provider diagnostics origin is not allowed.' }, 403, {})
  }
  const corsHeaders = origin.corsHeaders
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
