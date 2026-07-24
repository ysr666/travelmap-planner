import type { ProviderProxyOperation } from '../../src/lib/ai/providerProxyContract'
import {
  hashProviderProxyQuotaIdentity,
  type ProviderProxyD1Database,
} from './quotaGuard'

export type ProviderOperationGroup = 'ai' | 'search' | 'place' | 'route' | 'fx'
export type ProviderControlGroup = 'global' | ProviderOperationGroup
export type ProviderBudgetScope = 'account' | 'ip' | 'global'
export type ProviderRuntimeEnvironment = 'production' | 'preview' | 'development'

export type ProviderDailyBudgetLimits = Record<
  ProviderBudgetScope,
  Record<ProviderOperationGroup, number>
>

export type ProviderOperationsStorage = {
  consumeDaily(input: {
    environment: ProviderRuntimeEnvironment
    group: ProviderOperationGroup
    identityHash: string
    limit: number
    nowMs: number
    scope: ProviderBudgetScope
  }): Promise<{ allowed: true; count: number } | { allowed: false; count?: number; reason: 'budget_exceeded' | 'storage_error' }>
  getControl(group: ProviderControlGroup, nowMs: number): Promise<{ enabled: boolean; reason?: string } | { enabled: false; reason: 'storage_error' }>
  disableGroup(group: ProviderOperationGroup, disabledUntil: number, nowMs: number): Promise<boolean>
  claimAlert(input: {
    environment: ProviderRuntimeEnvironment
    group: ProviderOperationGroup
    nowMs: number
    threshold: 70 | 90
    usageDate: string
  }): Promise<boolean>
  completeAlert(input: {
    environment: ProviderRuntimeEnvironment
    group: ProviderOperationGroup
    nowMs: number
    threshold: 70 | 90
    usageDate: string
  }): Promise<void>
  releaseAlert(input: {
    environment: ProviderRuntimeEnvironment
    group: ProviderOperationGroup
    threshold: 70 | 90
    usageDate: string
  }): Promise<void>
}

export type ProviderBudgetAlertSender = (input: {
  environment: ProviderRuntimeEnvironment
  group: ProviderOperationGroup
  occurredAt: string
  threshold: 70 | 90
  to: typeof PROVIDER_BUDGET_ALERT_RECIPIENT
}) => Promise<void>

export type ProviderDailyBudgetResult =
  | { allowed: true }
  | { allowed: false; reason: 'budget_exceeded' | 'storage_error'; retryAt?: number }

export const PROVIDER_BUDGET_ALERT_RECIPIENT = 'ysr182@qq.com' as const

export const PRODUCTION_PROVIDER_DAILY_BUDGETS: ProviderDailyBudgetLimits = {
  account: { ai: 20, fx: 30, place: 60, route: 100, search: 20 },
  global: { ai: 200, fx: 300, place: 600, route: 1000, search: 200 },
  ip: { ai: 100, fx: 150, place: 300, route: 500, search: 100 },
}

const D1_CONSUME_DAILY_SQL = `
INSERT INTO provider_daily_usage (
  id, environment, usage_date, scope, group_name, identity_hash,
  count, limit_value, updated_at
)
VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  count = provider_daily_usage.count + 1,
  limit_value = excluded.limit_value,
  updated_at = excluded.updated_at
WHERE provider_daily_usage.count < excluded.limit_value
RETURNING count
`.trim()

const D1_SELECT_DAILY_COUNT_SQL = 'SELECT count FROM provider_daily_usage WHERE id = ?'
const D1_SELECT_CONTROL_SQL = 'SELECT enabled, disabled_until, reason FROM provider_controls WHERE id = ?'
const D1_DISABLE_CONTROL_SQL = `
INSERT INTO provider_controls (id, enabled, disabled_until, reason, updated_at)
VALUES (?, 0, ?, 'budget_exhausted', ?)
ON CONFLICT(id) DO UPDATE SET
  enabled = 0,
  disabled_until = excluded.disabled_until,
  reason = excluded.reason,
  updated_at = excluded.updated_at
`.trim()
const D1_CLAIM_ALERT_SQL = `
INSERT INTO provider_alerts (id, environment, usage_date, group_name, threshold, created_at, sent_at)
VALUES (?, ?, ?, ?, ?, ?, NULL)
ON CONFLICT(id) DO NOTHING
RETURNING id
`.trim()
const D1_COMPLETE_ALERT_SQL = 'UPDATE provider_alerts SET sent_at = ? WHERE id = ? AND sent_at IS NULL'
const D1_RELEASE_ALERT_SQL = 'DELETE FROM provider_alerts WHERE id = ?'

export function resolveProviderRuntimeEnvironment(env: Record<string, unknown>): ProviderRuntimeEnvironment {
  const value = readString(env.TRIPMAP_PROVIDER_PROXY_ENV)?.toLowerCase()
  if (value === 'production' || value === 'preview') return value
  return 'development'
}

export function isStrictProviderEnvironment(environment: ProviderRuntimeEnvironment) {
  return environment === 'production' || environment === 'preview'
}

export function getProviderOperationGroup(operation: ProviderProxyOperation | string | undefined): ProviderOperationGroup {
  if (operation === 'travel_search') return 'search'
  if (operation === 'place_lookup' || operation === 'place_details') return 'place'
  if (operation === 'route_preview' || operation === 'route_order_suggestion') return 'route'
  if (operation === 'exchange_rate') return 'fx'
  return 'ai'
}

export function getProviderDailyBudgetLimits(environment: ProviderRuntimeEnvironment): ProviderDailyBudgetLimits {
  if (environment !== 'preview') return PRODUCTION_PROVIDER_DAILY_BUDGETS
  return mapBudgetLimits((limit) => Math.max(1, Math.ceil(limit * 0.25)))
}

export function getNextUtcDayStart(nowMs: number) {
  const now = new Date(nowMs)
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
}

export function isProviderKilledByEnvironment(env: Record<string, unknown>, group: ProviderOperationGroup) {
  const value = readString(env.TRIPMAP_PROVIDER_PROXY_KILL_SWITCH)?.toLowerCase()
  if (!value) return false
  const disabled = new Set(value.split(',').map((part) => part.trim()).filter(Boolean))
  return disabled.has('1') || disabled.has('true') || disabled.has('global') || disabled.has(group)
}

export async function checkProviderControl(input: {
  env: Record<string, unknown>
  group: ProviderOperationGroup
  nowMs: number
  storage: ProviderOperationsStorage
}) {
  if (isProviderKilledByEnvironment(input.env, input.group)) {
    return { enabled: false as const, reason: 'environment_kill_switch' }
  }
  const globalControl = await input.storage.getControl('global', input.nowMs)
  if (!globalControl.enabled) return globalControl
  return input.storage.getControl(input.group, input.nowMs)
}

export async function consumeProviderDailyBudgets(input: {
  accountId: string
  alertSender?: ProviderBudgetAlertSender
  environment: ProviderRuntimeEnvironment
  group: ProviderOperationGroup
  ip: string
  nowMs: number
  storage: ProviderOperationsStorage
}): Promise<ProviderDailyBudgetResult> {
  const limits = getProviderDailyBudgetLimits(input.environment)
  const usageDate = new Date(input.nowMs).toISOString().slice(0, 10)
  const identities: Array<{ scope: ProviderBudgetScope; identityHash: string }> = [
    { scope: 'account', identityHash: await hashProviderProxyQuotaIdentity(`account:${input.accountId}`) },
    { scope: 'ip', identityHash: await hashProviderProxyQuotaIdentity(`ip:${input.ip}`) },
    { scope: 'global', identityHash: 'all' },
  ]

  for (const identity of identities) {
    const limit = limits[identity.scope][input.group]
    const consumed = await input.storage.consumeDaily({
      environment: input.environment,
      group: input.group,
      identityHash: identity.identityHash,
      limit,
      nowMs: input.nowMs,
      scope: identity.scope,
    })
    if (!consumed.allowed) {
      return {
        allowed: false,
        reason: consumed.reason,
        retryAt: consumed.reason === 'budget_exceeded' ? getNextUtcDayStart(input.nowMs) : undefined,
      }
    }

    if (identity.scope !== 'global' && consumed.count >= limit) {
      return { allowed: false, reason: 'budget_exceeded', retryAt: getNextUtcDayStart(input.nowMs) }
    }

    if (identity.scope === 'global') {
      const threshold = getReachedAlertThreshold(consumed.count, limit)
      if (threshold) {
        await sendClaimedBudgetAlert({ ...input, threshold, usageDate })
      }
      if (consumed.count >= limit) {
        const retryAt = getNextUtcDayStart(input.nowMs)
        const disabled = await input.storage.disableGroup(input.group, retryAt, input.nowMs)
        return { allowed: false, reason: disabled ? 'budget_exceeded' : 'storage_error', retryAt: disabled ? retryAt : undefined }
      }
    }
  }

  return { allowed: true }
}

export function createProviderOperationsMemoryStorage(): ProviderOperationsStorage {
  const counts = new Map<string, number>()
  const controls = new Map<ProviderControlGroup, { disabledUntil?: number; enabled: boolean; reason?: string }>()
  const alerts = new Set<string>()
  return {
    async claimAlert(input) {
      const id = buildAlertId(input)
      if (alerts.has(id)) return false
      alerts.add(id)
      return true
    },
    async consumeDaily(input) {
      const id = buildDailyUsageId(input)
      const current = counts.get(id) ?? 0
      if (current >= input.limit) return { allowed: false, count: current, reason: 'budget_exceeded' }
      const count = current + 1
      counts.set(id, count)
      return { allowed: true, count }
    },
    async completeAlert() {},
    async disableGroup(group, disabledUntil) {
      controls.set(group, { disabledUntil, enabled: false, reason: 'budget_exhausted' })
      return true
    },
    async getControl(group, nowMs) {
      const control = controls.get(group)
      if (!control || (control.disabledUntil !== undefined && control.disabledUntil <= nowMs)) {
        return { enabled: true }
      }
      return { enabled: control.enabled, reason: control.reason }
    },
    async releaseAlert(input) {
      alerts.delete(buildAlertId(input))
    },
  }
}

export function createProviderOperationsD1Storage(d1: ProviderProxyD1Database): ProviderOperationsStorage {
  return {
    async claimAlert(input) {
      try {
        const id = buildAlertId(input)
        return Boolean(await d1.prepare(D1_CLAIM_ALERT_SQL).bind(
          id,
          input.environment,
          input.usageDate,
          input.group,
          input.threshold,
          input.nowMs,
        ).first())
      } catch {
        return false
      }
    },
    async consumeDaily(input) {
      const id = buildDailyUsageId(input)
      try {
        const row = await d1.prepare(D1_CONSUME_DAILY_SQL).bind(
          id,
          input.environment,
          new Date(input.nowMs).toISOString().slice(0, 10),
          input.scope,
          input.group,
          input.identityHash,
          input.limit,
          input.nowMs,
        ).first<Record<string, unknown>>()
        const count = readInteger(row?.count)
        if (count !== undefined) return { allowed: true, count }
        const current = await d1.prepare(D1_SELECT_DAILY_COUNT_SQL).bind(id).first<Record<string, unknown>>()
        return { allowed: false, count: readInteger(current?.count), reason: 'budget_exceeded' }
      } catch {
        return { allowed: false, reason: 'storage_error' }
      }
    },
    async completeAlert(input) {
      try {
        await d1.prepare(D1_COMPLETE_ALERT_SQL).bind(input.nowMs, buildAlertId(input)).run()
      } catch {
        // The maintenance worker can retry unsent alert rows.
      }
    },
    async disableGroup(group, disabledUntil, nowMs) {
      try {
        await d1.prepare(D1_DISABLE_CONTROL_SQL).bind(group, disabledUntil, nowMs).run()
        return true
      } catch {
        return false
      }
    },
    async getControl(group, nowMs) {
      try {
        const row = await d1.prepare(D1_SELECT_CONTROL_SQL).bind(group).first<Record<string, unknown>>()
        if (!row) return { enabled: true }
        const enabled = readInteger(row.enabled) !== 0
        const disabledUntil = readInteger(row.disabled_until)
        if (!enabled && disabledUntil !== undefined && disabledUntil <= nowMs) return { enabled: true }
        return { enabled, reason: readString(row.reason) }
      } catch {
        return { enabled: false, reason: 'storage_error' }
      }
    },
    async releaseAlert(input) {
      try {
        await d1.prepare(D1_RELEASE_ALERT_SQL).bind(buildAlertId(input)).run()
      } catch {
        // A stale alert claim is pruned by the maintenance worker.
      }
    },
  }
}

export function selectProviderOperationsStorage(
  env: Record<string, unknown>,
  strict: boolean,
): ProviderOperationsStorage {
  if (!strict) return createProviderOperationsMemoryStorage()
  const binding = env.TRIPMAP_PROVIDER_QUOTA_D1
  if (isD1Database(binding)) return createProviderOperationsD1Storage(binding)
  return strict ? createProviderOperationsFailClosedStorage() : createProviderOperationsMemoryStorage()
}

export function selectProviderBudgetAlertSender(env: Record<string, unknown>): ProviderBudgetAlertSender | undefined {
  const binding = env.TRIPMAP_PROVIDER_ALERT_EMAIL as { send?: (input: unknown) => Promise<unknown> } | undefined
  const send = binding?.send
  const from = readString(env.TRIPMAP_PROVIDER_ALERT_FROM)
  if (!send || !from) return undefined
  return async (input) => {
    await send({
      from,
      subject: `[TripMap] Provider ${input.group} budget reached ${input.threshold}%`,
      text: `Environment: ${input.environment}\nGroup: ${input.group}\nThreshold: ${input.threshold}%\nTime: ${input.occurredAt}`,
      to: PROVIDER_BUDGET_ALERT_RECIPIENT,
    })
  }
}

function createProviderOperationsFailClosedStorage(): ProviderOperationsStorage {
  return {
    async claimAlert() { return false },
    async completeAlert() {},
    async consumeDaily() { return { allowed: false, reason: 'storage_error' } },
    async disableGroup() { return false },
    async getControl() { return { enabled: false, reason: 'storage_error' } },
    async releaseAlert() {},
  }
}

async function sendClaimedBudgetAlert(input: {
  alertSender?: ProviderBudgetAlertSender
  environment: ProviderRuntimeEnvironment
  group: ProviderOperationGroup
  nowMs: number
  storage: ProviderOperationsStorage
  threshold: 70 | 90
  usageDate: string
}) {
  const claimed = await input.storage.claimAlert(input)
  if (!claimed) return
  if (!input.alertSender) return
  try {
    await input.alertSender({
      environment: input.environment,
      group: input.group,
      occurredAt: new Date(input.nowMs).toISOString(),
      threshold: input.threshold,
      to: PROVIDER_BUDGET_ALERT_RECIPIENT,
    })
    await input.storage.completeAlert(input)
  } catch {
    // Leave the unsent row for the hourly maintenance worker.
  }
}

function getReachedAlertThreshold(count: number, limit: number): 70 | 90 | undefined {
  if (count === Math.ceil(limit * 0.7)) return 70
  if (count === Math.ceil(limit * 0.9)) return 90
  return undefined
}

function mapBudgetLimits(mapper: (limit: number) => number): ProviderDailyBudgetLimits {
  return Object.fromEntries(Object.entries(PRODUCTION_PROVIDER_DAILY_BUDGETS).map(([scope, values]) => [
    scope,
    Object.fromEntries(Object.entries(values).map(([group, limit]) => [group, mapper(limit)])),
  ])) as ProviderDailyBudgetLimits
}

function buildDailyUsageId(input: {
  environment: ProviderRuntimeEnvironment
  group: ProviderOperationGroup
  identityHash: string
  nowMs: number
  scope: ProviderBudgetScope
}) {
  return [
    input.environment,
    new Date(input.nowMs).toISOString().slice(0, 10),
    input.scope,
    input.group,
    input.identityHash,
  ].join('|')
}

function buildAlertId(input: {
  environment: ProviderRuntimeEnvironment
  group: ProviderOperationGroup
  threshold: number
  usageDate: string
}) {
  return [input.environment, input.usageDate, input.group, input.threshold].join('|')
}

function isD1Database(value: unknown): value is ProviderProxyD1Database {
  return Boolean(value && typeof value === 'object' && typeof (value as { prepare?: unknown }).prepare === 'function')
}

function readInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value))
  return undefined
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
