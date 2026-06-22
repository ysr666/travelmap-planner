import {
  runProviderMaintenance,
  selectProviderMaintenanceAlertSender,
} from '../../server/providerProxy/providerMaintenance'
import type { ProviderProxyD1Database } from '../../server/providerProxy/quotaGuard'

type ProviderMaintenanceEnv = {
  TRIPMAP_PROVIDER_ALERT_EMAIL?: unknown
  TRIPMAP_PROVIDER_ALERT_FROM?: string
  TRIPMAP_PROVIDER_QUOTA_D1: ProviderProxyD1Database
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
  async scheduled(
    _controller: unknown,
    env: ProviderMaintenanceEnv,
    context: { waitUntil(promise: Promise<unknown>): void },
  ) {
    context.waitUntil(runProviderMaintenance({
      alertSender: selectProviderMaintenanceAlertSender(env),
      d1: env.TRIPMAP_PROVIDER_QUOTA_D1,
    }))
  },
}
