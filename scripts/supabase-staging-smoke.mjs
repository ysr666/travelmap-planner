#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  persistSupabaseSmokeSession,
  restoreSupabaseSmokeSession,
} from './lib/supabase-smoke-session.mjs'

loadEnvFile('.env.local')
loadEnvFile('.dev.vars')

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  fail('Missing VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY or SUPABASE_URL/SUPABASE_ANON_KEY.')
}

const supabase = createClient(url, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

await authenticate()

const { data: userData, error: userError } = await supabase.auth.getUser()
if (userError || !userData.user) {
  fail('Supabase smoke auth failed.')
}

const userId = userData.user.id
const now = Date.now()
const iso = new Date(now).toISOString()
const smokeId = `smoke_${now}_${randomUUID().slice(0, 8)}`
const tripId = `trip_${smokeId}`
const dayId = `day_${smokeId}`
const itemId = `item_${smokeId}`
const ticketId = `ticket_${smokeId}`
const ledgerSettingsId = `ledger_settings_${smokeId}`
const ledgerParticipantId = `ledger_person_${smokeId}`
const ledgerBudgetId = `ledger_budget_${smokeId}`
const ledgerExpenseId = `ledger_expense_${smokeId}`
const backupId = randomUUID()
const snapshotPath = `${userId}/${backupId}/snapshot.json`
const ticketPath = `${userId}/objects/${tripId}/tickets/${ticketId}/smoke-${smokeId}.txt`

const cleanup = []

try {
  log('Checking cloud_trip_backups RLS and Storage snapshot path.')
  await assertOk(supabase.storage.from('trip-backups').upload(snapshotPath, new Blob(['{}'], { type: 'application/json' }), {
    contentType: 'application/json',
    upsert: true,
  }), 'snapshot upload')
  cleanup.push(() => supabase.storage.from('trip-backups').remove([snapshotPath]))

  await assertOk(supabase.from('cloud_trip_backups').upsert({
    app_version: 'smoke',
    destination: 'Smoke',
    exported_at: iso,
    files_count: 0,
    id: backupId,
    notes: 'TripMap Supabase staging smoke',
    original_trip_id: tripId,
    schema_version: 1,
    snapshot_path: snapshotPath,
    title: 'TripMap smoke',
    total_size_bytes: 0,
    user_id: userId,
    warnings: [],
  }), 'cloud_trip_backups upsert')
  cleanup.push(() => supabase.from('cloud_trip_backups').delete().eq('id', backupId))

  const backupRead = await supabase.from('cloud_trip_backups').select('id').eq('id', backupId).single()
  await assertOk(backupRead, 'cloud_trip_backups select')

  log('Checking cloud_sync_objects incremental object rows.')
  await assertOk(supabase.from('cloud_sync_objects').upsert([
    {
      device_id: 'smoke-device',
      object_id: tripId,
      object_type: 'trip',
      op_id: `op_${smokeId}_trip`,
      payload: {
        createdAt: now,
        destination: 'Smoke',
        endDate: '2026-01-01',
        id: tripId,
        startDate: '2026-01-01',
        title: 'TripMap smoke',
        updatedAt: now,
      },
      trip_id: tripId,
      updated_at_ms: now,
      user_id: userId,
    },
    {
      device_id: 'smoke-device',
      object_id: dayId,
      object_type: 'day',
      op_id: `op_${smokeId}_day`,
      payload: {
        date: '2026-01-01',
        id: dayId,
        sortOrder: 1,
        title: 'Smoke day',
        tripId,
      },
      trip_id: tripId,
      updated_at_ms: now,
      user_id: userId,
    },
    {
      device_id: 'smoke-device',
      object_id: itemId,
      object_type: 'item',
      op_id: `op_${smokeId}_item`,
      payload: {
        createdAt: now,
        dayId,
        id: itemId,
        sortOrder: 1,
        ticketIds: [ticketId],
        title: 'Smoke item',
        tripId,
        updatedAt: now,
      },
      trip_id: tripId,
      updated_at_ms: now,
      user_id: userId,
    },
    {
      device_id: 'smoke-device',
      object_id: ticketId,
      object_type: 'ticket_meta',
      op_id: `op_${smokeId}_ticket`,
      payload: {
        createdAt: now,
        fileName: 'smoke.txt',
        fileType: 'other',
        id: ticketId,
        itemId,
        mimeType: 'text/plain',
        size: 5,
        storageMode: 'copy',
        title: 'Smoke ticket',
        tripId,
        updatedAt: now,
      },
      trip_id: tripId,
      updated_at_ms: now,
      user_id: userId,
    },
    {
      device_id: 'smoke-device', object_id: ledgerSettingsId, object_type: 'ledger_settings', op_id: `op_${smokeId}_ledger_settings`,
      payload: { createdAt: now, homeCurrency: 'CNY', id: ledgerSettingsId, settlementCurrency: 'CNY', tripCurrency: 'JPY', tripId, updatedAt: now },
      trip_id: tripId, updated_at_ms: now, user_id: userId,
    },
    {
      device_id: 'smoke-device', object_id: ledgerParticipantId, object_type: 'ledger_participant', op_id: `op_${smokeId}_ledger_participant`,
      payload: { createdAt: now, displayName: 'Smoke owner', id: ledgerParticipantId, isSelf: true, source: 'manual', tripId, updatedAt: now },
      trip_id: tripId, updated_at_ms: now, user_id: userId,
    },
    {
      device_id: 'smoke-device', object_id: ledgerBudgetId, object_type: 'ledger_budget', op_id: `op_${smokeId}_ledger_budget`,
      payload: { amountMinor: 100000, createdAt: now, currency: 'JPY', id: ledgerBudgetId, scope: 'trip', tripId, updatedAt: now },
      trip_id: tripId, updated_at_ms: now, user_id: userId,
    },
    {
      device_id: 'smoke-device', object_id: ledgerExpenseId, object_type: 'ledger_expense', op_id: `op_${smokeId}_ledger_expense`,
      payload: { amountMinor: 1200, category: 'food', createdAt: now, currency: 'JPY', date: '2026-01-01', id: ledgerExpenseId, payerParticipantId: ledgerParticipantId, source: { kind: 'manual' }, splitMode: 'equal', splitShares: [{ participantId: ledgerParticipantId, weight: 1 }], status: 'confirmed', title: 'Smoke expense', tripId, updatedAt: now },
      trip_id: tripId, updated_at_ms: now, user_id: userId,
    },
  ]), 'cloud_sync_objects upsert')
  cleanup.push(() => supabase.from('cloud_sync_objects').delete().eq('trip_id', tripId))

  const objectsRead = await supabase.from('cloud_sync_objects').select('object_type').eq('trip_id', tripId)
  await assertOk(objectsRead, 'cloud_sync_objects select')
  if ((objectsRead.data ?? []).length !== 8) {
    fail(`Expected 8 object rows, got ${(objectsRead.data ?? []).length}.`)
  }

  log('Checking ticket blob Storage path and cloud_ticket_blobs RLS.')
  await assertOk(supabase.storage.from('trip-backups').upload(ticketPath, new Blob(['smoke'], { type: 'text/plain' }), {
    contentType: 'text/plain',
    upsert: true,
  }), 'ticket blob upload')
  cleanup.push(() => supabase.storage.from('trip-backups').remove([ticketPath]))

  await assertOk(supabase.from('cloud_ticket_blobs').upsert({
    file_name: 'smoke.txt',
    mime_type: 'text/plain',
    sha256: 'smoke-sha256',
    size: 5,
    storage_path: ticketPath,
    ticket_id: ticketId,
    trip_id: tripId,
    uploaded_at: iso,
    user_id: userId,
  }), 'cloud_ticket_blobs upsert')
  cleanup.push(() => supabase.from('cloud_ticket_blobs').delete().eq('ticket_id', ticketId))

  const ticketBlobRead = await supabase.from('cloud_ticket_blobs').select('ticket_id, storage_path').eq('ticket_id', ticketId).single()
  await assertOk(ticketBlobRead, 'cloud_ticket_blobs select')

  const download = await supabase.storage.from('trip-backups').download(ticketPath)
  await assertOk(download, 'ticket blob download')
  const text = await download.data.text()
  if (text !== 'smoke') {
    fail('Ticket blob download content mismatch.')
  }

  log('Supabase staging smoke passed.')
} finally {
  for (const runCleanup of cleanup.reverse()) {
    try {
      await runCleanup()
    } catch {
      // Best-effort cleanup. Avoid printing provider/raw errors because this script is often run in shared terminals.
    }
  }
}

async function authenticate() {
  const accessToken = process.env.SUPABASE_SMOKE_ACCESS_TOKEN
  const refreshToken = process.env.SUPABASE_SMOKE_REFRESH_TOKEN
  const email = process.env.SUPABASE_SMOKE_EMAIL
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error || !data.session) fail('Supabase smoke session token was rejected.')
    if (email) persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
    return
  }

  if (email) {
    const cachedSession = await restoreSupabaseSmokeSession(supabase, { email, supabaseUrl: url })
    if (cachedSession) return
  }

  const password = process.env.SUPABASE_SMOKE_PASSWORD
  if (email && password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) fail('Supabase smoke email/password sign-in failed.')
    persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
    return
  }

  if (email) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    if (error) fail('Supabase smoke OTP send failed.')
    const token = process.env.SUPABASE_SMOKE_OTP || await promptOtp(email)
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: token.trim(),
      type: 'email',
    })
    if (verifyError || !data.session) fail('Supabase smoke OTP verification failed.')
    persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
    return
  }

  fail([
    'Missing smoke auth.',
    'Set either SUPABASE_SMOKE_ACCESS_TOKEN + SUPABASE_SMOKE_REFRESH_TOKEN,',
    'SUPABASE_SMOKE_EMAIL + SUPABASE_SMOKE_PASSWORD,',
    'or SUPABASE_SMOKE_EMAIL for an interactive email OTP flow.',
  ].join(' '))
}

async function promptOtp(email) {
  if (!process.stdin.isTTY) {
    fail('SUPABASE_SMOKE_EMAIL was set but no TTY is available for OTP input. Set SUPABASE_SMOKE_OTP.')
  }
  const rl = createInterface({ input, output })
  try {
    return await rl.question(`[supabase-smoke] Enter the one-time email code sent to ${email}: `)
  } finally {
    rl.close()
  }
}

async function assertOk(resultPromise, label) {
  const result = await resultPromise
  if (result.error) {
    fail(`${label} failed: ${result.error.message}`)
  }
  return result
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function log(message) {
  console.log(`[supabase-smoke] ${message}`)
}

function fail(message) {
  console.error(`[supabase-smoke] ${message}`)
  process.exit(1)
}
