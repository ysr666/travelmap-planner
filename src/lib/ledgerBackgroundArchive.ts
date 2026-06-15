import {
  createLedgerExpense,
  db,
  getLedgerSettingsByTrip,
  getTicketBlob,
  getTrip,
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listLedgerParticipants,
  listTicketsByTrip,
  updateLedgerExpense,
} from '../db'
import { extractExistingTripImportSources } from './ai/existingTripImportExtraction'
import { listTravelInboxEntriesByTrip } from './ai/travelInbox'
import { getAccountAiPreferences } from './accountAiPreferences'
import {
  buildLedgerCandidateMergePatch,
  buildLedgerExpenseFromCandidate,
  findLedgerCandidateMatch,
} from './ledgerArchive'
import {
  buildLedgerExpenseDraftCandidates,
  calculateLedgerCandidateConfidence,
  sanitizeLedgerExtractionTextForAi,
  type LedgerExpenseDraftCandidate,
} from './ledgerExtraction'
import { fetchProviderProxyAiExpenseExtract, getProviderProxyConfig } from './providerProxyClient'
import { listTransportBookings } from './travelDocumentCenter'

const MAX_ATTEMPTS = 3

export async function runLedgerArchiveForAllTrips() {
  const settings = await db.ledgerSettings.toArray()
  for (const record of settings) {
    await runLedgerArchiveForTrip(record.tripId)
  }
}

export async function runLedgerArchiveForTrip(tripId: string) {
  const [trip, settings, participants, expenses, days, items, tickets, inboxEntries, bookings] = await Promise.all([
    getTrip(tripId),
    getLedgerSettingsByTrip(tripId),
    listLedgerParticipants(tripId),
    listLedgerExpenses(tripId),
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
    listTravelInboxEntriesByTrip(tripId),
    listTransportBookings(tripId),
  ])
  if (!trip || !settings) return { created: 0, merged: 0, skipped: 0 }

  const sourceTextOverrides: Record<string, string> = {}
  const linkedTicketIds = new Set(expenses.flatMap((expense) => expense.sourceLinks ?? [expense.source]).filter((source) => source.kind === 'ticket').map((source) => source.sourceId))
  for (const ticket of tickets.filter((candidate) => !linkedTicketIds.has(candidate.id))) {
    const blob = await getTicketBlob(ticket.id)
    if (!blob) continue
    try {
      const extraction = await extractExistingTripImportSources({ files: [new File([blob.blob], ticket.fileName, { type: ticket.mimeType })] })
      sourceTextOverrides[`ticket:${ticket.id}`] = extraction.sources.map((source) => source.text).join('\n')
    } catch {
      // Ticket metadata remains usable when OCR or PDF extraction fails.
    }
  }

  let candidates = buildLedgerExpenseDraftCandidates({
    bookings,
    days,
    existingExpenses: expenses,
    inboxEntries,
    items,
    participants,
    sourceTextOverrides,
    tickets,
    tripCurrency: settings.tripCurrency,
    tripStartDate: trip.startDate,
  })
  if (candidates.length === 0) return { created: 0, merged: 0, skipped: 0 }

  await queueCandidates(tripId, candidates)
  candidates = await listProcessableCandidates(tripId, candidates)
  if (candidates.length === 0) return { created: 0, merged: 0, skipped: 0 }
  const preferences = await getAccountAiPreferences()
  if (preferences.autoExpenseAiEnabled && typeof navigator !== 'undefined' && navigator.onLine) {
    candidates = await enrichCandidatesWithAi(candidates, participants, settings.tripCurrency)
  }

  let created = 0
  let merged = 0
  let skipped = 0
  const currentExpenses = [...expenses]
  for (const candidate of candidates) {
    const queueId = buildQueueId(tripId, candidate)
    try {
      await db.ledgerArchiveQueue.update(queueId, { status: 'processing', updatedAt: Date.now() })
      const match = findLedgerCandidateMatch(candidate, currentExpenses)
      if (match?.kind === 'source') {
        skipped += 1
      } else if (match?.kind === 'order' && candidate.sourceRole === 'refund_notice') {
        const reversal = buildLedgerExpenseFromCandidate(candidate, tripId, participants)
        const createdExpense = await createLedgerExpense({
          ...reversal,
          amountMinor: candidate.amountMinor == null ? undefined : -Math.abs(candidate.amountMinor),
          category: match.expense.category,
          city: match.expense.city ?? candidate.city,
          itemIds: match.expense.itemIds ?? candidate.itemIds,
          merchant: match.expense.merchant ?? candidate.merchant,
          originalExpenseId: match.expense.id,
          payerParticipantId: match.expense.payerParticipantId,
          reviewStatus: 'needs_review',
          splitMode: match.expense.splitMode,
          splitShares: match.expense.splitShares,
          status: candidate.amountMinor == null ? 'draft' : 'confirmed',
          title: `退款 · ${match.expense.title}`,
        })
        currentExpenses.push(createdExpense)
        await updateLedgerExpense(match.expense.id, {
          paymentStatus: candidate.paymentStatus,
          refundedAt: candidate.refundedAt ?? candidate.date,
          sourceLinks: [...(match.expense.sourceLinks ?? []), candidate.sourceLink],
        })
        created += 1
      } else if (match?.kind === 'order') {
        const patch = buildLedgerCandidateMergePatch(match.expense, candidate)
        const autoConfirm = candidate.paymentStatus === 'paid' && candidate.recognitionConfidence >= 0.85 && candidate.orderStatus !== 'cancelled'
        const updated = await updateLedgerExpense(match.expense.id, {
          ...patch,
          autoConfirmReason: autoConfirm ? '订单与付款来源合并后达到自动确认标准。' : match.expense.autoConfirmReason,
          reviewStatus: autoConfirm ? 'auto_confirmed' : patch.reviewStatus,
          status: autoConfirm ? 'confirmed' : patch.status,
        })
        if (updated) currentExpenses.splice(currentExpenses.findIndex((expense) => expense.id === updated.id), 1, updated)
        merged += 1
      } else {
        const input = buildLedgerExpenseFromCandidate(candidate, tripId, participants)
        const createdExpense = await createLedgerExpense({
          ...input,
          duplicateAcknowledged: match?.kind === 'heuristic' ? false : input.duplicateAcknowledged,
          reviewStatus: match?.kind === 'heuristic' ? 'needs_review' : input.reviewStatus,
          status: match?.kind === 'heuristic' ? 'draft' : input.status,
        })
        currentExpenses.push(createdExpense)
        created += 1
      }
      await db.ledgerArchiveQueue.update(queueId, { lastError: undefined, status: 'done', updatedAt: Date.now() })
    } catch (caught) {
      const record = await db.ledgerArchiveQueue.get(queueId)
      const attempts = (record?.attempts ?? 0) + 1
      await db.ledgerArchiveQueue.update(queueId, {
        attempts,
        lastError: caught instanceof Error ? caught.message.slice(0, 240) : '后台整理失败',
        nextAttemptAt: attempts < MAX_ATTEMPTS ? Date.now() + attempts * 30_000 : undefined,
        status: 'error',
        updatedAt: Date.now(),
      })
    }
  }
  return { created, merged, skipped }
}

async function queueCandidates(tripId: string, candidates: LedgerExpenseDraftCandidate[]) {
  const now = Date.now()
  for (const candidate of candidates) {
    const id = buildQueueId(tripId, candidate)
    const existing = await db.ledgerArchiveQueue.get(id)
    const fingerprint = candidate.source.fingerprint ?? candidate.sourceLink.id
    if (existing?.fingerprint === fingerprint && (existing.status === 'done' || existing.attempts >= MAX_ATTEMPTS || (existing.nextAttemptAt ?? 0) > now)) continue
    await db.ledgerArchiveQueue.put({
      attempts: existing?.attempts ?? 0,
      createdAt: existing?.createdAt ?? now,
      fingerprint,
      id,
      sourceKey: candidate.sourceLink.id,
      status: 'pending',
      tripId,
      updatedAt: now,
    })
  }
}

async function listProcessableCandidates(tripId: string, candidates: LedgerExpenseDraftCandidate[]) {
  const now = Date.now()
  const processable: LedgerExpenseDraftCandidate[] = []
  for (const candidate of candidates) {
    const record = await db.ledgerArchiveQueue.get(buildQueueId(tripId, candidate))
    if (!record) continue
    if (record.status === 'done') continue
    if (record.attempts >= MAX_ATTEMPTS) continue
    if (record.nextAttemptAt && record.nextAttemptAt > now) continue
    processable.push(candidate)
  }
  return processable
}

async function enrichCandidatesWithAi(
  candidates: LedgerExpenseDraftCandidate[],
  participants: Awaited<ReturnType<typeof listLedgerParticipants>>,
  defaultCurrency: string,
) {
  const unresolved = candidates.filter((candidate) => candidate.recognitionConfidence < 0.85 || candidate.amountMinor == null || candidate.category === 'other')
  if (unresolved.length === 0) return candidates
  const aliases = new Map(participants.map((participant, index) => [participant.id, `p${index + 1}`]))
  try {
    const response = await fetchProviderProxyAiExpenseExtract({
      candidates: unresolved.map((candidate) => ({ candidateId: candidate.sourceLink.id, text: sanitizeLedgerExtractionTextForAi(candidate.extractedText), title: candidate.title })),
      defaultCurrency,
      operation: 'ai_expense_extract',
      participants: participants.map((participant) => ({ alias: aliases.get(participant.id)!, displayName: participant.displayName })),
    }, getProviderProxyConfig().proxyUrl ?? '/api/provider-proxy')
    const participantByAlias = new Map([...aliases].map(([id, alias]) => [alias, id]))
    return candidates.map((candidate) => {
      const suggestion = response.suggestions.find((item) => item.candidateId === candidate.sourceLink.id)
      if (!suggestion) return candidate
      const currency = suggestion.currency ?? candidate.currency ?? defaultCurrency
      const amountMinor = suggestion.amount ? parseAiAmount(suggestion.amount, currency) : candidate.amountMinor
      const category = suggestion.category ?? candidate.category
      return {
        ...candidate,
        amountMinor,
        category,
        currency,
        payerParticipantId: suggestion.payerAlias ? participantByAlias.get(suggestion.payerAlias) : candidate.payerParticipantId,
        recognitionConfidence: calculateLedgerCandidateConfidence({
          amountMinor,
          category,
          currency,
          date: candidate.date,
          orderNumber: candidate.orderNumber,
          paymentStatus: candidate.paymentStatus,
        }),
      }
    })
  } catch {
    return candidates
  }
}

function parseAiAmount(value: string, currency: string) {
  const cleaned = value.trim().replace(/[^\d,.-]/g, '')
  const parsed = Number(cleaned.replace(/,/g, ''))
  if (!Number.isFinite(parsed) || parsed < 0) return undefined
  const digits = new Intl.NumberFormat('en', { currency, style: 'currency' }).resolvedOptions().maximumFractionDigits ?? 2
  return Math.round(parsed * 10 ** digits)
}

function buildQueueId(tripId: string, candidate: LedgerExpenseDraftCandidate) {
  return `${tripId}:${candidate.sourceLink.id}`
}
