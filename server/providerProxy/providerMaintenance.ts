import type { ProviderProxyD1Database } from './quotaGuard'
import {
  PROVIDER_BUDGET_ALERT_RECIPIENT,
  selectProviderBudgetAlertSender,
  type ProviderBudgetAlertSender,
  type ProviderOperationGroup,
  type ProviderRuntimeEnvironment,
} from './providerOperationsGuard'

const DAY_MS = 24 * 60 * 60 * 1000

export type ProviderMaintenanceResult = {
  alertsSent: number
  dailyRowsDeleted: number
  minuteRowsDeleted: number
  oldAlertsDeleted: number
  controlsRestored: number
}

export async function runProviderMaintenance(input: {
  alertSender?: ProviderBudgetAlertSender
  d1: ProviderProxyD1Database
  nowMs?: number
}): Promise<ProviderMaintenanceResult> {
  const nowMs = input.nowMs ?? Date.now()
  const dailyCutoff = new Date(nowMs - 8 * DAY_MS).toISOString().slice(0, 10)
  const alertCutoff = nowMs - 30 * DAY_MS
  const minute = await input.d1.prepare('DELETE FROM provider_quota WHERE expires_at <= ?').bind(nowMs).run()
  const daily = await input.d1.prepare('DELETE FROM provider_daily_usage WHERE usage_date < ?').bind(dailyCutoff).run()
  const alerts = await input.d1.prepare('DELETE FROM provider_alerts WHERE sent_at IS NOT NULL AND sent_at < ?').bind(alertCutoff).run()
  const controls = await input.d1.prepare(`
UPDATE provider_controls
SET enabled = 1, disabled_until = NULL, reason = NULL, updated_at = ?
WHERE enabled = 0 AND reason = 'budget_exhausted' AND disabled_until IS NOT NULL AND disabled_until <= ?
  `.trim()).bind(nowMs, nowMs).run()

  const alertSender = input.alertSender
  const pending = await listPendingAlerts(input.d1)
  let alertsSent = 0
  if (alertSender) {
    for (const alert of pending) {
      try {
        await alertSender({
          environment: alert.environment,
          group: alert.group,
          occurredAt: new Date(alert.createdAt).toISOString(),
          threshold: alert.threshold,
          to: PROVIDER_BUDGET_ALERT_RECIPIENT,
        })
        await input.d1.prepare('UPDATE provider_alerts SET sent_at = ? WHERE id = ? AND sent_at IS NULL').bind(nowMs, alert.id).run()
        alertsSent += 1
      } catch {
        // Keep the row pending for the next hourly attempt.
      }
    }
  }

  return {
    alertsSent,
    controlsRestored: readChanges(controls),
    dailyRowsDeleted: readChanges(daily),
    minuteRowsDeleted: readChanges(minute),
    oldAlertsDeleted: readChanges(alerts),
  }
}

export function selectProviderMaintenanceAlertSender(env: Record<string, unknown>) {
  return selectProviderBudgetAlertSender(env)
}

async function listPendingAlerts(d1: ProviderProxyD1Database) {
  const statement = d1.prepare(`
SELECT id, environment, group_name, threshold, created_at
FROM provider_alerts
WHERE sent_at IS NULL
ORDER BY created_at ASC
LIMIT 20
  `.trim())
  if (!statement.all) return []
  const result = await statement.all<Record<string, unknown>>()
  return (result.results ?? []).flatMap((row) => {
    const environment = readEnvironment(row.environment)
    const group = readGroup(row.group_name)
    const threshold = row.threshold === 70 || row.threshold === 90 ? row.threshold : undefined
    const createdAt = readInteger(row.created_at)
    return typeof row.id === 'string' && environment && group && threshold && createdAt !== undefined
      ? [{ createdAt, environment, group, id: row.id, threshold }]
      : []
  })
}

function readChanges(result: { meta?: { changes?: number } }) {
  return typeof result.meta?.changes === 'number' ? result.meta.changes : 0
}

function readEnvironment(value: unknown): ProviderRuntimeEnvironment | undefined {
  return value === 'production' || value === 'preview' || value === 'development' ? value : undefined
}

function readGroup(value: unknown): ProviderOperationGroup | undefined {
  return value === 'ai' || value === 'search' || value === 'place' || value === 'route' || value === 'fx' ? value : undefined
}

function readInteger(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value))
  return undefined
}
