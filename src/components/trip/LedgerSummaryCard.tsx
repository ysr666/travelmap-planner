import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ChevronRight, WalletCards } from 'lucide-react'
import { getLedgerSettingsByTrip, listLedgerBudgets, listLedgerExpenses, listLedgerParticipants } from '../../db'
import { buildLedgerSummary, formatLedgerMoney } from '../../lib/ledger'
import { navigateTo } from '../../lib/routes'
import { subscribeTravelDataChanged } from '../../lib/dataEvents'
import type { LedgerBudget, LedgerExpense, LedgerParticipant, LedgerSettings, Trip } from '../../types'
import { Card } from '../ui/Card'

export function LedgerSummaryCard({ trip }: { trip: Trip }) {
  const [settings, setSettings] = useState<LedgerSettings | null>(null)
  const [participants, setParticipants] = useState<LedgerParticipant[]>([])
  const [budgets, setBudgets] = useState<LedgerBudget[]>([])
  const [expenses, setExpenses] = useState<LedgerExpense[]>([])
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const [nextSettings, nextParticipants, nextBudgets, nextExpenses] = await Promise.all([
        getLedgerSettingsByTrip(trip.id),
        listLedgerParticipants(trip.id),
        listLedgerBudgets(trip.id),
        listLedgerExpenses(trip.id),
      ])
      if (!cancelled) {
        setSettings(nextSettings ?? null)
        setParticipants(nextParticipants)
        setBudgets(nextBudgets)
        setExpenses(nextExpenses)
      }
    }
    void refresh()
    const unsubscribe = subscribeTravelDataChanged(() => void refresh())
    return () => { cancelled = true; unsubscribe() }
  }, [trip.id])
  const summary = useMemo(() => settings ? buildLedgerSummary({ budgets, expenses, participants, settings }) : null, [budgets, expenses, participants, settings])
  return (
    <Card className="space-y-3" data-testid="trip-ledger-summary" variant="grouped">
      <button className="flex min-h-11 w-full items-center gap-3 text-left" onClick={() => navigateTo('ledger', { tripId: trip.id })} type="button">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><WalletCards className="size-5" /></span>
        <span className="min-w-0 flex-1"><span className="block font-semibold">旅行账本</span><span className="mt-0.5 block text-xs tm-muted">预算、费用分摊与旅行结算</span></span>
        <ChevronRight className="size-5 text-outline" />
      </button>
      {!settings || !summary ? <p className="rounded-lg bg-surface-container-high px-3 py-2 text-sm tm-muted">设置双币种和总预算后开始记账。</p> : (
        <>
          <div className="grid grid-cols-3 divide-x divide-outline-variant/30 text-center">
            <LedgerMetric label="预算" value={formatLedgerMoney(summary.budgetMinor, settings.tripCurrency)} />
            <LedgerMetric label="已花费" value={formatLedgerMoney(summary.spentTripMinor, settings.tripCurrency)} />
            <LedgerMetric label="人均" value={formatLedgerMoney(summary.perPersonTripMinor, settings.tripCurrency)} />
          </div>
          <div className="flex items-center justify-between gap-3 text-xs tm-muted"><span>待确认 {formatLedgerMoney(summary.pendingTripMinor, settings.tripCurrency)}</span><span>约 {formatLedgerMoney(summary.spentHomeMinor, settings.homeCurrency)}</span></div>
          {summary.warnings.length > 0 ? <p className="flex items-center gap-2 text-xs font-semibold text-amber-700"><AlertTriangle className="size-4" />{summary.warnings.length} 项费用提醒待处理</p> : null}
        </>
      )}
    </Card>
  )
}

function LedgerMetric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-2"><p className="text-[11px] tm-muted">{label}</p><p className="mt-1 truncate text-sm font-bold">{value}</p></div>
}
