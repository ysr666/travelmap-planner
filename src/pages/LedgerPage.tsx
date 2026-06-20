import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarClock,
  Check,
  Copy,
  Download,
  FileSearch,
  FileWarning,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
  UsersRound,
  WalletCards,
} from 'lucide-react'
import {
  createLedgerBudget,
  createLedgerExpense,
  createLedgerParticipant,
  createLedgerSettings,
  deleteLedgerBudget,
  deleteLedgerExpense,
  deleteLedgerParticipant,
  getLedgerSettingsByTrip,
  getTicketBlob,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerBudgets,
  listLedgerExpenses,
  listLedgerParticipants,
  listTicketsByTrip,
  updateLedgerBudget,
  updateLedgerExpense,
  updateLedgerParticipant,
} from '../db'
import { Button } from '../components/ui/Button'
import { LedgerReviewQueue } from '../components/ledger/LedgerReviewQueue'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS, FormField } from '../components/ui/FormField'
import { listTravelInboxEntriesByTrip } from '../lib/ai/travelInbox'
import { extractExistingTripImportSources } from '../lib/ai/existingTripImportExtraction'
import { loadOwnerSharedTripState } from '../lib/companion'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import {
  buildLedgerSettlement,
  buildLedgerSummary,
  formatLedgerMoney,
  getLedgerExpenseDuplicateKind,
  getCurrencyMinorDigits,
  ledgerCategoryLabels,
  normalizeCurrencyCode,
  parseMoneyInput,
} from '../lib/ledger'
import { commonLedgerCurrencies, suggestTripCurrency } from '../lib/ledgerCurrency'
import { buildManualLedgerExchangeRateSnapshot, getLedgerExchangeRateSnapshot } from '../lib/ledgerExchangeRates'
import { buildLedgerExpenseDraftCandidates, sanitizeLedgerExtractionTextForAi, type LedgerExpenseDraftCandidate } from '../lib/ledgerExtraction'
import {
  areLedgerLineItemsBalanced,
  buildLedgerAiQueryContext,
  buildLedgerExpenseFromCandidate,
  buildLedgerForecast,
  buildLedgerIntegrityIssues,
  buildLedgerTimeline,
  executeLedgerQueryPlan,
  queryLedgerLocally,
  type LedgerTimelineKind,
} from '../lib/ledgerArchive'
import { buildLedgerReviewEntries } from '../lib/ledgerReview'
import { buildLedgerReportModel, downloadLedgerArchive, openLedgerPrintReport } from '../lib/ledgerReport'
import { fetchProviderProxyAiExpenseExtract, fetchProviderProxyAiExpenseQuery, getProviderProxyConfig } from '../lib/providerProxyClient'
import { getAccountAiPreferences } from '../lib/accountAiPreferences'
import { getRouteParams, navigateTo } from '../lib/routes'
import { listTransportBookings, listTravelerProfiles } from '../lib/travelDocumentCenter'
import {
  buildTripIntelligenceModel,
  executeTripIntelligenceAction,
  getLedgerDraftCandidateSuggestionKey,
  type TripIntelligenceSuggestion,
} from '../lib/tripIntelligence'
import type {
  Day,
  LedgerBudget,
  LedgerBudgetScope,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseLineItem,
  LedgerExpenseStatus,
  LedgerParticipant,
  LedgerSettings,
  LedgerSplitMode,
  ItineraryItem,
  TicketMeta,
  Trip,
} from '../types'

type LedgerTab = 'bills' | 'timeline' | 'integrity' | 'budget' | 'report'
type ScanCandidate = LedgerExpenseDraftCandidate & { selected: boolean }

const categoryOptions = Object.entries(ledgerCategoryLabels) as Array<[LedgerExpenseCategory, string]>

export function LedgerPage() {
  const tripId = getRouteParams().get('tripId') ?? ''
  const [trip, setTrip] = useState<Trip | null>(null)
  const [settings, setSettings] = useState<LedgerSettings | null>(null)
  const [participants, setParticipants] = useState<LedgerParticipant[]>([])
  const [budgets, setBudgets] = useState<LedgerBudget[]>([])
  const [expenses, setExpenses] = useState<LedgerExpense[]>([])
  const [days, setDays] = useState<Day[]>([])
  const [items, setItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [activeTab, setActiveTab] = useState<LedgerTab>('bills')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!tripId) return
    const [nextTrip, nextSettings, nextParticipants, nextBudgets, nextExpenses, nextDays, nextItems, nextTickets] = await Promise.all([
      getTrip(tripId),
      getLedgerSettingsByTrip(tripId),
      listLedgerParticipants(tripId),
      listLedgerBudgets(tripId),
      listLedgerExpenses(tripId),
      listDaysByTrip(tripId),
      listItemsByTrip(tripId),
      listTicketsByTrip(tripId),
    ])
    setTrip(nextTrip ?? null)
    setSettings(nextSettings ?? null)
    setParticipants(nextParticipants)
    setBudgets(nextBudgets)
    setExpenses(nextExpenses)
    setDays(nextDays)
    setItems(nextItems)
    setTickets(nextTickets)
  }, [tripId])

  useEffect(() => {
    let cancelled = false
    const timeout = window.setTimeout(() => {
      void refresh().catch((caught) => { if (!cancelled) setError(getErrorMessage(caught)) }).finally(() => { if (!cancelled) setLoading(false) })
    }, 0)
    const unsubscribe = subscribeTravelDataChanged(() => void refresh())
    return () => { cancelled = true; window.clearTimeout(timeout); unsubscribe() }
  }, [refresh])

  const summary = useMemo(() => settings ? buildLedgerSummary({ budgets, expenses, participants, settings }) : null, [budgets, expenses, participants, settings])

  if (loading) return <Card><p className="text-sm tm-muted">正在读取旅行账本...</p></Card>
  if (!trip) return <EmptyState body={error || '没有找到这趟旅行。'} icon={<WalletCards className="size-6" />} title="无法打开旅行账本" />
  if (!settings) return <LedgerSetup trip={trip} onCreated={refresh} />

  return (
    <div className="space-y-5 pb-4" data-testid="ledger-page">
      <header className="flex items-start gap-3">
        <button aria-label="返回旅行总览" className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant tm-focus" onClick={() => navigateTo('trip', { tripId })} type="button">
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-on-surface">旅行账本</h2>
          <p className="mt-1 truncate text-sm tm-muted">{trip.title}</p>
        </div>
      </header>

      {summary ? <LedgerHero settings={settings} summary={summary} /> : null}
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

      <nav className="grid grid-cols-5 gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-1" aria-label="账本视图">
        {([
          ['bills', '账单'],
          ['timeline', '时间线'],
          ['integrity', '完整性'],
          ['budget', '预算'],
          ['report', '报告'],
        ] as Array<[LedgerTab, string]>).map(([value, label]) => (
          <button className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${activeTab === value ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant'}`} key={value} onClick={() => setActiveTab(value)} type="button">{label}</button>
        ))}
      </nav>

      {activeTab === 'bills' ? <ExpensesView days={days} expenses={expenses} items={items} participants={participants} settings={settings} tickets={tickets} trip={trip} onChanged={refresh} /> : null}
      {activeTab === 'timeline' ? <TimelineView expenses={expenses} settings={settings} /> : null}
      {activeTab === 'integrity' ? <IntegrityView expenses={expenses} onEdit={(expense) => navigateTo('ledger/expense', { expenseId: expense.id, tripId: trip.id })} /> : null}
      {activeTab === 'budget' ? <BudgetAndForecastView budgets={budgets} expenses={expenses} settings={settings} trip={trip} onChanged={refresh} /> : null}
      {activeTab === 'report' ? <ReportView budgets={budgets} expenses={expenses} participants={participants} settings={settings} trip={trip} onChanged={refresh} /> : null}
    </div>
  )
}

function LedgerHero({ settings, summary }: { settings: LedgerSettings; summary: ReturnType<typeof buildLedgerSummary> }) {
  const overBudget = summary.budgetMinor > 0 && summary.spentTripMinor > summary.budgetMinor
  return (
    <section className="space-y-3" data-testid="ledger-summary">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tm-muted">已花费</p>
          <p className="mt-1 text-3xl font-bold text-on-surface">{formatLedgerMoney(summary.spentTripMinor, settings.tripCurrency)}</p>
          <p className="mt-1 text-sm tm-muted">约 {formatLedgerMoney(summary.spentHomeMinor, settings.homeCurrency)}</p>
        </div>
        <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${overBudget ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{overBudget ? '已超预算' : '预算内'}</span>
      </div>
      <div className="grid grid-cols-3 divide-x divide-outline-variant/30 rounded-xl border border-outline-variant/30 bg-surface-container py-3 text-center">
        <Metric label="总预算" value={formatLedgerMoney(summary.budgetMinor, settings.tripCurrency)} />
        <Metric label="待确认" value={formatLedgerMoney(summary.pendingTripMinor, settings.tripCurrency)} />
        <Metric label="人均" value={formatLedgerMoney(summary.perPersonTripMinor, settings.tripCurrency)} />
      </div>
      {summary.warnings.length > 0 ? <p className="flex items-center gap-2 text-sm text-amber-700"><AlertTriangle className="size-4" />还有 {summary.warnings.length} 项需要处理</p> : null}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 px-2"><p className="text-[11px] tm-muted">{label}</p><p className="mt-1 truncate text-sm font-bold text-on-surface">{value}</p></div>
}

function LedgerSetup({ trip, onCreated }: { trip: Trip; onCreated: () => Promise<void> }) {
  const [homeCurrency, setHomeCurrency] = useState('CNY')
  const [tripCurrency, setTripCurrency] = useState(() => suggestTripCurrency(trip.destination))
  const [budget, setBudget] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit() {
    const amountMinor = parseMoneyInput(budget, tripCurrency)
    if (amountMinor == null || amountMinor <= 0) return setError('请填写大于 0 的旅行总预算。')
    setBusy(true); setError('')
    try {
      await createLedgerSettings({ homeCurrency: normalizeCurrencyCode(homeCurrency), settlementCurrency: normalizeCurrencyCode(homeCurrency), tripCurrency: normalizeCurrencyCode(tripCurrency), tripId: trip.id })
      await createLedgerParticipant({ displayName: '我', isSelf: true, source: 'manual', tripId: trip.id })
      await createLedgerBudget({ amountMinor, currency: normalizeCurrencyCode(tripCurrency), scope: 'trip', tripId: trip.id })
      await onCreated()
    } catch (caught) { setError(getErrorMessage(caught)) } finally { setBusy(false) }
  }
  return (
    <div className="space-y-5" data-testid="ledger-setup">
      <header><h2 className="text-xl font-bold">建立旅行账本</h2><p className="mt-1 text-sm tm-muted">确认两种显示币种并设置整趟旅行预算。</p></header>
      <Card className="space-y-4" variant="grouped">
        <CurrencySelect label="常住地币种" value={homeCurrency} onChange={setHomeCurrency} />
        <CurrencySelect label="旅行币种" value={tripCurrency} onChange={setTripCurrency} />
        <FormField label={`旅行总预算（${tripCurrency}）`} onChange={setBudget} placeholder="例如 12000" required type="number" value={budget} />
        <p className="text-xs tm-muted">旅行币种用于主要显示；常住地币种用于小字折算和最终结算。目的地建议仅供确认。</p>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button className="w-full" loading={busy} onClick={() => void submit()}>创建账本</Button>
      </Card>
    </div>
  )
}

function ExpensesView({
  days,
  expenses,
  items,
  participants,
  settings,
  tickets,
  trip,
  onChanged,
}: {
  days: Day[]
  expenses: LedgerExpense[]
  items: ItineraryItem[]
  participants: LedgerParticipant[]
  settings: LedgerSettings
  tickets: TicketMeta[]
  trip: Trip
  onChanged: () => Promise<void>
}) {
  const [editing, setEditing] = useState<LedgerExpense | 'new' | null>(null)
  const [billView, setBillView] = useState<'review' | 'all'>(() => buildLedgerReviewEntries(expenses).length > 0 ? 'review' : 'all')
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [aiConfirm, setAiConfirm] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [pendingDraftSuggestion, setPendingDraftSuggestion] = useState<{
    candidate: LedgerExpenseDraftCandidate
    suggestion: TripIntelligenceSuggestion
  } | null>(null)
  const [intelligenceActionId, setIntelligenceActionId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const reviewEntries = useMemo(() => buildLedgerReviewEntries(expenses), [expenses])
  const ticketDraftCandidates = useMemo(() => buildLedgerExpenseDraftCandidates({
    bookings: [],
    days,
    existingExpenses: expenses,
    inboxEntries: [],
    items,
    participants,
    tickets,
    tripCurrency: settings.tripCurrency,
    tripStartDate: trip.startDate,
  }).filter((candidate) => candidate.source.kind === 'ticket'), [days, expenses, items, participants, settings.tripCurrency, tickets, trip.startDate])
  const draftCandidateBySuggestionKey = useMemo(() => {
    return new Map(ticketDraftCandidates.map((candidate, index) => [
      getLedgerDraftCandidateSuggestionKey(candidate, index),
      candidate,
    ]))
  }, [ticketDraftCandidates])
  const financeIntelligenceModel = useMemo(() => buildTripIntelligenceModel({
    items,
    ledgerDraftCandidates: ticketDraftCandidates,
    ledgerReviewEntries: reviewEntries,
  }), [items, reviewEntries, ticketDraftCandidates])

  function handleFinanceSuggestion(suggestion: TripIntelligenceSuggestion) {
    setMessage('')
    if (suggestion.action?.kind === 'ledger_create_expense_draft_from_candidate') {
      const candidate = draftCandidateBySuggestionKey.get(suggestion.key)
      if (!candidate) {
        setMessage('这条费用候选已变化，请刷新后重试。')
        return
      }
      setPendingDraftSuggestion({ candidate, suggestion })
      return
    }
    if (suggestion.action?.kind === 'open_ledger_review') {
      setBillView('review')
      window.requestAnimationFrame(() => {
        document.getElementById('ledger-review-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return
    }
    if (suggestion.ticketIds[0]) {
      navigateTo('tickets', { ticketId: suggestion.ticketIds[0], tripId: trip.id })
      return
    }
    setBillView('review')
  }

  async function confirmFinanceDraft() {
    if (!pendingDraftSuggestion) return
    setIntelligenceActionId(pendingDraftSuggestion.suggestion.id)
    setMessage('')
    try {
      const result = await executeTripIntelligenceAction({
        candidate: pendingDraftSuggestion.candidate,
        kind: 'ledger_create_expense_draft_from_candidate',
        participants,
        tripId: trip.id,
      })
      if (result.status !== 'completed') {
        setMessage(result.message)
        return
      }
      setMessage(result.message)
      setPendingDraftSuggestion(null)
      await onChanged()
      setBillView('review')
    } catch (caught) {
      setMessage(getErrorMessage(caught))
    } finally {
      setIntelligenceActionId(null)
    }
  }

  async function scanSources() {
    setScanning(true); setMessage('')
    try {
      const [days, items, tickets, inboxEntries, bookings] = await Promise.all([
        listDaysByTrip(trip.id), listItemsByTrip(trip.id), listTicketsByTrip(trip.id), listTravelInboxEntriesByTrip(trip.id), listTransportBookings(trip.id),
      ])
      const overrides: Record<string, string> = {}
      for (const ticket of tickets.filter((candidate) => !expenses.some((expense) => expense.source.kind === 'ticket' && expense.source.sourceId === candidate.id))) {
        const blob = await getTicketBlob(ticket.id)
        if (!blob) continue
        try {
          const extraction = await extractExistingTripImportSources({ files: [new File([blob.blob], ticket.fileName, { type: ticket.mimeType })] })
          overrides[`ticket:${ticket.id}`] = extraction.sources.map((source) => source.text).join('\n')
        } catch {
          // Metadata and notes remain available when local OCR cannot read a file.
        }
      }
      const candidates = buildLedgerExpenseDraftCandidates({ bookings, days, existingExpenses: expenses, inboxEntries, items, participants, sourceTextOverrides: overrides, tickets, tripCurrency: settings.tripCurrency, tripStartDate: trip.startDate })
      setScanCandidates(candidates.map((candidate) => ({ ...candidate, selected: true })))
      setMessage(candidates.length ? `找到 ${candidates.length} 条费用候选。` : '没有找到新的费用来源。')
    } catch (caught) { setMessage(getErrorMessage(caught)) } finally { setScanning(false) }
  }

  async function applyCandidates() {
    const selected = scanCandidates.filter((candidate) => candidate.selected)
    for (const candidate of selected) {
      await createLedgerExpense(buildLedgerExpenseFromCandidate(candidate, trip.id, participants))
    }
    setScanCandidates([])
    setMessage(`已整理 ${selected.length} 条账单；达到平衡标准的付款记录已自动计入。`)
    await onChanged()
  }

  async function fillWithAi() {
    setAiBusy(true)
    try {
      const aliases = new Map(participants.map((participant, index) => [participant.id, `p${index + 1}`]))
      const response = await fetchProviderProxyAiExpenseExtract({
        candidates: scanCandidates.map((candidate, index) => ({ candidateId: String(index), text: sanitizeLedgerExtractionTextForAi(candidate.extractedText), title: candidate.title })),
        defaultCurrency: settings.tripCurrency,
        operation: 'ai_expense_extract',
        participants: participants.map((participant) => ({ alias: aliases.get(participant.id)!, displayName: participant.displayName })),
      }, getProviderProxyConfig().proxyUrl ?? '/api/provider-proxy')
      const participantByAlias = new Map([...aliases].map(([id, alias]) => [alias, id]))
      setScanCandidates((current) => current.map((candidate, index) => {
        const suggestion = response.suggestions.find((item) => item.candidateId === String(index))
        if (!suggestion) return candidate
        const currency = suggestion.currency ?? candidate.currency ?? settings.tripCurrency
        return {
          ...candidate,
          amountMinor: suggestion.amount ? parseMoneyInput(suggestion.amount, currency) : candidate.amountMinor,
          category: suggestion.category ?? candidate.category,
          currency,
          payerParticipantId: suggestion.payerAlias ? participantByAlias.get(suggestion.payerAlias) : candidate.payerParticipantId,
        }
      }))
      setAiConfirm(false)
      setMessage('AI 已补全候选字段，请检查后再生成草稿。')
    } catch (caught) { setMessage(getErrorMessage(caught)) } finally { setAiBusy(false) }
  }

  return (
    <section className="space-y-4">
      <LedgerIntelligencePanel
        busySuggestionId={intelligenceActionId}
        onAction={handleFinanceSuggestion}
        suggestions={financeIntelligenceModel.forFinance()}
      />
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-container p-1" aria-label="账单范围">
        <button className={`min-h-11 rounded-lg text-sm font-semibold ${billView === 'review' ? 'bg-surface shadow-sm' : 'tm-muted'}`} onClick={() => setBillView('review')} type="button">待审核 {reviewEntries.length}</button>
        <button className={`min-h-11 rounded-lg text-sm font-semibold ${billView === 'all' ? 'bg-surface shadow-sm' : 'tm-muted'}`} onClick={() => setBillView('all')} type="button">全部账单 {expenses.length}</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>记一笔</Button>
        <Button icon={<FileSearch className="size-4" />} loading={scanning} onClick={() => void scanSources()} variant="secondary">从更多来源整理</Button>
      </div>
      {message ? <p className="text-sm tm-muted">{message}</p> : null}
      {editing ? <ExpenseEditor expense={editing === 'new' ? undefined : editing} expenses={expenses} items={items} participants={participants} settings={settings} trip={trip} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged() }} /> : null}
      {scanCandidates.length > 0 ? (
        <section className="space-y-3" data-testid="ledger-scan-preview">
          <div className="flex items-center justify-between gap-3"><h3 className="font-semibold">费用候选</h3><Button icon={<Sparkles className="size-4" />} onClick={() => setAiConfirm(true)} variant="secondary">AI 补全</Button></div>
          {scanCandidates.map((candidate, index) => (
            <Card className="space-y-3" key={`${candidate.source.kind}:${candidate.source.sourceId ?? index}`} variant="grouped">
              <label className="flex items-center gap-2 text-sm font-semibold"><input checked={candidate.selected} onChange={(event) => setScanCandidates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} type="checkbox" />{candidate.title}</label>
              <div className="grid grid-cols-2 gap-2">
                <input className={FIELD_INPUT_CLASS} onChange={(event) => setScanCandidates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amountMinor: parseMoneyInput(event.target.value, item.currency ?? settings.tripCurrency) } : item))} placeholder="金额" type="number" value={candidate.amountMinor == null ? '' : String(candidate.amountMinor / 10 ** getCurrencyMinorDigits(candidate.currency ?? settings.tripCurrency))} />
                <select className={FIELD_SELECT_CLASS} onChange={(event) => setScanCandidates((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, currency: event.target.value } : item))} value={candidate.currency ?? settings.tripCurrency}>{commonLedgerCurrencies.map((currency) => <option key={currency}>{currency}</option>)}</select>
              </div>
              <p className="text-xs tm-muted">{candidate.amountMinor == null ? '金额待补充' : formatLedgerMoney(candidate.amountMinor, candidate.currency ?? settings.tripCurrency)} · {ledgerCategoryLabels[candidate.category]}</p>
            </Card>
          ))}
          <Button className="w-full" disabled={!scanCandidates.some((candidate) => candidate.selected)} onClick={() => void applyCandidates()}>生成待确认费用</Button>
        </section>
      ) : null}
      {billView === 'review' ? (
        <div id="ledger-review-section">
          <LedgerReviewQueue expenses={expenses} onChanged={onChanged} onEdit={(expense) => setEditing(expense)} settings={settings} trip={trip} />
        </div>
      ) : (
        <div className="space-y-2">
          {expenses.length === 0 ? <EmptyState body="手动记一笔，或从票据、订单和备注整理费用草稿。" icon={<WalletCards className="size-6" />} title="账本还是空的" /> : null}
          {expenses.map((expense) => <ExpenseRow expense={expense} key={expense.id} participants={participants} settings={settings} tripId={trip.id} onEdit={() => setEditing(expense)} onDelete={async () => { await deleteLedgerExpense(expense.id); await onChanged() }} />)}
        </div>
      )}
      <ConfirmDialog body={`将发送 ${scanCandidates.length} 条本地提取文本和同行人显示名给 AI。不会发送票据文件、邮箱、用户 ID、云数据或加密资料；返回内容只更新当前预览。`} confirmLabel="确认发送" loading={aiBusy} onCancel={() => setAiConfirm(false)} onConfirm={() => void fillWithAi()} open={aiConfirm} title="使用 AI 补全费用字段" />
      <ConfirmDialog
        body={pendingDraftSuggestion
          ? `将为「${pendingDraftSuggestion.candidate.title}」生成一条待确认费用草稿。不会自动确认，也不会读取或上传票据文件内容。`
          : '将生成一条待确认费用草稿。'}
        cancelLabel="暂不生成"
        confirmLabel="生成草稿"
        loading={Boolean(intelligenceActionId)}
        onCancel={() => {
          if (!intelligenceActionId) {
            setPendingDraftSuggestion(null)
          }
        }}
        onConfirm={() => void confirmFinanceDraft()}
        open={Boolean(pendingDraftSuggestion)}
        title="生成费用草稿？"
      />
    </section>
  )
}

function LedgerIntelligencePanel({
  busySuggestionId,
  onAction,
  suggestions,
}: {
  busySuggestionId: string | null
  onAction: (suggestion: TripIntelligenceSuggestion) => void
  suggestions: TripIntelligenceSuggestion[]
}) {
  if (suggestions.length === 0) return null
  return (
    <Card className="space-y-3" data-testid="ledger-intelligence-panel" variant="grouped">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface">账本建议</h3>
          <p className="mt-1 text-sm leading-6 tm-muted">只处理已经确认或可确认的费用草稿，扫描入口保留在下方工具里。</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary-container px-2.5 py-1 text-xs font-semibold text-on-primary-container">
          {suggestions.length}
        </span>
      </div>
      <div className="space-y-2">
        {suggestions.slice(0, 5).map((suggestion) => (
          <div className="rounded-xl border border-outline-variant/30 bg-surface-container-high/45 px-3 py-3" data-testid="ledger-intelligence-suggestion" key={suggestion.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{suggestion.title}</p>
                <p className="mt-1 break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{suggestion.message}</p>
              </div>
              <Button
                className="min-h-11 shrink-0 px-3 text-xs"
                disabled={busySuggestionId === suggestion.id}
                icon={suggestion.requiresConfirmation ? <Check className="size-3.5" /> : undefined}
                onClick={() => onAction(suggestion)}
                variant="secondary"
              >
                {busySuggestionId === suggestion.id ? '处理中' : suggestion.action?.label ?? '查看'}
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ExpenseEditor({ expense, expenses, items, participants, settings, trip, onCancel, onSaved }: { expense?: LedgerExpense; expenses: LedgerExpense[]; items: ItineraryItem[]; participants: LedgerParticipant[]; settings: LedgerSettings; trip: Trip; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState(expense?.title ?? '')
  const [date, setDate] = useState(expense?.date ?? trip.startDate)
  const [amount, setAmount] = useState(expense?.amountMinor == null ? '' : String(expense.amountMinor / 10 ** getCurrencyMinorDigits(expense.currency ?? settings.tripCurrency)))
  const [currency, setCurrency] = useState(expense?.currency ?? settings.tripCurrency)
  const [category, setCategory] = useState<LedgerExpenseCategory>(expense?.category ?? 'other')
  const [status, setStatus] = useState<LedgerExpenseStatus>(expense?.status ?? 'confirmed')
  const [payer, setPayer] = useState(expense?.payerParticipantId ?? '')
  const [splitMode, setSplitMode] = useState<LedgerSplitMode>(expense?.splitMode ?? 'equal')
  const [shares, setShares] = useState<Record<string, number>>(() => Object.fromEntries((expense?.splitShares ?? participants.map((participant) => ({ participantId: participant.id, weight: 1 }))).map((share) => [share.participantId, share.weight])))
  const [notes, setNotes] = useState(expense?.notes ?? '')
  const [merchant, setMerchant] = useState(expense?.merchant ?? '')
  const [city, setCity] = useState(expense?.city ?? '')
  const [orderNumber, setOrderNumber] = useState(expense?.orderNumber ?? '')
  const [bookedAt, setBookedAt] = useState(expense?.bookedAt ?? '')
  const [paidAt, setPaidAt] = useState(expense?.paidAt ?? '')
  const [serviceStartAt, setServiceStartAt] = useState(expense?.serviceStartAt ?? '')
  const [serviceEndAt, setServiceEndAt] = useState(expense?.serviceEndAt ?? '')
  const [itemIds, setItemIds] = useState<string[]>(expense?.itemIds ?? [])
  const [lineItems, setLineItems] = useState<LedgerExpenseLineItem[]>(expense?.lineItems ?? [])
  const [duplicateAcknowledged, setDuplicateAcknowledged] = useState(expense?.duplicateAcknowledged ?? false)
  const [manualRate, setManualRate] = useState(expense?.exchangeRate?.provider === 'manual')
  const [rateToTrip, setRateToTrip] = useState(expense?.exchangeRate?.rateToTrip ?? '')
  const [rateToHome, setRateToHome] = useState(expense?.exchangeRate?.rateToHome ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const duplicateKind = expenses
    .filter((candidate) => candidate.id !== expense?.id && candidate.status !== 'void')
    .map((candidate) => getLedgerExpenseDuplicateKind({ amountMinor: parseMoneyInput(amount, currency), currency, date, source: expense?.source ?? { kind: 'manual' }, title }, candidate))
    .find(Boolean)
  async function save() {
    const amountMinor = parseMoneyInput(amount, currency, true)
    if (!title.trim()) return setError('请填写费用名称。')
    if (status === 'confirmed' && amountMinor == null) return setError('确认费用必须填写有效金额。')
    if (!areLedgerLineItemsBalanced({ amountMinor, lineItems })) return setError('账单明细合计必须严格等于账单总额。')
    if (duplicateKind === 'exact' && !duplicateAcknowledged) return setError('该来源已存在完全相同的费用，请确认后再保留。')
    const splitShares = Object.entries(shares).filter(([, weight]) => weight > 0).map(([participantId, weight]) => ({ participantId, weight: splitMode === 'weights' ? weight : 1 }))
    setBusy(true); setError('')
    try {
      let exchangeRate = expense?.exchangeRate
      if (manualRate && amountMinor != null) {
        const base = normalizeCurrencyCode(currency)
        const tripRate = base === settings.tripCurrency ? '1' : rateToTrip.trim()
        const homeRate = base === settings.homeCurrency ? '1' : rateToHome.trim()
        if (!isPositiveDecimal(tripRate) || !isPositiveDecimal(homeRate)) return setError('请填写有效的正数汇率。')
        exchangeRate = buildManualLedgerExchangeRateSnapshot({ baseCurrency: base, date, homeCurrency: settings.homeCurrency, rateToHome: homeRate, rateToTrip: tripRate, tripCurrency: settings.tripCurrency })
      } else if (amountMinor != null && (normalizeCurrencyCode(currency) !== settings.tripCurrency || normalizeCurrencyCode(currency) !== settings.homeCurrency)) {
        try { exchangeRate = await getLedgerExchangeRateSnapshot({ baseCurrency: currency, date, homeCurrency: settings.homeCurrency, tripCurrency: settings.tripCurrency }) } catch { exchangeRate = undefined }
      }
      const patch = {
        amountMinor,
        bookedAt: bookedAt || undefined,
        category,
        city: city.trim() || undefined,
        currency: normalizeCurrencyCode(currency),
        date,
        duplicateAcknowledged,
        exchangeRate,
        itemIds,
        lineItems,
        merchant: merchant.trim() || undefined,
        notes: notes.trim() || undefined,
        orderNumber: orderNumber.trim() || undefined,
        orderStatus: expense?.orderStatus ?? 'active' as const,
        paidAt: paidAt || undefined,
        payerParticipantId: payer || undefined,
        paymentStatus: status === 'confirmed' ? 'paid' as const : expense?.paymentStatus ?? 'unknown' as const,
        reviewStatus: 'reviewed' as const,
        serviceEndAt: serviceEndAt || undefined,
        serviceStartAt: serviceStartAt || undefined,
        sourceLinks: expense?.sourceLinks ?? (expense ? undefined : []),
        splitMode,
        splitShares,
        status,
        title: title.trim(),
      }
      if (expense) await updateLedgerExpense(expense.id, patch)
      else await createLedgerExpense({ ...patch, source: { kind: 'manual' }, tripId: trip.id })
      await onSaved()
    } catch (caught) { setError(getErrorMessage(caught)) } finally { setBusy(false) }
  }
  return (
    <Card className="space-y-4" data-testid="ledger-expense-editor" variant="grouped">
      <h3 className="font-semibold">{expense ? '编辑费用' : '新增费用'}</h3>
      <FormField label="费用名称" onChange={setTitle} required value={title} />
      <div className="grid grid-cols-2 gap-2"><FormField label="日期" onChange={setDate} type="date" value={date} /><FormField label="金额" onChange={setAmount} type="number" value={amount} /></div>
      <div className="grid grid-cols-2 gap-2"><CurrencySelect label="币种" value={currency} onChange={setCurrency} /><SelectField label="类别" value={category} onChange={(value) => setCategory(value as LedgerExpenseCategory)} options={categoryOptions.map(([value, label]) => ({ label, value }))} /></div>
      <div className="grid grid-cols-2 gap-2"><FormField label="商户 / 服务商" onChange={setMerchant} value={merchant} /><FormField label="城市" onChange={setCity} value={city} /></div>
      <FormField label="完整订单号" onChange={setOrderNumber} value={orderNumber} />
      <div className="grid grid-cols-2 gap-2"><FormField label="预订时间" onChange={setBookedAt} type="datetime-local" value={bookedAt} /><FormField label="付款时间" onChange={setPaidAt} type="datetime-local" value={paidAt} /></div>
      <div className="grid grid-cols-2 gap-2"><FormField label="使用开始" onChange={setServiceStartAt} type="datetime-local" value={serviceStartAt} /><FormField label="使用结束" onChange={setServiceEndAt} type="datetime-local" value={serviceEndAt} /></div>
      <div><p className={FIELD_LABEL_CLASS}>关联行程点</p><div className="mt-2 max-h-44 space-y-2 overflow-auto">{items.map((item) => <label className="flex min-h-10 items-center gap-2 rounded-lg border border-outline-variant/30 px-3 text-sm" key={item.id}><input checked={itemIds.includes(item.id)} onChange={(event) => setItemIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} type="checkbox" /><span className="truncate">{item.title}</span></label>)}</div></div>
      <div className="grid grid-cols-2 gap-2"><SelectField label="状态" value={status} onChange={(value) => setStatus(value as LedgerExpenseStatus)} options={[{ label: '待确认', value: 'draft' }, { label: '已确认', value: 'confirmed' }, { label: '已取消', value: 'void' }]} /><SelectField label="付款人" value={payer} onChange={setPayer} options={[{ label: '待补充', value: '' }, ...participants.map((participant) => ({ label: participant.displayName, value: participant.id }))]} /></div>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-outline-variant/30 px-3"><input checked={manualRate} onChange={(event) => setManualRate(event.target.checked)} type="checkbox" /><span className="text-sm font-medium">手动设置汇率</span></label>
      {manualRate ? <div className="grid grid-cols-2 gap-2"><RateField baseCurrency={currency} labelCurrency={settings.tripCurrency} onChange={setRateToTrip} value={rateToTrip} /><RateField baseCurrency={currency} labelCurrency={settings.homeCurrency} onChange={setRateToHome} value={rateToHome} /></div> : null}
      {duplicateKind ? <label className="flex min-h-11 items-start gap-3 rounded-lg bg-amber-50 px-3 py-3 text-amber-900"><input checked={duplicateAcknowledged} className="mt-0.5" onChange={(event) => setDuplicateAcknowledged(event.target.checked)} type="checkbox" /><span className="text-sm">{duplicateKind === 'exact' ? '这是同一来源的重复费用，我确认仍要保留。' : '这笔费用与已有记录相似，我已检查。'}</span></label> : null}
      <div><p className={FIELD_LABEL_CLASS}>分摊方式</p><div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-container-high p-1">{([['equal', '均摊'], ['exclude', '排除部分人'], ['weights', '按比例']] as Array<[LedgerSplitMode, string]>).map(([value, label]) => <button className={`min-h-10 rounded-lg text-xs font-semibold ${splitMode === value ? 'bg-surface shadow-sm' : ''}`} key={value} onClick={() => setSplitMode(value)} type="button">{label}</button>)}</div></div>
      <div className="space-y-2">{participants.map((participant) => <label className="flex min-h-11 items-center gap-3 rounded-lg border border-outline-variant/30 px-3" key={participant.id}><input checked={(shares[participant.id] ?? 0) > 0} onChange={(event) => setShares((current) => ({ ...current, [participant.id]: event.target.checked ? 1 : 0 }))} type="checkbox" /><span className="flex-1 text-sm">{participant.displayName}</span>{splitMode === 'weights' && (shares[participant.id] ?? 0) > 0 ? <input aria-label={`${participant.displayName} 权重`} className="h-9 w-20 rounded-lg border px-2 text-sm" min="0.01" onChange={(event) => setShares((current) => ({ ...current, [participant.id]: Number(event.target.value) || 0 }))} step="0.1" type="number" value={shares[participant.id]} /> : null}</label>)}</div>
      <LineItemsEditor currency={currency} items={lineItems} onChange={setLineItems} />
      <label><span className={FIELD_LABEL_CLASS}>备注</span><textarea className={`${FIELD_TEXTAREA_CLASS} min-h-20`} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2"><Button onClick={onCancel} variant="secondary">取消</Button><Button loading={busy} onClick={() => void save()}>保存</Button></div>
    </Card>
  )
}

function ExpenseRow({ expense, participants, settings, tripId, onEdit, onDelete }: { expense: LedgerExpense; participants: LedgerParticipant[]; settings: LedgerSettings; tripId: string; onEdit: () => void; onDelete: () => Promise<void> }) {
  const payer = participants.find((participant) => participant.id === expense.payerParticipantId)
  return (
    <Card className="space-y-2" data-testid="ledger-expense-row" id={`ledger-expense-${expense.id}`} variant="grouped">
      <button className="w-full text-left" onClick={() => navigateTo('ledger/expense', { expenseId: expense.id, tripId })} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{expense.title}</p><p className="mt-1 text-xs tm-muted">{expense.date} · {ledgerCategoryLabels[expense.category]} · {payer?.displayName ?? '付款人待补充'}</p>{expense.merchant || expense.city ? <p className="mt-1 truncate text-xs tm-muted">{[expense.merchant, expense.city].filter(Boolean).join(' · ')}</p> : null}</div><div className="text-right"><p className="font-bold">{formatLedgerMoney(expense.amountMinor, expense.currency ?? settings.tripCurrency)}</p><p className="mt-1 text-xs tm-muted">{expense.status === 'confirmed' ? '已确认' : expense.status === 'draft' ? '待确认' : '已取消'}</p></div></div></button>
      <div className="flex justify-end gap-1"><Button onClick={onEdit} variant="ghost">编辑</Button><button aria-label={`删除 ${expense.title}`} className="flex size-10 items-center justify-center rounded-lg text-red-600" onClick={() => void onDelete()} type="button"><Trash2 className="size-4" /></button></div>
    </Card>
  )
}

function LineItemsEditor({ currency, items, onChange }: { currency: string; items: LedgerExpenseLineItem[]; onChange: (items: LedgerExpenseLineItem[]) => void }) {
  const total = items.reduce((sum, item) => sum + item.amountMinor, 0)
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3"><div><p className={FIELD_LABEL_CLASS}>账单拆分明细</p><p className="text-xs tm-muted">税费、小费、折扣与多类别明细必须合计到账单总额。</p></div><Button icon={<Plus className="size-4" />} onClick={() => onChange([...items, { amountMinor: 0, category: 'other', currency, id: `line-${Date.now()}`, kind: 'base', title: '明细' }])} variant="secondary">添加</Button></div>
      {items.map((item, index) => (
        <div className="grid grid-cols-[1fr_110px_40px] gap-2" key={item.id}>
          <input aria-label={`明细 ${index + 1} 名称`} className={FIELD_INPUT_CLASS} onChange={(event) => onChange(items.map((current) => current.id === item.id ? { ...current, title: event.target.value } : current))} value={item.title} />
          <input aria-label={`明细 ${index + 1} 金额`} className={FIELD_INPUT_CLASS} onChange={(event) => onChange(items.map((current) => current.id === item.id ? { ...current, amountMinor: parseMoneyInput(event.target.value, currency, true) ?? 0, currency } : current))} step="any" type="number" value={item.amountMinor / 10 ** getCurrencyMinorDigits(currency)} />
          <button aria-label={`删除明细 ${index + 1}`} className="flex size-10 items-center justify-center text-red-600" onClick={() => onChange(items.filter((current) => current.id !== item.id))} type="button"><Trash2 className="size-4" /></button>
          <select aria-label={`明细 ${index + 1} 类别`} className={`${FIELD_SELECT_CLASS} col-span-2`} onChange={(event) => onChange(items.map((current) => current.id === item.id ? { ...current, category: event.target.value as LedgerExpenseCategory } : current))} value={item.category}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        </div>
      ))}
      {items.length > 0 ? <p className="text-xs font-semibold tm-muted">明细合计：{formatLedgerMoney(total, currency)}</p> : null}
    </section>
  )
}

function TimelineView({ expenses, settings }: { expenses: LedgerExpense[]; settings: LedgerSettings }) {
  const [kind, setKind] = useState<LedgerTimelineKind>(() => (window.localStorage.getItem('tripmap:ledger-timeline-kind') as LedgerTimelineKind | null) ?? 'service')
  const events = useMemo(() => buildLedgerTimeline(expenses).filter((event) => event.kind === kind), [expenses, kind])
  function select(next: LedgerTimelineKind) {
    setKind(next)
    window.localStorage.setItem('tripmap:ledger-timeline-kind', next)
  }
  return (
    <section className="space-y-4">
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-surface-container p-1">{([['booking', '预订'], ['payment', '付款'], ['service', '使用']] as Array<[LedgerTimelineKind, string]>).map(([value, label]) => <button className={`min-h-11 rounded-lg text-sm font-semibold ${kind === value ? 'bg-surface shadow-sm' : 'tm-muted'}`} key={value} onClick={() => select(value)} type="button">{label}</button>)}</div>
      {events.length === 0 ? <EmptyState body="账单补齐对应时间后会出现在这里。" icon={<CalendarClock className="size-6" />} title="这条时间线还没有记录" /> : events.map((event) => <div className="grid grid-cols-[90px_1fr] gap-3" key={event.id}><time className="pt-3 text-xs font-semibold tm-muted">{event.at.replace('T', ' ')}</time><Card className="space-y-1" variant="grouped"><p className="font-semibold">{event.title}</p><p className="text-xs tm-muted">{event.city || '城市待补充'} · {formatLedgerMoney(event.amountMinor, event.currency ?? settings.tripCurrency)}</p></Card></div>)}
    </section>
  )
}

function IntegrityView({ expenses, onEdit }: { expenses: LedgerExpense[]; onEdit: (expense: LedgerExpense) => void }) {
  const issues = useMemo(() => buildLedgerIntegrityIssues(expenses), [expenses])
  return (
    <section className="space-y-3">
      <div><h3 className="font-semibold">票据完整性检查</h3><p className="mt-1 text-sm tm-muted">检查付款证据、行程关联、取消退款、重复来源和明细守恒。</p></div>
      {issues.length === 0 ? <EmptyState body="当前账单来源和关键字段完整。" icon={<Check className="size-6" />} title="没有发现问题" /> : issues.map((issue, index) => {
        const expense = expenses.find((item) => item.id === issue.expenseId)
        return <button className={`flex w-full items-start gap-3 rounded-lg border px-3 py-3 text-left ${issue.severity === 'error' ? 'border-red-200 bg-red-50 text-red-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`} key={`${issue.expenseId}:${issue.kind}:${index}`} onClick={() => expense && onEdit(expense)} type="button"><FileWarning className="mt-0.5 size-4 shrink-0" /><span className="text-sm">{issue.message}</span></button>
      })}
    </section>
  )
}

function BudgetAndForecastView({ budgets, expenses, settings, trip, onChanged }: { budgets: LedgerBudget[]; expenses: LedgerExpense[]; settings: LedgerSettings; trip: Trip; onChanged: () => Promise<void> }) {
  const forecast = useMemo(() => buildLedgerForecast({ budgets, expenses, settings, trip }), [budgets, expenses, settings, trip])
  return <section className="space-y-4"><div className="grid grid-cols-2 gap-2"><Card variant="grouped"><p className="text-xs tm-muted">预计最终花费</p><p className="mt-1 text-lg font-bold">{formatLedgerMoney(forecast.projectedMinor, settings.tripCurrency)}</p></Card><Card variant="grouped"><p className="text-xs tm-muted">每日可用预算</p><p className="mt-1 text-lg font-bold">{formatLedgerMoney(forecast.dailyAvailableMinor, settings.tripCurrency)}</p></Card></div>{forecast.riskCategories.length > 0 ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">最可能超支：{forecast.riskCategories.map((category) => ledgerCategoryLabels[category]).join('、')}</p> : null}<BudgetsView budgets={budgets} settings={settings} trip={trip} onChanged={onChanged} /></section>
}

function ReportView({ budgets, expenses, participants, settings, trip, onChanged }: { budgets: LedgerBudget[]; expenses: LedgerExpense[]; participants: LedgerParticipant[]; settings: LedgerSettings; trip: Trip; onChanged: () => Promise<void> }) {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<ReturnType<typeof queryLedgerLocally> | null>(null)
  const [manage, setManage] = useState<'participants' | 'settlement' | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiAnswer, setAiAnswer] = useState('')
  const [aiError, setAiError] = useState('')
  const reportInput = useMemo(() => ({ budgets, expenses, participants, settings, trip }), [budgets, expenses, participants, settings, trip])
  const report = useMemo(() => buildLedgerReportModel(reportInput), [reportInput])
  async function runLocalQuery() {
    setAiAnswer('')
    setAiError('')
    const localResult = queryLedgerLocally(query, expenses, settings)
    setResult(localResult)
    if (!localResult.needsAi) return
    setAiBusy(true)
    try {
      const preferences = await getAccountAiPreferences()
      if (!preferences.autoExpenseAiEnabled) {
        setAiError('复杂语义未自动解析；账号级账单 AI 当前关闭，以上为本地回退结果。')
        return
      }
      const response = await fetchProviderProxyAiExpenseQuery({
        operation: 'ai_expense_query',
        question: query,
        rows: buildLedgerAiQueryContext(expenses),
      }, getProviderProxyConfig().proxyUrl ?? '/api/provider-proxy')
      setResult(executeLedgerQueryPlan(response.plan, expenses, settings))
      setAiAnswer('复杂语义由 AI 转成查询计划；筛选、金额和分组已在本机重新执行。')
    } catch (caught) {
      setAiError(`${getErrorMessage(caught)} 已保留本地回退结果。`)
    } finally {
      setAiBusy(false)
    }
  }
  return (
    <section className="space-y-4">
      <div className="space-y-2"><h3 className="font-semibold">查询旅行账单</h3><div className="flex gap-2"><input className={FIELD_INPUT_CLASS} onChange={(event) => setQuery(event.target.value)} placeholder="例如：东京酒店一共多少钱？" value={query} /><Button icon={<Search className="size-4" />} loading={aiBusy} onClick={() => void runLocalQuery()}>查询</Button></div></div>
      {result ? <Card className="space-y-3" variant="grouped"><p className="font-semibold">{result.answer}</p>{aiAnswer ? <p className="text-xs text-emerald-700">{aiAnswer}</p> : null}{aiError ? <p className="text-xs text-amber-700">{aiError}</p> : null}<div className="flex flex-wrap gap-2">{result.citations.map((citation) => <button className="rounded-lg border border-outline-variant/40 px-2.5 py-1.5 text-xs font-semibold" key={`${citation.expenseId}:${citation.sourceId}`} onClick={() => navigateTo('ledger/expense', { expenseId: citation.expenseId, tripId: trip.id })} type="button">{citation.title}{citation.available ? '' : '（来源缺失）'}</button>)}</div></Card> : null}
      <Card className="space-y-4" variant="grouped">
        <div><p className="text-xs font-semibold text-primary">{report.title}</p><h3 className="mt-1 font-semibold">旅行消费概览</h3></div>
        <div className="grid grid-cols-2 gap-2"><ReportMetric label="已确认净支出" value={formatLedgerMoney(report.confirmedNetMinor, settings.tripCurrency)} /><ReportMetric label="预计最终支出" value={formatLedgerMoney(report.projectedMinor, settings.tripCurrency)} /><ReportMetric label="待确认" value={formatLedgerMoney(report.pendingMinor, settings.tripCurrency)} /><ReportMetric label="完整性问题" value={`${report.issues.length} 项`} /></div>
        {report.byCity.length ? <div><p className="text-xs font-semibold tm-muted">城市摘要</p><div className="mt-2 flex flex-wrap gap-2">{report.byCity.slice(0, 5).map((row) => <span className="rounded-lg bg-surface-container-high px-2.5 py-1.5 text-xs" key={row.key}>{row.label} · {formatLedgerMoney(row.amountMinor, settings.tripCurrency)}</span>)}</div></div> : null}
        {report.missingExchangeRate.length ? <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">{report.missingExchangeRate.length} 笔已确认费用缺汇率，未纳入折算汇总。</p> : null}
      </Card>
      <div className="grid grid-cols-2 gap-2"><Button icon={<ReceiptText className="size-4" />} onClick={() => openLedgerPrintReport(reportInput)} variant="secondary">打印报告</Button><Button icon={<Download className="size-4" />} onClick={() => { openLedgerPrintReport(reportInput); void downloadLedgerArchive(reportInput) }}>导出旅行档案</Button></div>
      <div className="grid grid-cols-2 gap-2"><Button onClick={() => setManage(manage === 'participants' ? null : 'participants')} variant="secondary">同行人管理</Button><Button onClick={() => setManage(manage === 'settlement' ? null : 'settlement')} variant="secondary">查看结算</Button></div>
      {manage === 'participants' ? <ParticipantsView participants={participants} tripId={trip.id} onChanged={onChanged} /> : null}
      {manage === 'settlement' ? <SettlementView expenses={expenses} participants={participants} settings={settings} /> : null}
    </section>
  )
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-surface-container-high p-3"><p className="text-xs tm-muted">{label}</p><p className="mt-1 text-sm font-bold text-on-surface">{value}</p></div>
}

function BudgetsView({ budgets, settings, trip, onChanged }: { budgets: LedgerBudget[]; settings: LedgerSettings; trip: Trip; onChanged: () => Promise<void> }) {
  const [scope, setScope] = useState<LedgerBudgetScope>('category')
  const [amount, setAmount] = useState('')
  const [category, setCategory] = useState<LedgerExpenseCategory>('food')
  const [date, setDate] = useState(trip.startDate)
  const total = budgets.find((budget) => budget.scope === 'trip')
  async function saveBudget() {
    const amountMinor = parseMoneyInput(amount, settings.tripCurrency)
    if (amountMinor == null || amountMinor <= 0) return
    await createLedgerBudget({ amountMinor, category: scope === 'category' ? category : undefined, currency: settings.tripCurrency, date: scope === 'date' ? date : undefined, scope, tripId: trip.id })
    setAmount(''); await onChanged()
  }
  return (
    <section className="space-y-4">
      {total ? <Card className="space-y-3" variant="grouped"><p className="text-sm font-semibold">旅行总预算</p><p className="text-2xl font-bold">{formatLedgerMoney(total.amountMinor, total.currency)}</p><FormField label="修改总预算" onChange={setAmount} type="number" value={amount} /><Button disabled={!amount} onClick={async () => { const value = parseMoneyInput(amount, total.currency); if (value != null) await updateLedgerBudget(total.id, { amountMinor: value }); setAmount(''); await onChanged() }} variant="secondary">更新总预算</Button></Card> : null}
      <Card className="space-y-3" variant="grouped"><h3 className="font-semibold">增加预算提醒</h3><SelectField label="预算范围" value={scope} onChange={(value) => setScope(value as LedgerBudgetScope)} options={[{ label: '按类别', value: 'category' }, { label: '按日期', value: 'date' }]} />{scope === 'category' ? <SelectField label="类别" value={category} onChange={(value) => setCategory(value as LedgerExpenseCategory)} options={categoryOptions.map(([value, label]) => ({ label, value }))} /> : <FormField label="日期" onChange={setDate} type="date" value={date} />}<FormField label={`预算金额（${settings.tripCurrency}）`} onChange={setAmount} type="number" value={amount} /><Button className="w-full" onClick={() => void saveBudget()}>添加预算</Button></Card>
      {budgets.filter((budget) => budget.scope !== 'trip').map((budget) => <Card className="flex items-center gap-3" key={budget.id} variant="grouped"><div className="min-w-0 flex-1"><p className="font-semibold">{budget.scope === 'category' && budget.category ? ledgerCategoryLabels[budget.category] : budget.date}</p><p className="text-sm tm-muted">{formatLedgerMoney(budget.amountMinor, budget.currency)}</p></div><button aria-label="删除预算" className="flex size-10 items-center justify-center text-red-600" onClick={async () => { await deleteLedgerBudget(budget.id); await onChanged() }} type="button"><Trash2 className="size-4" /></button></Card>)}
    </section>
  )
}

function ParticipantsView({ participants, tripId, onChanged }: { participants: LedgerParticipant[]; tripId: string; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  async function add(displayName: string, source: LedgerParticipant['source'], sourceId?: string) {
    if (!displayName.trim() || participants.some((participant) => participant.displayName.trim() === displayName.trim())) return
    await createLedgerParticipant({ displayName: displayName.trim(), source, sourceId, tripId }); await onChanged()
  }
  async function importShared() {
    try { const state = await loadOwnerSharedTripState(tripId); if (!state.configured || !state.signedIn) throw new Error('请先登录并建立同行共享。'); for (const member of state.members) await add(member.displayName || member.email || '同行人', 'shared_trip', member.userId); setMessage('已导入可用的同行共享成员。') } catch (caught) { setMessage(getErrorMessage(caught)) }
  }
  async function importTravelers() {
    try { const travelers = await listTravelerProfiles(); for (const traveler of travelers) await add(traveler.data.displayName, 'traveler_profile', traveler.id); setMessage('已从已解锁的旅行资料库导入显示名。') } catch (caught) { setMessage(getErrorMessage(caught)) }
  }
  return (
    <section className="space-y-4"><Card className="space-y-3" variant="grouped"><FormField label="同行人姓名" onChange={setName} value={name} /><Button className="w-full" icon={<UserPlus className="size-4" />} onClick={async () => { await add(name, 'manual'); setName('') }}>添加同行人</Button><div className="grid grid-cols-2 gap-2"><Button onClick={() => void importShared()} variant="secondary">导入共享成员</Button><Button onClick={() => void importTravelers()} variant="secondary">导入旅行者</Button></div>{message ? <p className="text-xs tm-muted">{message}</p> : null}</Card>{participants.map((participant) => <Card className="flex items-center gap-3" key={participant.id} variant="grouped"><UsersRound className="size-5 text-primary" /><input aria-label={`${participant.displayName} 姓名`} className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none" defaultValue={participant.displayName} onBlur={async (event) => { const next = event.target.value.trim(); if (next && next !== participant.displayName) { await updateLedgerParticipant(participant.id, { displayName: next }); await onChanged() } }} /><span className="text-xs tm-muted">{participant.isSelf ? '本人' : ''}</span>{!participant.isSelf ? <button aria-label={`删除 ${participant.displayName}`} className="flex size-10 items-center justify-center text-red-600" onClick={async () => { try { await deleteLedgerParticipant(participant.id); await onChanged() } catch (caught) { setMessage(getErrorMessage(caught)) } }} type="button"><Trash2 className="size-4" /></button> : null}</Card>)}</section>
  )
}

function SettlementView({ expenses, participants, settings }: { expenses: LedgerExpense[]; participants: LedgerParticipant[]; settings: LedgerSettings }) {
  const result = useMemo(() => buildLedgerSettlement({ expenses, participants, settings }), [expenses, participants, settings])
  const text = result.transfers.length ? result.transfers.map((transfer) => `${transfer.fromName} 付给 ${transfer.toName} ${formatLedgerMoney(transfer.amountMinor, transfer.currency)}`).join('\n') : '当前没有需要结算的转账。'
  return (
    <section className="space-y-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold">结算清单</h3><p className="mt-1 text-xs tm-muted">仅纳入完整费用，统一使用 {settings.settlementCurrency}</p></div><Button icon={<Copy className="size-4" />} onClick={() => void navigator.clipboard.writeText(text)} variant="secondary">复制</Button></div>{result.transfers.length === 0 ? <EmptyState body="确认费用并补齐付款人、分摊和汇率后，这里会生成最少转账清单。" icon={<Calculator className="size-6" />} title="暂时无需转账" /> : result.transfers.map((transfer, index) => <Card className="flex items-center gap-3" key={`${transfer.fromParticipantId}:${transfer.toParticipantId}:${index}`} variant="grouped"><div className="flex size-10 items-center justify-center rounded-full bg-primary-container text-on-primary-container"><Check className="size-5" /></div><div className="min-w-0 flex-1"><p className="font-semibold">{transfer.fromName} → {transfer.toName}</p><p className="text-sm tm-muted">{formatLedgerMoney(transfer.amountMinor, transfer.currency)}</p></div></Card>)}{result.excluded.length > 0 ? <section className="space-y-2"><h4 className="text-sm font-semibold text-amber-700">未纳入结算（{result.excluded.length}）</h4>{result.excluded.map((item) => <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" key={item.expenseId}>{item.title}：{item.reason}</p>)}</section> : null}</section>
  )
}

function CurrencySelect({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <SelectField label={label} onChange={onChange} options={commonLedgerCurrencies.map((currency) => ({ label: currency, value: currency }))} value={value} />
}

function RateField({ baseCurrency, labelCurrency, onChange, value }: { baseCurrency: string; labelCurrency: string; onChange: (value: string) => void; value: string }) {
  const sameCurrency = normalizeCurrencyCode(baseCurrency) === labelCurrency
  return <label><span className={FIELD_LABEL_CLASS}>1 {normalizeCurrencyCode(baseCurrency)} = {labelCurrency}</span><input className={FIELD_INPUT_CLASS} disabled={sameCurrency} min="0" onChange={(event) => onChange(event.target.value)} placeholder={sameCurrency ? '1' : '汇率'} step="any" type="number" value={sameCurrency ? '1' : value} /></label>
}

function SelectField({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ label: string; value: string }> }) {
  return <label><span className={FIELD_LABEL_CLASS}>{label}</span><select className={FIELD_SELECT_CLASS} onChange={(event) => onChange(event.target.value)} value={value}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

function getErrorMessage(caught: unknown) {
  return caught instanceof Error ? caught.message : '操作失败，请稍后重试。'
}

function isPositiveDecimal(value: string) {
  return /^(?:\d+|\d*\.\d+)$/.test(value) && Number(value) > 0
}
