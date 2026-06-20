#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'
import { chromium } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import tls from 'node:tls'

const DEFAULT_APP_URL = 'https://travelmap-planner.pages.dev'
const DEVICE_ID_KEY = 'tripmap:object-sync:device-id'

loadEnvFile('.env.local')
loadEnvFile('.dev.vars')
loadEnvFile('/Users/ysradmin/.codex/secrets/tripmap-smoke.env')

const appUrl = process.env.TRIPMAP_SMOKE_APP_URL || DEFAULT_APP_URL
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const email = process.env.SUPABASE_SMOKE_EMAIL || 'ysr182@qq.com'

if (!supabaseUrl || !anonKey) fail('Supabase smoke configuration is missing.')

const supabase = createClient(supabaseUrl, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const smokeId = `intelligence_smoke_${Date.now()}_${randomUUID().slice(0, 8)}`
const tripId = `trip_${smokeId}`
const dayId = `day_${smokeId}`
const itemId = `item_${smokeId}`
let browser
let contextA
let contextB

try {
  log('Authenticating the production smoke account.')
  const session = await authenticate(email)
  const authStorageKey = buildAuthStorageKey(supabaseUrl)
  browser = await chromium.launch({ headless: true })
  contextA = await createDeviceContext(browser, authStorageKey, session, `device-a-${smokeId}`)
  contextB = await createDeviceContext(browser, authStorageKey, session, `device-b-${smokeId}`)

  const pageA = await contextA.newPage()
  await pageA.goto(`${appUrl}/#/home`, { waitUntil: 'domcontentloaded' })
  await seedDeviceA(pageA)
  await pageA.goto(`${appUrl}/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })

  const activeSuggestion = pageA.locator('[data-testid="trip-intelligence-suggestion"][data-source="operations"]')
    .filter({ has: pageA.getByRole('button', { name: /忽略建议/ }) })
    .first()
  await activeSuggestion.waitFor({ state: 'visible', timeout: 15_000 })
  const ignoredTitle = ((await activeSuggestion.locator('p').first().textContent()) || '').trim()
  await activeSuggestion.getByRole('button', { name: /忽略建议/ }).click()
  await waitFor(async () => (await readIntelligenceRecords(pageA)).states.length > 0, 'Device A suggestion state')

  await pageA.goto(`${appUrl}/#/day?tripId=${tripId}&dayId=${dayId}&view=schedule`, { waitUntil: 'domcontentloaded' })
  const liveCard = pageA.getByTestId('trip-live-mode-card')
  await liveCard.waitFor({ state: 'visible', timeout: 15_000 })
  await liveCard.getByRole('button', { name: '已完成' }).click()
  await waitFor(async () => (await readIntelligenceRecords(pageA)).changes.length > 0, 'Device A applied change')

  log('Syncing Device A intelligence state and history.')
  await syncCurrentTrip(pageA)
  const recordsA = await readIntelligenceRecords(pageA)
  const stateId = recordsA.states[0]?.id
  if (!stateId || recordsA.changes.length === 0) fail('Device A did not persist intelligence records.')
  await assertRemoteRowsPresent()

  log('Restoring the same trip into a fresh Device B IndexedDB.')
  const pageB = await contextB.newPage()
  await pageB.goto(`${appUrl}/#/settings?section=cloud`, { waitUntil: 'domcontentloaded' })
  const backupGroup = pageB.getByTestId('cloud-backup-group').filter({ hasText: `TripMap Intelligence Smoke ${smokeId}` })
  await backupGroup.waitFor({ state: 'visible', timeout: 20_000 })
  await backupGroup.getByTestId('cloud-restore-backup').click()
  const restoreDialog = pageB.getByTestId('cloud-save-confirm-dialog')
  await restoreDialog.waitFor({ state: 'visible' })
  await restoreDialog.getByRole('button', { name: '同步账号数据到此设备' }).click()
  await pageB.waitForURL(new RegExp(`#\/trip\?tripId=${tripId}`), { timeout: 30_000 })

  const recordsB = await readIntelligenceRecords(pageB)
  if (!recordsB.states.some((record) => record.id === stateId)) fail('Device B did not restore the ignored suggestion state.')
  if (recordsB.changes.length === 0) fail('Device B did not restore applied history.')
  const activeText = await pageB.locator('[data-testid="trip-intelligence-suggestion"]').allTextContents()
  if (ignoredTitle && activeText.some((text) => text.includes(ignoredTitle))) {
    fail('Device B repeated an ignored suggestion.')
  }
  const completedSummary = pageB.locator('summary').filter({ hasText: '完成了什么' })
  await completedSummary.click()
  await pageB.getByTestId('trip-operations-history').getByText('标记完成', { exact: false }).waitFor({ state: 'visible' })

  log('Verifying latest-updated suggestion state wins across devices.')
  const laterUpdatedAt = Date.now() + 5_000
  await setLatestSuggestionState(pageB, stateId, laterUpdatedAt)
  await syncCurrentTrip(pageB)
  const latestRemote = await readRemoteObject('trip_intelligence_suggestion_state', stateId)
  if (latestRemote?.payload?.status !== 'later' || latestRemote.updated_at_ms !== laterUpdatedAt) {
    fail('Remote suggestion state did not keep the latest update.')
  }
  await syncCurrentTrip(pageA)
  const latestA = (await readIntelligenceRecords(pageA)).states.find((record) => record.id === stateId)
  if (latestA?.status !== 'later' || latestA.updatedAt !== laterUpdatedAt) {
    fail('Device A did not receive Device B latest-wins state.')
  }

  log('Verifying intelligence delete tombstones propagate back to Device A.')
  const deletedIds = await enqueueIntelligenceDeletes(pageB)
  await syncCurrentTrip(pageB)
  for (const entry of deletedIds) {
    const remote = await readRemoteObject(entry.objectType, entry.objectId)
    if (!remote?.deleted_at_ms) fail('An intelligence delete tombstone was not uploaded.')
  }
  await syncCurrentTrip(pageA)
  const deletedA = await readIntelligenceRecords(pageA)
  if (deletedA.states.length !== 0 || deletedA.changes.length !== 0) {
    fail('Device A restored intelligence records after remote deletion.')
  }

  log('Production two-device intelligence smoke passed.')
} finally {
  await cleanupRemoteSmoke()
  await contextB?.close().catch(() => undefined)
  await contextA?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
}

async function authenticate(targetEmail) {
  const password = process.env.SUPABASE_SMOKE_PASSWORD
  if (password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: targetEmail, password })
    if (error || !data.session) fail('Supabase smoke password sign-in failed.')
    return data.session
  }

  const sentAt = Date.now()
  const { error } = await supabase.auth.signInWithOtp({
    email: targetEmail,
    options: { shouldCreateUser: false },
  })
  if (error) fail('Supabase smoke OTP send failed.')
  const token = process.env.SUPABASE_SMOKE_OTP || await readLatestOtpFromImap(sentAt)
  const verified = await supabase.auth.verifyOtp({ email: targetEmail, token, type: 'email' })
  if (verified.error || !verified.data.session) fail('Supabase smoke OTP verification failed.')
  return verified.data.session
}

async function createDeviceContext(targetBrowser, authStorageKey, session, deviceId) {
  const context = await targetBrowser.newContext({ viewport: { height: 844, width: 390 } })
  await context.addInitScript(({ authStorageKey: key, deviceId: nextDeviceId, session: nextSession }) => {
    window.localStorage.setItem(key, JSON.stringify(nextSession))
    window.localStorage.setItem('tripmap:object-sync:device-id', nextDeviceId)
    window.localStorage.setItem('tripmap:cloud-auto-snapshot:enabled', '0')
  }, { authStorageKey, deviceId, session })
  return context
}

async function seedDeviceA(page) {
  await page.evaluate(async ({ dayId: targetDayId, deviceIdKey, itemId: targetItemId, smokeId: targetSmokeId, tripId: targetTripId }) => {
    const db = await openDatabase()
    const now = Date.now()
    const date = formatDate(new Date())
    const nextTime = new Date(now + 30 * 60 * 1000)
    const startTime = `${String(nextTime.getHours()).padStart(2, '0')}:${String(nextTime.getMinutes()).padStart(2, '0')}`
    const trip = {
      createdAt: now,
      destination: 'Production Smoke',
      endDate: date,
      id: targetTripId,
      startDate: date,
      title: `TripMap Intelligence Smoke ${targetSmokeId}`,
      updatedAt: now,
    }
    const day = { date, id: targetDayId, sortOrder: 1, title: 'Smoke Day', tripId: targetTripId }
    const item = {
      createdAt: now,
      dayId: targetDayId,
      id: targetItemId,
      sortOrder: 1,
      startTime,
      ticketIds: [],
      title: 'Smoke Live Item',
      tripId: targetTripId,
      updatedAt: now,
    }
    const deviceId = window.localStorage.getItem(deviceIdKey) || 'device-a-smoke'
    const transaction = db.transaction(['trips', 'days', 'itineraryItems', 'syncOutbox', 'objectSyncStates'], 'readwrite')
    transaction.objectStore('trips').put(trip)
    transaction.objectStore('days').put(day)
    transaction.objectStore('itineraryItems').put(item)
    for (const [objectType, object] of [['trip', trip], ['day', day], ['item', item]]) {
      const objectId = object.id
      const objectKey = `${objectType}:${objectId}`
      transaction.objectStore('syncOutbox').put({
        attempts: 0,
        createdAt: now,
        deviceId,
        id: `outbox-${objectType}-${targetSmokeId}`,
        objectId,
        objectKey,
        objectType,
        opId: `op-${objectType}-${targetSmokeId}`,
        operation: 'upsert',
        payload: object,
        status: 'pending',
        tripId: targetTripId,
        updatedAt: now,
        updatedAtMs: objectType === 'day' ? now : object.updatedAt,
      })
      transaction.objectStore('objectSyncStates').put({
        localUpdatedAtMs: objectType === 'day' ? now : object.updatedAt,
        objectId,
        objectKey,
        objectType,
        tripId: targetTripId,
      })
    }
    await completeTransaction(transaction)
    db.close()

    function formatDate(value) {
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    }
    function openDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('TravelConsoleDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    function completeTransaction(target) {
      return new Promise((resolve, reject) => {
        target.oncomplete = () => resolve()
        target.onerror = () => reject(target.error)
        target.onabort = () => reject(target.error)
      })
    }
  }, { dayId, deviceIdKey: DEVICE_ID_KEY, itemId, smokeId, tripId })
}

async function syncCurrentTrip(page) {
  await page.goto(`${appUrl}/#/trip?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  const syncDetails = page.locator('#trip-sync-archive-section details')
  if (!(await syncDetails.getAttribute('open'))) await syncDetails.locator('summary').click()
  const upload = page.getByTestId('cloud-upload-current-trip')
  await upload.waitFor({ state: 'visible', timeout: 20_000 })
  await upload.click()
  const dialog = page.getByTestId('cloud-save-confirm-dialog')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '立即同步' }).click()
  await page.getByText('此设备版本已同步到账号。', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
}

async function readIntelligenceRecords(page) {
  return page.evaluate(async (targetTripId) => {
    const db = await openDatabase()
    const [changes, states] = await Promise.all([
      getAllByIndex(db, 'tripIntelligenceAppliedChanges', 'tripId', targetTripId),
      getAllByIndex(db, 'tripIntelligenceSuggestionStates', 'tripId', targetTripId),
    ])
    db.close()
    return { changes, states }

    function openDatabase() {
      return new Promise((resolve, reject) => {
        const request = indexedDB.open('TravelConsoleDB')
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    function getAllByIndex(db, store, index, value) {
      return new Promise((resolve, reject) => {
        const request = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
  }, tripId)
}

async function setLatestSuggestionState(page, stateId, updatedAt) {
  await page.evaluate(async ({ stateId: targetStateId, tripId: targetTripId, updatedAt: targetUpdatedAt }) => {
    const db = await openDatabase()
    const read = db.transaction('tripIntelligenceSuggestionStates', 'readonly').objectStore('tripIntelligenceSuggestionStates').get(targetStateId)
    const state = await requestResult(read)
    if (!state) throw new Error('suggestion state missing')
    const next = { ...state, status: 'later', until: targetUpdatedAt + 86_400_000, updatedAt: targetUpdatedAt }
    const deviceId = window.localStorage.getItem('tripmap:object-sync:device-id') || 'device-b-smoke'
    const objectKey = `trip_intelligence_suggestion_state:${targetStateId}`
    const transaction = db.transaction(['tripIntelligenceSuggestionStates', 'syncOutbox', 'objectSyncStates'], 'readwrite')
    transaction.objectStore('tripIntelligenceSuggestionStates').put(next)
    transaction.objectStore('syncOutbox').put({
      attempts: 0, createdAt: targetUpdatedAt, deviceId, id: `outbox-later-${targetStateId}`,
      objectId: targetStateId, objectKey, objectType: 'trip_intelligence_suggestion_state',
      opId: `op-later-${targetStateId}`, operation: 'upsert', payload: next, status: 'pending',
      tripId: targetTripId, updatedAt: targetUpdatedAt, updatedAtMs: targetUpdatedAt,
    })
    transaction.objectStore('objectSyncStates').put({
      ...await requestResult(transaction.objectStore('objectSyncStates').get(objectKey)),
      localUpdatedAtMs: targetUpdatedAt, objectId: targetStateId, objectKey,
      objectType: 'trip_intelligence_suggestion_state', tripId: targetTripId,
    })
    await completeTransaction(transaction)
    db.close()

    function openDatabase() { return new Promise((resolve, reject) => { const request = indexedDB.open('TravelConsoleDB'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    function completeTransaction(target) { return new Promise((resolve, reject) => { target.oncomplete = () => resolve(); target.onerror = () => reject(target.error); target.onabort = () => reject(target.error) }) }
  }, { stateId, tripId, updatedAt })
}

async function enqueueIntelligenceDeletes(page) {
  return page.evaluate(async (targetTripId) => {
    const db = await openDatabase()
    const [changes, states] = await Promise.all([
      getAllByIndex(db, 'tripIntelligenceAppliedChanges', 'tripId', targetTripId),
      getAllByIndex(db, 'tripIntelligenceSuggestionStates', 'tripId', targetTripId),
    ])
    const deletedAtMs = Date.now() + 10_000
    const deviceId = window.localStorage.getItem('tripmap:object-sync:device-id') || 'device-b-smoke'
    const entries = [
      ...changes.map((record) => ({ objectId: record.id, objectType: 'trip_intelligence_applied_change' })),
      ...states.map((record) => ({ objectId: record.id, objectType: 'trip_intelligence_suggestion_state' })),
    ]
    const transaction = db.transaction(['tripIntelligenceAppliedChanges', 'tripIntelligenceSuggestionStates', 'syncOutbox', 'objectSyncStates'], 'readwrite')
    for (const record of changes) transaction.objectStore('tripIntelligenceAppliedChanges').delete(record.id)
    for (const record of states) transaction.objectStore('tripIntelligenceSuggestionStates').delete(record.id)
    for (const entry of entries) {
      const objectKey = `${entry.objectType}:${entry.objectId}`
      transaction.objectStore('syncOutbox').put({
        attempts: 0, createdAt: deletedAtMs, deletedAtMs, deviceId,
        id: `outbox-delete-${entry.objectId}`, objectId: entry.objectId, objectKey,
        objectType: entry.objectType, opId: `op-delete-${entry.objectId}`, operation: 'delete',
        status: 'pending', tripId: targetTripId, updatedAt: deletedAtMs, updatedAtMs: deletedAtMs,
      })
      transaction.objectStore('objectSyncStates').put({
        localDeletedAtMs: deletedAtMs, objectId: entry.objectId, objectKey,
        objectType: entry.objectType, tripId: targetTripId,
      })
    }
    await completeTransaction(transaction)
    db.close()
    return entries

    function openDatabase() { return new Promise((resolve, reject) => { const request = indexedDB.open('TravelConsoleDB'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    function getAllByIndex(db, store, index, value) { return new Promise((resolve, reject) => { const request = db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) }
    function completeTransaction(target) { return new Promise((resolve, reject) => { target.oncomplete = () => resolve(); target.onerror = () => reject(target.error); target.onabort = () => reject(target.error) }) }
  }, tripId)
}

async function assertRemoteRowsPresent() {
  const { data, error } = await supabase.from('cloud_sync_objects')
    .select('object_type, deleted_at_ms')
    .eq('trip_id', tripId)
    .in('object_type', ['trip_intelligence_applied_change', 'trip_intelligence_suggestion_state'])
  if (error) fail('Unable to read remote intelligence rows.')
  const types = new Set((data || []).filter((row) => !row.deleted_at_ms).map((row) => row.object_type))
  if (!types.has('trip_intelligence_applied_change') || !types.has('trip_intelligence_suggestion_state')) {
    fail('Production sync is missing an intelligence object type.')
  }
}

async function readRemoteObject(objectType, objectId) {
  const { data, error } = await supabase.from('cloud_sync_objects')
    .select('payload, updated_at_ms, deleted_at_ms')
    .eq('object_type', objectType)
    .eq('object_id', objectId)
    .maybeSingle()
  if (error) fail('Unable to read a remote intelligence object.')
  return data
}

async function cleanupRemoteSmoke() {
  try {
    const backups = await supabase.from('cloud_trip_backups')
      .select('id, snapshot_path')
      .eq('original_trip_id', tripId)
    if (!backups.error) {
      const paths = (backups.data || []).map((backup) => backup.snapshot_path).filter(Boolean)
      if (paths.length > 0) await supabase.storage.from('trip-backups').remove(paths)
      await supabase.from('cloud_trip_backups').delete().eq('original_trip_id', tripId)
    }
    await supabase.from('cloud_sync_objects').delete().eq('trip_id', tripId)
  } catch {
    // Best-effort cleanup; never print remote payloads or credentials.
  }
}

async function readLatestOtpFromImap(sentAt) {
  const host = process.env.QA_EMAIL_IMAP_HOST
  const port = Number(process.env.QA_EMAIL_IMAP_PORT || 993)
  const username = process.env.QA_EMAIL || email
  const password = process.env.QA_EMAIL_IMAP_PASSWORD
  if (!host || !username || !password) fail('External mailbox credentials are missing.')

  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const otp = await findOtpOnce({ host, password, port, sentAt, username }).catch(() => null)
    if (otp) return otp
    await new Promise((resolve) => setTimeout(resolve, 4_000))
  }
  fail('Timed out waiting for the Supabase OTP email.')
}

async function findOtpOnce({ host, password, port, sentAt, username }) {
  const client = await ImapClient.connect({ host, port })
  try {
    await client.command(`LOGIN ${quoteImap(username)} ${quoteImap(password)}`)
    await client.command('SELECT INBOX')
    const search = await client.command('SEARCH ALL')
    const ids = parseSearchIds(search).slice(-20).reverse()
    for (const id of ids) {
      const raw = await client.command(`FETCH ${id} (BODY.PEEK[] INTERNALDATE)`)
      if (!/supabase|验证码|verification|confirm/i.test(raw)) continue
      const date = parseMessageDate(raw)
      if (date && date < sentAt - 120_000) continue
      const token = extractOtp(raw)
      if (token) return token
    }
    return null
  } finally {
    await client.close()
  }
}

class ImapClient {
  constructor(socket) {
    this.socket = socket
    this.buffer = ''
    this.sequence = 0
  }

  static connect(options) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: options.host, port: options.port, servername: options.host }, () => {
        const client = new ImapClient(socket)
        client.waitForGreeting().then(() => resolve(client), reject)
      })
      socket.once('error', reject)
    })
  }

  waitForGreeting() {
    return this.readUntil((value) => /^\* (?:OK|PREAUTH)/m.test(value))
  }

  async command(command) {
    const tag = `A${String(++this.sequence).padStart(4, '0')}`
    this.socket.write(`${tag} ${command}\r\n`)
    const response = await this.readUntil((value) => new RegExp(`^${tag} (?:OK|NO|BAD)`, 'm').test(value))
    if (!new RegExp(`^${tag} OK`, 'm').test(response)) throw new Error('IMAP command failed')
    return response
  }

  readUntil(predicate) {
    if (predicate(this.buffer)) {
      const value = this.buffer
      this.buffer = ''
      return Promise.resolve(value)
    }
    return new Promise((resolve, reject) => {
      const onData = (chunk) => {
        this.buffer += chunk.toString('utf8')
        if (!predicate(this.buffer)) return
        cleanup()
        const value = this.buffer
        this.buffer = ''
        resolve(value)
      }
      const onError = (error) => { cleanup(); reject(error) }
      const cleanup = () => { this.socket.off('data', onData); this.socket.off('error', onError) }
      this.socket.on('data', onData)
      this.socket.on('error', onError)
    })
  }

  async close() {
    try { await this.command('LOGOUT') } catch { /* ignore */ }
    this.socket.end()
  }
}

function parseSearchIds(response) {
  const match = response.match(/^\* SEARCH(?:\s+([\d\s]+))?\r?$/m)
  return match?.[1]?.trim().split(/\s+/).filter(Boolean) || []
}

function parseMessageDate(raw) {
  const match = raw.match(/^Date:\s*(.+)$/im)
  const value = match ? Date.parse(match[1]) : Number.NaN
  return Number.isFinite(value) ? value : null
}

function extractOtp(raw) {
  const patterns = [
    /verification code(?: is)?[^0-9]{0,80}(\d{6})/i,
    /验证码[^0-9]{0,80}(\d{6})/i,
    /(?:token|code)[^0-9]{0,80}(\d{6})/i,
  ]
  for (const pattern of patterns) {
    const match = raw.match(pattern)
    if (match) return match[1]
  }
  return null
}

function quoteImap(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function buildAuthStorageKey(url) {
  const projectRef = new URL(url).hostname.split('.')[0]
  return `sb-${projectRef}-auth-token`
}

async function waitFor(check, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  fail(`${label} timed out.`)
}

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

function log(message) {
  console.log(`[trip-intelligence-smoke] ${message}`)
}

function fail(message) {
  throw new Error(`[trip-intelligence-smoke] ${message}`)
}
