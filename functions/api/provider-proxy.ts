import { handleProviderProxyRequest } from '../../server/providerProxy/providerProxyHandler'
import type { ProviderProxyHandlerEnv } from '../../server/providerProxy/providerProxyHandler'

type ProviderProxyPagesContext = {
  env: ProviderProxyHandlerEnv
  request: Request
}

export function onRequest(context: ProviderProxyPagesContext) {
  return handleProviderProxyRequest({
    env: context.env,
    fetcher: fetch,
    request: context.request,
  })
}
