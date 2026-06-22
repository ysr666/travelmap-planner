import { describe, expect, it, vi } from 'vitest'
import {
  PROVIDER_BUDGET_ALERT_RECIPIENT,
  checkProviderControl,
  consumeProviderDailyBudgets,
  createProviderOperationsMemoryStorage,
  getProviderDailyBudgetLimits,
  getProviderOperationGroup,
  isProviderKilledByEnvironment,
  type ProviderOperationsStorage,
} from './providerOperationsGuard'

describe('provider operations guard', () => {
  it('maps operations to budget groups and scales preview budgets to 25 percent', () => {
    expect(getProviderOperationGroup('route_preview')).toBe('route')
    expect(getProviderOperationGroup('travel_search')).toBe('search')
    expect(getProviderOperationGroup('place_details')).toBe('place')
    expect(getProviderOperationGroup('exchange_rate')).toBe('fx')
    expect(getProviderOperationGroup('ai_trip_draft')).toBe('ai')
    expect(getProviderDailyBudgetLimits('preview')).toEqual({
      account: { ai: 5, fx: 8, place: 15, route: 25, search: 5 },
      global: { ai: 50, fx: 75, place: 150, route: 250, search: 50 },
      ip: { ai: 25, fx: 38, place: 75, route: 125, search: 25 },
    })
  })

  it('enforces account daily budgets independently of client session identity', async () => {
    const storage = createProviderOperationsMemoryStorage()
    for (let count = 1; count < 20; count += 1) {
      await expect(consumeProviderDailyBudgets({
        accountId: 'verified-user',
        environment: 'production',
        group: 'ai',
        ip: '203.0.113.10',
        nowMs: Date.parse('2026-06-22T01:00:00.000Z'),
        storage,
      })).resolves.toEqual({ allowed: true })
    }
    await expect(consumeProviderDailyBudgets({
      accountId: 'verified-user',
      environment: 'production',
      group: 'ai',
      ip: '203.0.113.10',
      nowMs: Date.parse('2026-06-22T01:00:00.000Z'),
      storage,
    })).resolves.toMatchObject({ allowed: false, reason: 'budget_exceeded' })
  })

  it('enforces one IP budget across different verified accounts', async () => {
    const storage = createProviderOperationsMemoryStorage()
    for (let count = 1; count < 100; count += 1) {
      await expect(consumeProviderDailyBudgets({
        accountId: `verified-user-${count}`,
        environment: 'production',
        group: 'ai',
        ip: '203.0.113.20',
        nowMs: Date.parse('2026-06-22T01:00:00.000Z'),
        storage,
      })).resolves.toEqual({ allowed: true })
    }
    await expect(consumeProviderDailyBudgets({
      accountId: 'verified-user-100',
      environment: 'production',
      group: 'ai',
      ip: '203.0.113.20',
      nowMs: Date.parse('2026-06-22T01:00:00.000Z'),
      storage,
    })).resolves.toMatchObject({ allowed: false, reason: 'budget_exceeded' })
  })

  it('sends one sanitized alert at global 70 percent and marks it complete', async () => {
    const alertSender = vi.fn(async () => undefined)
    const completeAlert = vi.fn(async () => undefined)
    const storage = fakeStorage({ globalCount: 140, completeAlert })
    const result = await consumeProviderDailyBudgets({
      accountId: 'user-secret',
      alertSender,
      environment: 'production',
      group: 'ai',
      ip: '203.0.113.99',
      nowMs: Date.parse('2026-06-22T02:00:00.000Z'),
      storage,
    })

    expect(result).toEqual({ allowed: true })
    expect(alertSender).toHaveBeenCalledWith({
      environment: 'production',
      group: 'ai',
      occurredAt: '2026-06-22T02:00:00.000Z',
      threshold: 70,
      to: PROVIDER_BUDGET_ALERT_RECIPIENT,
    })
    expect(JSON.stringify(alertSender.mock.calls)).not.toContain('user-secret')
    expect(JSON.stringify(alertSender.mock.calls)).not.toContain('203.0.113.99')
    expect(completeAlert).toHaveBeenCalledTimes(1)
  })

  it('rejects and auto-disables a group at 100 percent global budget', async () => {
    const disableGroup = vi.fn(async () => true)
    const storage = fakeStorage({ disableGroup, globalCount: 200 })
    await expect(consumeProviderDailyBudgets({
      accountId: 'verified-user',
      environment: 'production',
      group: 'ai',
      ip: '203.0.113.10',
      nowMs: Date.parse('2026-06-22T23:00:00.000Z'),
      storage,
    })).resolves.toMatchObject({ allowed: false, reason: 'budget_exceeded' })
    expect(disableGroup).toHaveBeenCalledWith('ai', Date.parse('2026-06-23T00:00:00.000Z'), expect.any(Number))
  })

  it('honors environment and D1 group kill switches', async () => {
    expect(isProviderKilledByEnvironment({ TRIPMAP_PROVIDER_PROXY_KILL_SWITCH: 'search,route' }, 'route')).toBe(true)
    expect(isProviderKilledByEnvironment({ TRIPMAP_PROVIDER_PROXY_KILL_SWITCH: 'search,route' }, 'ai')).toBe(false)
    await expect(checkProviderControl({
      env: {},
      group: 'route',
      nowMs: 1,
      storage: { ...createProviderOperationsMemoryStorage(), getControl: vi.fn(async (group) => ({ enabled: group !== 'route' })) },
    })).resolves.toEqual({ enabled: false })
  })
})

function fakeStorage(input: {
  completeAlert?: ProviderOperationsStorage['completeAlert']
  disableGroup?: ProviderOperationsStorage['disableGroup']
  globalCount: number
}): ProviderOperationsStorage {
  return {
    claimAlert: vi.fn(async () => true),
    completeAlert: input.completeAlert ?? vi.fn(async () => undefined),
    consumeDaily: vi.fn(async (entry) => ({ allowed: true as const, count: entry.scope === 'global' ? input.globalCount : 1 })),
    disableGroup: input.disableGroup ?? vi.fn(async () => true),
    getControl: vi.fn(async () => ({ enabled: true })),
    releaseAlert: vi.fn(async () => undefined),
  }
}
