import { handleProviderProxyRequest } from '../../server/providerProxy/providerProxyHandler'

type ProviderProxyPagesContext = {
  env: Record<string, string | undefined>
  request: Request
}

export function onRequest(context: ProviderProxyPagesContext) {
  return handleProviderProxyRequest({
    env: context.env,
    fetcher: fetch,
    request: context.request,
  })
}
