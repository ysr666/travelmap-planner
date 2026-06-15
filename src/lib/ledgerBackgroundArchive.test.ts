import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createLedgerParticipant, createLedgerSettings, createTrip, db, listLedgerExpenses } from '../db'
import { buildLedgerExpenseDraftCandidates } from './ledgerExtraction'
import { runLedgerArchiveForTrip } from './ledgerBackgroundArchive'

beforeEach(async () => {
  db.close()
  await db.delete()
  await db.open()
})

describe('ledger background archive queue', () => {
  it('does not process a source after three failed attempts until its fingerprint changes', async () => {
    const trip = await createTrip({ destination: '东京', endDate: '2026-06-02', startDate: '2026-06-01', title: '东京' })
    await createLedgerSettings({ homeCurrency: 'CNY', settlementCurrency: 'CNY', tripCurrency: 'CNY', tripId: trip.id })
    const participant = await createLedgerParticipant({ displayName: '我', isSelf: true, tripId: trip.id })
    const now = Date.now()
    const entry = {
      category: 'ticket' as const,
      createdAt: now,
      extractedText: '酒店支付成功 总计 CNY 100.00 付款人 我',
      id: 'inbox-retry-limit',
      label: '酒店付款',
      sourceKind: 'pasted_text' as const,
      status: 'ready' as const,
      tripId: trip.id,
      updatedAt: now,
      warnings: [],
    }
    await db.travelInboxEntries.put(entry)
    const candidate = buildLedgerExpenseDraftCandidates({
      bookings: [],
      days: [],
      existingExpenses: [],
      inboxEntries: [entry],
      items: [],
      participants: [participant],
      tickets: [],
      tripCurrency: 'CNY',
      tripStartDate: trip.startDate,
    })[0]
    await db.ledgerArchiveQueue.put({
      attempts: 3,
      createdAt: now,
      fingerprint: candidate.source.fingerprint!,
      id: `${trip.id}:${candidate.sourceLink.id}`,
      lastError: 'provider failed',
      sourceKey: candidate.sourceLink.id,
      status: 'error',
      tripId: trip.id,
      updatedAt: now,
    })

    await expect(runLedgerArchiveForTrip(trip.id)).resolves.toEqual({ created: 0, merged: 0, skipped: 0 })
    await expect(listLedgerExpenses(trip.id)).resolves.toEqual([])
    await expect(db.ledgerArchiveQueue.get(`${trip.id}:${candidate.sourceLink.id}`)).resolves.toMatchObject({ attempts: 3, status: 'error' })
  })
})
