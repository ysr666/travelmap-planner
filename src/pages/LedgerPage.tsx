import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Check,
  Copy,
  FileSearch,
  Plus,
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
import { fetchProviderProxyAiExpenseExtract, getProviderProxyConfig } from '../lib/providerProxyClient'
import { getRouteParams, navigateTo } from '../lib/routes'
import { listTransportBookings, listTravelerProfiles } from '../lib/travelDocumentCenter'
import type {
  LedgerBudget,
  LedgerBudgetScope,
  LedgerExpense,
  LedgerExpenseCategory,
  LedgerExpenseStatus,
  LedgerParticipant,
  LedgerSettings,
  LedgerSplitMode,
  Trip,
} from '../types'

type LedgerTab = 'expenses' | 'budgets' | 'participants' | 'settlement'
type ScanCandidate = LedgerExpenseDraftCandidate & { selected: boolean }

const categoryOptions = Object.entries(ledgerCategoryLabels) as Array<[LedgerExpenseCategory, string]>

export function LedgerPage() {
  const tripId = getRouteParams().get('tripId') ?? ''
  const [trip, setTrip] = useState<Trip | null>(null)
  const [settings, setSettings] = useState<LedgerSettings | null>(null)
  const [participants, setParticipants] = useState<LedgerParticipant[]>([])
  const [budgets, setBudgets] = useState<LedgerBudget[]>([])
  const [expenses, setExpenses] = useState<LedgerExpense[]>([])
  const [activeTab, setActiveTab] = useState<LedgerTab>('expenses')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!tripId) return
    const [nextTrip, nextSettings, nextParticipants, nextBudgets, nextExpenses] = await Promise.all([
      getTrip(tripId),
      getLedgerSettingsByTrip(tripId),
      listLedgerParticipants(tripId),
      listLedgerBudgets(tripId),
      listLedgerExpenses(tripId),
    ])
    setTrip(nextTrip ?? null)
    setSettings(nextSettings ?? null)
    setParticipants(nextParticipants)
    setBudgets(nextBudgets)
    setExpenses(nextExpenses)
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

      <nav className="grid grid-cols-4 gap-1 rounded-xl border border-outline-variant/30 bg-surface-container p-1" aria-label="账本视图">
        {([
          ['expenses', '明细'],
          ['budgets', '预算'],
          ['participants', '同行人'],
          ['settlement', '结算'],
        ] as Array<[LedgerTab, string]>).map(([value, label]) => (
          <button className={`min-h-11 rounded-lg px-2 text-sm font-semibold ${activeTab === value ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant'}`} key={value} onClick={() => setActiveTab(value)} type="button">{label}</button>
        ))}
      </nav>

      {activeTab === 'expenses' ? <ExpensesView expenses={expenses} participants={participants} settings={settings} trip={trip} onChanged={refresh} /> : null}
      {activeTab === 'budgets' ? <BudgetsView budgets={budgets} settings={settings} trip={trip} onChanged={refresh} /> : null}
      {activeTab === 'participants' ? <ParticipantsView participants={participants} tripId={tripId} onChanged={refresh} /> : null}
      {activeTab === 'settlement' ? <SettlementView expenses={expenses} participants={participants} settings={settings} /> : null}
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

function ExpensesView({ expenses, participants, settings, trip, onChanged }: { expenses: LedgerExpense[]; participants: LedgerParticipant[]; settings: LedgerSettings; trip: Trip; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<LedgerExpense | 'new' | null>(null)
  const [scanCandidates, setScanCandidates] = useState<ScanCandidate[]>([])
  const [scanning, setScanning] = useState(false)
  const [aiConfirm, setAiConfirm] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [message, setMessage] = useState('')

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
      await createLedgerExpense({
        amountMinor: candidate.amountMinor,
        category: candidate.category,
        currency: candidate.currency,
        date: candidate.date,
        payerParticipantId: candidate.payerParticipantId,
        source: candidate.source,
        splitMode: 'equal',
        splitShares: participants.map((participant) => ({ participantId: participant.id, weight: 1 })),
        status: 'draft',
        title: candidate.title,
        tripId: trip.id,
      })
    }
    setScanCandidates([])
    setMessage(`已生成 ${selected.length} 条待确认费用。`)
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
      <div className="grid grid-cols-2 gap-2">
        <Button icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>记一笔</Button>
        <Button icon={<FileSearch className="size-4" />} loading={scanning} onClick={() => void scanSources()} variant="secondary">整理费用</Button>
      </div>
      {message ? <p className="text-sm tm-muted">{message}</p> : null}
      {editing ? <ExpenseEditor expense={editing === 'new' ? undefined : editing} expenses={expenses} participants={participants} settings={settings} trip={trip} onCancel={() => setEditing(null)} onSaved={async () => { setEditing(null); await onChanged() }} /> : null}
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
      <div className="space-y-2">
        {expenses.length === 0 ? <EmptyState body="手动记一笔，或从票据、订单和备注整理费用草稿。" icon={<WalletCards className="size-6" />} title="账本还是空的" /> : null}
        {expenses.map((expense) => <ExpenseRow expense={expense} key={expense.id} participants={participants} settings={settings} onEdit={() => setEditing(expense)} onDelete={async () => { await deleteLedgerExpense(expense.id); await onChanged() }} />)}
      </div>
      <ConfirmDialog body={`将发送 ${scanCandidates.length} 条本地提取文本和同行人显示名给 AI。不会发送票据文件、邮箱、用户 ID、云数据或加密资料；返回内容只更新当前预览。`} confirmLabel="确认发送" loading={aiBusy} onCancel={() => setAiConfirm(false)} onConfirm={() => void fillWithAi()} open={aiConfirm} title="使用 AI 补全费用字段" />
    </section>
  )
}

function ExpenseEditor({ expense, expenses, participants, settings, trip, onCancel, onSaved }: { expense?: LedgerExpense; expenses: LedgerExpense[]; participants: LedgerParticipant[]; settings: LedgerSettings; trip: Trip; onCancel: () => void; onSaved: () => Promise<void> }) {
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
    const amountMinor = parseMoneyInput(amount, currency)
    if (!title.trim()) return setError('请填写费用名称。')
    if (status === 'confirmed' && amountMinor == null) return setError('确认费用必须填写有效金额。')
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
      const patch = { amountMinor, category, currency: normalizeCurrencyCode(currency), date, duplicateAcknowledged, exchangeRate, notes: notes.trim() || undefined, payerParticipantId: payer || undefined, splitMode, splitShares, status, title: title.trim() }
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
      <div className="grid grid-cols-2 gap-2"><SelectField label="状态" value={status} onChange={(value) => setStatus(value as LedgerExpenseStatus)} options={[{ label: '待确认', value: 'draft' }, { label: '已确认', value: 'confirmed' }, { label: '已取消', value: 'void' }]} /><SelectField label="付款人" value={payer} onChange={setPayer} options={[{ label: '待补充', value: '' }, ...participants.map((participant) => ({ label: participant.displayName, value: participant.id }))]} /></div>
      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-outline-variant/30 px-3"><input checked={manualRate} onChange={(event) => setManualRate(event.target.checked)} type="checkbox" /><span className="text-sm font-medium">手动设置汇率</span></label>
      {manualRate ? <div className="grid grid-cols-2 gap-2"><RateField baseCurrency={currency} labelCurrency={settings.tripCurrency} onChange={setRateToTrip} value={rateToTrip} /><RateField baseCurrency={currency} labelCurrency={settings.homeCurrency} onChange={setRateToHome} value={rateToHome} /></div> : null}
      {duplicateKind ? <label className="flex min-h-11 items-start gap-3 rounded-lg bg-amber-50 px-3 py-3 text-amber-900"><input checked={duplicateAcknowledged} className="mt-0.5" onChange={(event) => setDuplicateAcknowledged(event.target.checked)} type="checkbox" /><span className="text-sm">{duplicateKind === 'exact' ? '这是同一来源的重复费用，我确认仍要保留。' : '这笔费用与已有记录相似，我已检查。'}</span></label> : null}
      <div><p className={FIELD_LABEL_CLASS}>分摊方式</p><div className="mt-2 grid grid-cols-3 gap-1 rounded-xl bg-surface-container-high p-1">{([['equal', '均摊'], ['exclude', '排除部分人'], ['weights', '按比例']] as Array<[LedgerSplitMode, string]>).map(([value, label]) => <button className={`min-h-10 rounded-lg text-xs font-semibold ${splitMode === value ? 'bg-surface shadow-sm' : ''}`} key={value} onClick={() => setSplitMode(value)} type="button">{label}</button>)}</div></div>
      <div className="space-y-2">{participants.map((participant) => <label className="flex min-h-11 items-center gap-3 rounded-lg border border-outline-variant/30 px-3" key={participant.id}><input checked={(shares[participant.id] ?? 0) > 0} onChange={(event) => setShares((current) => ({ ...current, [participant.id]: event.target.checked ? 1 : 0 }))} type="checkbox" /><span className="flex-1 text-sm">{participant.displayName}</span>{splitMode === 'weights' && (shares[participant.id] ?? 0) > 0 ? <input aria-label={`${participant.displayName} 权重`} className="h-9 w-20 rounded-lg border px-2 text-sm" min="0.01" onChange={(event) => setShares((current) => ({ ...current, [participant.id]: Number(event.target.value) || 0 }))} step="0.1" type="number" value={shares[participant.id]} /> : null}</label>)}</div>
      <label><span className={FIELD_LABEL_CLASS}>备注</span><textarea className={`${FIELD_TEXTAREA_CLASS} min-h-20`} onChange={(event) => setNotes(event.target.value)} value={notes} /></label>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="grid grid-cols-2 gap-2"><Button onClick={onCancel} variant="secondary">取消</Button><Button loading={busy} onClick={() => void save()}>保存</Button></div>
    </Card>
  )
}

function ExpenseRow({ expense, participants, settings, onEdit, onDelete }: { expense: LedgerExpense; participants: LedgerParticipant[]; settings: LedgerSettings; onEdit: () => void; onDelete: () => Promise<void> }) {
  const payer = participants.find((participant) => participant.id === expense.payerParticipantId)
  return (
    <Card className="space-y-2" data-testid="ledger-expense-row" variant="grouped">
      <button className="w-full text-left" onClick={onEdit} type="button"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold">{expense.title}</p><p className="mt-1 text-xs tm-muted">{expense.date} · {ledgerCategoryLabels[expense.category]} · {payer?.displayName ?? '付款人待补充'}</p></div><div className="text-right"><p className="font-bold">{formatLedgerMoney(expense.amountMinor, expense.currency ?? settings.tripCurrency)}</p><p className="mt-1 text-xs tm-muted">{expense.status === 'confirmed' ? '已确认' : expense.status === 'draft' ? '待确认' : '已取消'}</p></div></div></button>
      <div className="flex justify-end"><button aria-label={`删除 ${expense.title}`} className="flex size-10 items-center justify-center rounded-lg text-red-600" onClick={() => void onDelete()} type="button"><Trash2 className="size-4" /></button></div>
    </Card>
  )
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
