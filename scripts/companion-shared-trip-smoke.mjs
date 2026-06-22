#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  persistSupabaseSmokeSession,
  restoreSupabaseSmokeSession,
} from './lib/supabase-smoke-session.mjs'

const DEFAULT_SMOKE_EMAIL = 'ysr182@qq.com'

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
const anonymous = createClient(url, anonKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
})

await authenticate()

const { data: userData, error: userError } = await supabase.auth.getUser()
if (userError || !userData.user) {
  fail('Companion smoke auth failed.')
}

const userId = userData.user.id
const now = Date.now()
const iso = new Date(now).toISOString()
const smokeId = `companion_smoke_${now}_${randomUUID().slice(0, 8)}`
const tripId = `trip_${smokeId}`
const dayId = `day_${smokeId}`
const itemId = `item_${smokeId}`
const ticketId = `ticket_${smokeId}`
const inviteToken = randomBytes(24).toString('base64url')
const tokenHash = createHash('sha256').update(inviteToken).digest('hex')
let sharedTripId = null

try {
  log('Publishing owner shared projection.')
  const sharedTrip = await assertOk(supabase
    .from('companion_shared_trips')
    .upsert({
      owner_id: userId,
      projection: buildProjection(),
      projection_updated_at: iso,
      title: 'TripMap companion smoke',
      trip_id: tripId,
    }, { onConflict: 'owner_id,trip_id' })
    .select('id, owner_id, trip_id, title, projection')
    .single(), 'shared projection upsert')
  sharedTripId = sharedTrip.data.id

  if (sharedTrip.data.projection?.ticketSummaries?.[0]?.fileName) {
    fail('Shared projection leaked ticket file name.')
  }

  log('Creating hashed invite.')
  const invite = await assertOk(supabase
    .from('companion_shared_invites')
    .insert({
      owner_id: userId,
      permission: 'comment',
      shared_trip_id: sharedTripId,
      token_hash: tokenHash,
    })
    .select('id, token_hash, permission, status')
    .single(), 'invite insert')

  if (invite.data.token_hash === inviteToken) {
    fail('Invite stored a raw token.')
  }
  if (invite.data.permission !== 'comment' || invite.data.status !== 'active') {
    fail('Invite row did not preserve permission/status.')
  }

  log('Checking anonymous RLS filters shared projection.')
  const anonymousRead = await anonymous
    .from('companion_shared_trips')
    .select('id')
    .eq('id', sharedTripId)
  if (anonymousRead.error) {
    fail('Anonymous shared trip select returned an error instead of an empty result.')
  }
  if ((anonymousRead.data ?? []).length !== 0) {
    fail('Anonymous user could read a shared trip.')
  }

  log('Checking anonymous write is denied.')
  const anonymousComment = await anonymous.rpc('companion_add_comment', {
    comment_body: 'anonymous should be denied',
    target_item_id: itemId,
    target_shared_trip_id: sharedTripId,
  })
  if (!anonymousComment.error) {
    fail('Anonymous user could write a companion comment.')
  }

  log('Claiming invite as owner and checking owner permission path.')
  const claim = await assertOk(supabase.rpc('companion_claim_invite', {
    companion_display_name: 'Companion smoke owner',
    invite_token_hash: tokenHash,
  }), 'owner invite claim')
  const claimRow = Array.isArray(claim.data) ? claim.data[0] : null
  if (!claimRow || claimRow.shared_trip_id !== sharedTripId || claimRow.permission !== 'collaborate') {
    fail('Owner invite claim did not return collaborate permission.')
  }

  log('Recording view, comment, meeting confirmation, and collaborator mutation.')
  await assertOk(supabase.rpc('companion_record_view', {
    target_shared_trip_id: sharedTripId,
  }), 'record view')
  await assertOk(supabase.rpc('companion_add_comment', {
    comment_body: 'Companion smoke comment',
    target_item_id: itemId,
    target_shared_trip_id: sharedTripId,
  }), 'owner comment rpc')
  await assertOk(supabase.rpc('companion_confirm_meeting', {
    confirmation_note: 'Smoke confirmation',
    target_item_id: itemId,
    target_shared_trip_id: sharedTripId,
  }), 'owner meeting confirmation rpc')
  await assertOk(supabase.rpc('companion_submit_mutation', {
    mutation_payload: {
      baselineUpdatedAt: now,
      itemId,
      patch: { title: 'Updated by companion smoke' },
    },
    target_mutation_type: 'update_item',
    target_shared_trip_id: sharedTripId,
  }), 'owner collaborator mutation rpc')

  log('Reading companion activity records.')
  const [comments, confirmations, mutations, activities] = await Promise.all([
    supabase.from('companion_shared_comments').select('id').eq('shared_trip_id', sharedTripId),
    supabase.from('companion_meeting_confirmations').select('item_id').eq('shared_trip_id', sharedTripId),
    supabase.from('companion_shared_mutations').select('id, status').eq('shared_trip_id', sharedTripId),
    supabase.from('companion_shared_activities').select('activity_type').eq('shared_trip_id', sharedTripId),
  ])
  for (const result of [comments, confirmations, mutations, activities]) {
    if (result.error) fail('Companion activity read failed.')
  }
  if ((comments.data ?? []).length < 1) fail('Expected at least one companion comment.')
  if ((confirmations.data ?? []).length < 1) fail('Expected at least one meeting confirmation.')
  if (!(mutations.data ?? []).some((row) => row.status === 'pending')) fail('Expected one pending collaborator mutation.')
  const activityTypes = new Set((activities.data ?? []).map((row) => row.activity_type))
  for (const expected of ['viewed', 'commented', 'confirmed_meeting', 'submitted_change']) {
    if (!activityTypes.has(expected)) fail(`Missing companion activity: ${expected}.`)
  }

  log('Companion shared-trip Supabase smoke passed.')
} finally {
  if (sharedTripId) {
    try {
      await supabase.from('companion_shared_trips').delete().eq('id', sharedTripId)
    } catch {
      // Best-effort cleanup. Do not print raw remote errors in shared terminals.
    }
  }
}

function buildProjection() {
  return {
    days: [{
      date: '2026-06-14',
      id: dayId,
      sortOrder: 1,
      title: 'Smoke day',
      tripId,
    }],
    items: [{
      dayId,
      id: itemId,
      sortOrder: 1,
      startTime: '09:00',
      ticketSummaryIds: [ticketId],
      title: 'Smoke meetup',
      tripId,
      updatedAt: now,
    }],
    publishedAt: iso,
    schemaVersion: 1,
    ticketSummaries: [{
      fileType: 'transport',
      id: ticketId,
      itemId,
      scope: 'item',
      storageMode: 'copy',
      ticketCategory: 'transport',
      title: 'Smoke ticket summary',
    }],
    trip: {
      createdAt: now,
      destination: 'Smoke',
      endDate: '2026-06-15',
      id: tripId,
      startDate: '2026-06-14',
      title: 'TripMap companion smoke',
      updatedAt: now,
    },
    warnings: [
      '共享视图不包含票据文件、加密旅行资料、云端同步状态、路线缓存或 provider 原始结果。',
    ],
  }
}

async function authenticate() {
  const accessToken = process.env.SUPABASE_COMPANION_SMOKE_ACCESS_TOKEN || process.env.SUPABASE_SMOKE_ACCESS_TOKEN
  const refreshToken = process.env.SUPABASE_COMPANION_SMOKE_REFRESH_TOKEN || process.env.SUPABASE_SMOKE_REFRESH_TOKEN
  const email = process.env.SUPABASE_COMPANION_SMOKE_EMAIL || process.env.SUPABASE_SMOKE_EMAIL || DEFAULT_SMOKE_EMAIL
  if (accessToken && refreshToken) {
    const { data, error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error || !data.session) fail('Companion smoke session token was rejected.')
    persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
    return
  }

  const cachedSession = await restoreSupabaseSmokeSession(supabase, { email, supabaseUrl: url })
  if (cachedSession) return

  const password = process.env.SUPABASE_COMPANION_SMOKE_PASSWORD || process.env.SUPABASE_SMOKE_PASSWORD
  if (email && password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) fail('Companion smoke email/password sign-in failed.')
    persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
    return
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) fail('Companion smoke OTP send failed.')
  const token = process.env.SUPABASE_COMPANION_SMOKE_OTP || process.env.SUPABASE_SMOKE_OTP || await promptOtp(email)
  const { data, error: verifyError } = await supabase.auth.verifyOtp({
    email,
    token: token.trim(),
    type: 'email',
  })
  if (verifyError || !data.session) fail('Companion smoke OTP verification failed.')
  persistSupabaseSmokeSession(data.session, { email, supabaseUrl: url })
}

async function promptOtp(email) {
  if (!process.stdin.isTTY) {
    fail('No smoke password/session token was configured and no TTY is available for OTP input.')
  }
  const rl = createInterface({ input, output })
  try {
    return await rl.question(`[companion-smoke] Enter the one-time email code sent to ${email}: `)
  } finally {
    rl.close()
  }
}

async function assertOk(resultPromise, label) {
  const result = await resultPromise
  if (result.error) {
    fail(`${label} failed.`)
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
  console.log(`[companion-smoke] ${message}`)
}

function fail(message) {
  console.error(`[companion-smoke] ${message}`)
  process.exit(1)
}
