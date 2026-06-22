import { describe, expect, it, vi } from 'vitest'
import { runProviderMaintenance } from './providerMaintenance'
import type {
  ProviderProxyD1Database,
  ProviderProxyD1PreparedStatement,
  ProviderProxyD1Result,
} from './quotaGuard'

describe('provider maintenance', () => {
  it('cleans retained rows, restores expired controls, and sends only redacted alert fields', async () => {
    const fake = createMaintenanceD1()
    const alertSender = vi.fn(async () => undefined)
    const result = await runProviderMaintenance({
      alertSender,
      d1: fake.database,
      nowMs: Date.parse('2026-06-22T12:00:00.000Z'),
    })

    expect(result).toEqual({ alertsSent: 1, controlsRestored: 1, dailyRowsDeleted: 2, minuteRowsDeleted: 3, oldAlertsDeleted: 4 })
    expect(alertSender).toHaveBeenCalledWith({
      environment: 'production',
      group: 'route',
      occurredAt: '2026-06-22T11:00:00.000Z',
      threshold: 90,
      to: 'ysr182@qq.com',
    })
    const text = JSON.stringify(alertSender.mock.calls)
    expect(text).not.toContain('Authorization')
    expect(text).not.toContain('coordinate')
    expect(text).not.toContain('provider payload')
    expect(fake.queries.some((query) => query.includes('DELETE FROM provider_quota'))).toBe(true)
    expect(fake.queries.some((query) => query.includes("usage_date < ?"))).toBe(true)
  })
})

function createMaintenanceD1() {
  const queries: string[] = []
  class Statement implements ProviderProxyD1PreparedStatement {
    constructor(private readonly query: string) {}
    bind() { return this }
    async first<T>() { return null as T | null }
    async all<T>() {
      return this.query.includes('WHERE sent_at IS NULL')
        ? { results: [{ created_at: Date.parse('2026-06-22T11:00:00.000Z'), environment: 'production', group_name: 'route', id: 'alert-1', threshold: 90 }] as T[] }
        : { results: [] as T[] }
    }
    async run(): Promise<ProviderProxyD1Result> {
      if (this.query.includes('provider_quota')) return { meta: { changes: 3 }, success: true }
      if (this.query.includes('provider_daily_usage')) return { meta: { changes: 2 }, success: true }
      if (this.query.includes('DELETE FROM provider_alerts')) return { meta: { changes: 4 }, success: true }
      if (this.query.includes('UPDATE provider_controls')) return { meta: { changes: 1 }, success: true }
      return { meta: { changes: 1 }, success: true }
    }
  }
  const database: ProviderProxyD1Database = {
    prepare(query) {
      queries.push(query)
      return new Statement(query)
    },
  }
  return { database, queries }
}
