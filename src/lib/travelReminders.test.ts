import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../db/database'
import type { TransportSegment } from '../types'
import { scheduleDocumentExpiryReminder, scheduleTransportReminder } from './travelReminders'

describe('travel reminder scheduling', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  it('schedules document expiry in the selected local time zone', async () => {
    const reminder = await scheduleDocumentExpiryReminder({ daysBefore: 30, documentId: 'document-1', timeZone: 'Europe/London', validUntil: '2026-11-15', vaultId: 'vault-1' })
    expect(reminder.triggerAt).toBe('2026-10-16T08:00:00Z')
    expect(reminder.timeZone).toBe('Europe/London')
  })

  it('converts a DST-boundary flight departure into a real instant', async () => {
    const segment: TransportSegment = {
      arrivalDate: '2026-03-29', arrivalPlace: 'Paris', arrivalTime: '10:30', arrivalTimeZone: 'Europe/Paris', bookingId: 'booking-1', createdAt: 1,
      departureDate: '2026-03-29', departurePlace: 'London', departureTime: '08:30', departureTimeZone: 'Europe/London', id: 'segment-1', kind: 'flight', sortOrder: 0,
      status: 'scheduled', tripId: 'trip-1', updatedAt: 1,
    }
    const reminder = await scheduleTransportReminder({ kind: 'departure', minutesBefore: 120, segment })
    expect(reminder.triggerAt).toBe('2026-03-29T05:30:00Z')
  })
})
