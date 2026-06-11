import { Temporal } from '@js-temporal/polyfill'
import { db } from '../db/database'
import { createId } from '../db/ids'
import type { ReminderKind, ReminderSchedule, TransportSegment } from '../types'
import { isValidTimeZone } from './timeZone'

export async function scheduleDocumentExpiryReminder({
  daysBefore = 30,
  documentId,
  timeZone,
  validUntil,
  vaultId,
}: {
  daysBefore?: number
  documentId: string
  timeZone: string
  validUntil: string
  vaultId: string
}) {
  const zone = requireTimeZone(timeZone)
  const trigger = Temporal.ZonedDateTime.from(`${validUntil}T09:00[${zone}]`).subtract({ days: daysBefore })
  return saveReminder({
    kind: 'document_expiry',
    objectId: documentId,
    objectType: 'document',
    timeZone: zone,
    triggerAt: trigger.toInstant().toString(),
    vaultId,
  })
}

export async function scheduleTransportReminder({
  kind,
  minutesBefore,
  segment,
}: {
  kind: Extract<ReminderKind, 'check_in' | 'departure' | 'transfer'>
  minutesBefore: number
  segment: TransportSegment
}) {
  const zone = requireTimeZone(segment.departureTimeZone)
  const time = segment.departureTime ?? '09:00'
  const trigger = Temporal.ZonedDateTime.from(`${segment.departureDate}T${time}[${zone}]`).subtract({ minutes: minutesBefore })
  return saveReminder({
    kind,
    objectId: segment.bookingId,
    objectType: 'transport',
    timeZone: zone,
    triggerAt: trigger.toInstant().toString(),
    tripId: segment.tripId,
  })
}

export async function listPendingReminders(now = new Date()) {
  const pending = await db.reminderSchedules.where('status').equals('pending').toArray()
  return pending
    .filter((reminder) => Date.parse(reminder.triggerAt) <= now.getTime())
    .sort((left, right) => left.triggerAt.localeCompare(right.triggerAt))
}

export async function listUpcomingReminders(limit = 20) {
  const pending = await db.reminderSchedules.where('status').equals('pending').toArray()
  return pending.sort((left, right) => left.triggerAt.localeCompare(right.triggerAt)).slice(0, limit)
}

export async function markReminderSent(reminderId: string, sentAt = new Date().toISOString()) {
  await db.reminderSchedules.update(reminderId, { sentAt, status: 'sent', updatedAt: Date.now() })
}

export async function cancelRemindersForObject(objectId: string) {
  const reminders = await db.reminderSchedules.where('objectId').equals(objectId).toArray()
  await Promise.all(reminders.map((reminder) => db.reminderSchedules.update(reminder.id, { status: 'cancelled', updatedAt: Date.now() })))
}

export function buildGenericReminderCopy(kind: ReminderKind) {
  if (kind === 'document_expiry') return { title: '旅行证件提醒', body: '你有一项旅行证件需要检查。' }
  if (kind === 'check_in') return { title: '值机提醒', body: '你有一段大交通订单即将开放或需要办理值机。' }
  if (kind === 'transfer') return { title: '换乘提醒', body: '你有一段换乘安排即将开始。' }
  return { title: '出发提醒', body: '你有一段大交通行程即将出发。' }
}

async function saveReminder(input: Omit<ReminderSchedule, 'id' | 'occurrenceId' | 'status' | 'createdAt' | 'updatedAt'>) {
  const now = Date.now()
  const occurrenceId = [input.kind, input.objectId, input.triggerAt].join(':')
  const existing = await db.reminderSchedules.where('occurrenceId').equals(occurrenceId).first()
  if (existing) return existing
  const reminder: ReminderSchedule = {
    ...input,
    createdAt: now,
    id: createId('reminder'),
    occurrenceId,
    status: 'pending',
    updatedAt: now,
  }
  await db.reminderSchedules.add(reminder)
  return reminder
}

function requireTimeZone(timeZone: string) {
  if (!isValidTimeZone(timeZone)) throw new Error('提醒时区不是有效的 IANA 时区。')
  return timeZone
}
