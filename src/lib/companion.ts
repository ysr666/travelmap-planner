import {
  createItineraryItem,
  createTripDisruptionEvent,
  deleteItineraryItemCascade,
  getItineraryItem,
  getTrip,
  listDaysByTrip,
  listItemsByDay,
  listItemsByTrip,
  listTicketsByTrip,
  listTripDisruptionEventsByTrip,
  listTripReplanRecordsByTrip,
  reorderDayItems,
  setItineraryItemExecutionState,
  updateItineraryItem,
} from '../db'
import { createId } from '../db/ids'
import { getCurrentSession, getCurrentUser } from './cloudBackup'
import { getTicketCategoryLabel, getTicketDisplayTitle } from './tickets'
import { requireSupabaseClient, getSupabaseConfigStatus } from './supabaseClient'
import type {
  CompanionActivityType,
  CompanionInviteStatus,
  CompanionPermission,
  Day,
  ItineraryExecutionStatus,
  ItineraryItem,
  TripDisruptionEvent,
  SharedItineraryItem,
  SharedTicketSummary,
  SharedTrip,
  SharedTripActivity,
  SharedTripComment,
  SharedTripInvite,
  SharedTripMeetingConfirmation,
  SharedTripMember,
  SharedTripMutation,
  SharedTripMutationStatus,
  SharedTripMutationType,
  SharedTripProjection,
  TicketMeta,
  TripReplanRecord,
  Trip,
} from '../types'

const CLOUD_FIXTURE_KEY = 'tripmap:e2e:cloud-fixture'
const INVITE_TOKEN_BYTES = 24
const MAX_COMMENT_LENGTH = 500
const MAX_MUTATION_TEXT_LENGTH = 300

export type OwnerSharedTripState =
  | {
      configured: false
      missing: string[]
      signedIn: false
    }
  | {
      configured: true
      signedIn: false
      missing: []
    }
  | {
      activities: SharedTripActivity[]
      configured: true
      invites: SharedTripInvite[]
      members: SharedTripMember[]
      mutations: SharedTripMutation[]
      sharedTrip: SharedTrip | null
      signedIn: true
    }

export type CompanionSharedTripBundle = {
  activities: SharedTripActivity[]
  comments: SharedTripComment[]
  confirmations: SharedTripMeetingConfirmation[]
  member: SharedTripMember | null
  mutations: SharedTripMutation[]
  sharedTrip: SharedTrip
}

export type ClaimSharedTripInviteResult = {
  permission: CompanionPermission
  sharedTripId: string
  tripId: string
}

export type CreateSharedTripInviteResult = {
  invite: SharedTripInvite
  token: string
  url: string
}

export type ApplySharedTripMutationResult = {
  mutationId: string
  status: SharedTripMutationStatus
  message: string
}

export type SharedTripMutationDraft =
  | {
      mutationType: 'update_item'
      payload: {
        baselineUpdatedAt?: number
        itemId: string
        patch: Partial<Pick<
          ItineraryItem,
          | 'address'
          | 'endTime'
          | 'locationName'
          | 'notes'
          | 'previousTransportDurationMinutes'
          | 'previousTransportMode'
          | 'startTime'
          | 'title'
        >>
      }
    }
  | {
      mutationType: 'create_item'
      payload: {
        dayId: string
        item: Pick<ItineraryItem, 'title'> & Partial<Pick<
          ItineraryItem,
          | 'address'
          | 'endTime'
          | 'locationName'
          | 'notes'
          | 'previousTransportDurationMinutes'
          | 'previousTransportMode'
          | 'startTime'
          | 'transportMode'
        >>
      }
    }
  | {
      mutationType: 'delete_item'
      payload: {
        baselineUpdatedAt?: number
        itemId: string
      }
    }
  | {
      mutationType: 'reorder_day_items'
      payload: {
        dayId: string
        orderedItemIds: string[]
      }
    }
  | {
      mutationType: 'update_item_execution_state'
      payload: {
        itemId: string
        status: ItineraryExecutionStatus | null
      }
    }
  | {
      mutationType: 'report_disruption'
      payload: {
        dayId?: string
        delayMinutes?: number
        itemId?: string
        kind: TripDisruptionEvent['kind']
        notes?: string
        occurredAt?: string
        segmentId?: string
      }
    }
  | {
      mutationType: 'request_replan_undo'
      payload: {
        notes?: string
        recordId: string
      }
    }

type CompanionFixture = {
  sharedActivityRows?: SharedTripActivity[]
  sharedCommentRows?: SharedTripComment[]
  sharedConfirmationRows?: SharedTripMeetingConfirmation[]
  sharedInviteRows?: SharedTripInvite[]
  sharedMemberRows?: SharedTripMember[]
  sharedMutationRows?: SharedTripMutation[]
  sharedTripRows?: SharedTrip[]
  user?: {
    email?: string
    id: string
  }
}

type SharedTripRow = {
  created_at: string
  id: string
  owner_id: string
  projection: SharedTripProjection
  projection_updated_at: string
  title: string
  trip_id: string
  updated_at: string
}

type SharedInviteRow = {
  created_at: string
  expires_at?: string | null
  id: string
  owner_id: string
  permission: CompanionPermission
  revoked_at?: string | null
  shared_trip_id: string
  status: CompanionInviteStatus
  token_hash: string
  updated_at: string
}

type SharedMemberRow = {
  display_name?: string | null
  email?: string | null
  joined_at: string
  owner_id: string
  permission: CompanionPermission
  removed_at?: string | null
  shared_trip_id: string
  updated_at: string
  user_id: string
}

type SharedCommentRow = {
  body: string
  created_at: string
  deleted_at?: string | null
  display_name?: string | null
  id: string
  item_id: string
  shared_trip_id: string
  updated_at: string
  user_id: string
}

type SharedConfirmationRow = {
  confirmed_at: string
  display_name?: string | null
  item_id: string
  note?: string | null
  shared_trip_id: string
  updated_at: string
  user_id: string
}

type SharedActivityRow = {
  activity_type: CompanionActivityType
  body?: string | null
  created_at: string
  display_name?: string | null
  id: string
  item_id?: string | null
  shared_trip_id: string
  user_id?: string | null
}

type SharedMutationRow = {
  applied_at?: string | null
  created_at: string
  display_name?: string | null
  id: string
  mutation_type: SharedTripMutationType
  payload: unknown
  rejected_reason?: string | null
  shared_trip_id: string
  status: SharedTripMutationStatus
  updated_at: string
  user_id: string
}

export function getCompanionPermissionRank(permission: CompanionPermission | null | undefined) {
  if (permission === 'collaborate') return 3
  if (permission === 'comment') return 2
  if (permission === 'read') return 1
  return 0
}

export function canCompanionComment(permission: CompanionPermission | null | undefined) {
  return getCompanionPermissionRank(permission) >= 2
}

export function canCompanionCollaborate(permission: CompanionPermission | null | undefined) {
  return getCompanionPermissionRank(permission) >= 3
}

export function getCompanionPermissionLabel(permission: CompanionPermission) {
  if (permission === 'collaborate') return '可协作'
  if (permission === 'comment') return '可评论'
  return '只读'
}

export function buildSharedTripProjection({
  days,
  items,
  now = new Date(),
  replanEvents = [],
  replanRecords = [],
  tickets,
  trip,
}: {
  days: Day[]
  items: ItineraryItem[]
  now?: Date
  replanEvents?: TripDisruptionEvent[]
  replanRecords?: TripReplanRecord[]
  tickets: TicketMeta[]
  trip: Trip
}): SharedTripProjection {
  const ticketSummaries = buildSharedTicketSummaries(tickets)
  const ticketIds = new Set(ticketSummaries.map((ticket) => ticket.id))
  const sharedItems = items.map((item) => sanitizeSharedItem(item, ticketIds))
  const eventById = new Map(replanEvents.map((event) => [event.id, event]))
  const latestReplan = [...replanRecords]
    .filter((record) => record.status === 'applied' && record.selectedDiff)
    .sort((first, second) => second.updatedAt - first.updatedAt)[0]
  const latestReplanEvent = latestReplan ? eventById.get(latestReplan.eventId) : undefined

  return {
    days: days.map((day) => ({ ...day })),
    items: sharedItems,
    latestReplanSummary: latestReplan ? {
      appliedAt: new Date(latestReplan.updatedAt).toISOString(),
      eventKind: latestReplanEvent?.kind ?? 'late',
      recordId: latestReplan.id,
      summary: latestReplan.options.find((option) => option.id === latestReplan.selectedOptionId)?.summary ?? '行程已根据突发情况更新。',
    } : undefined,
    meetingChangeSummaries: latestReplan?.selectedDiff?.companionImpacts ?? [],
    publishedAt: now.toISOString(),
    schemaVersion: 2,
    ticketSummaries,
    trip: { ...trip },
    warnings: [
      '共享视图不包含票据文件、加密旅行资料、云端同步状态、路线缓存或 provider 原始结果。',
    ],
  }
}

export function buildSharedTicketSummaries(tickets: TicketMeta[]): SharedTicketSummary[] {
  return [...tickets]
    .sort((first, second) => first.createdAt - second.createdAt || first.id.localeCompare(second.id))
    .map((ticket) => ({
      fileType: ticket.fileType,
      id: ticket.id,
      itemId: ticket.itemId,
      scope: ticket.scope,
      storageMode: ticket.storageMode ?? 'copy',
      ticketCategory: ticket.ticketCategory,
      title: getTicketDisplayTitle(ticket) || getTicketCategoryLabel(ticket),
    }))
}

export function companionInviteTokenFromUrl(value: string) {
  const params = new URLSearchParams(value.split('?')[1] ?? value)
  return params.get('invite') ?? params.get('token') ?? ''
}

export async function hashCompanionInviteToken(token: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('当前浏览器不支持安全共享链接。')
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function generateCompanionInviteToken() {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('当前浏览器不支持生成安全共享链接。')
  }
  const bytes = new Uint8Array(INVITE_TOKEN_BYTES)
  globalThis.crypto.getRandomValues(bytes)
  return base64UrlEncode(bytes)
}

export function buildCompanionInviteUrl(token: string) {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  return `${origin}${path}#/shared-trip?invite=${encodeURIComponent(token)}`
}

export async function hasCompanionSession() {
  return Boolean(await getCurrentSession().catch(() => null))
}

export async function publishSharedTripFromLocal(tripId: string) {
  const [trip, days, items, tickets, replanEvents, replanRecords] = await Promise.all([
    getTrip(tripId),
    listDaysByTrip(tripId),
    listItemsByTrip(tripId),
    listTicketsByTrip(tripId),
    listTripDisruptionEventsByTrip(tripId),
    listTripReplanRecordsByTrip(tripId),
  ])
  if (!trip) {
    throw new Error('没有找到要共享的旅行。')
  }

  const user = await requireCompanionUser()
  const projection = buildSharedTripProjection({ days, items, replanEvents, replanRecords, tickets, trip })
  const now = new Date().toISOString()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const nextTrip: SharedTrip = {
      createdAt: now,
      id: fixture.sharedTripRows?.find((row) => row.ownerId === user.id && row.tripId === trip.id)?.id ?? createId('shared_trip'),
      ownerId: user.id,
      projection,
      projectionUpdatedAt: now,
      title: trip.title,
      tripId: trip.id,
      updatedAt: now,
    }
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(nextTrip.id, user.id, 'published', '更新了共享行程'),
        ...(fixture.sharedActivityRows ?? []),
      ],
      sharedTripRows: upsertById(fixture.sharedTripRows ?? [], nextTrip),
    })
    return { sharedTrip: nextTrip, warnings: projection.warnings }
  }

  const client = requireSupabaseClient()
  const { data, error } = await client
    .from('companion_shared_trips')
    .upsert({
      owner_id: user.id,
      projection,
      projection_updated_at: now,
      title: trip.title,
      trip_id: trip.id,
    }, { onConflict: 'owner_id,trip_id' })
    .select('*')
    .single()
  if (error) throw new Error('发布共享行程失败：' + error.message)

  const sharedTrip = mapSharedTripRow(data as SharedTripRow)
  await client.from('companion_shared_activities').insert({
    activity_type: 'published',
    body: '更新了共享行程',
    shared_trip_id: sharedTrip.id,
    user_id: user.id,
  })
  return { sharedTrip, warnings: projection.warnings }
}

export async function loadOwnerSharedTripState(tripId: string): Promise<OwnerSharedTripState> {
  const status = getSupabaseConfigStatus()
  if (!status.configured) {
    return { configured: false, missing: status.missing, signedIn: false }
  }
  const session = await getCurrentSession().catch(() => null)
  if (!session) {
    return { configured: true, missing: [], signedIn: false }
  }

  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const sharedTrip = (fixture.sharedTripRows ?? []).find((row) => row.ownerId === user.id && row.tripId === tripId) ?? null
    return {
      activities: sharedTrip ? sortActivities((fixture.sharedActivityRows ?? []).filter((row) => row.sharedTripId === sharedTrip.id)) : [],
      configured: true,
      invites: sharedTrip ? sortInvites((fixture.sharedInviteRows ?? []).filter((row) => row.sharedTripId === sharedTrip.id)) : [],
      members: sharedTrip ? sortMembers((fixture.sharedMemberRows ?? []).filter((row) => row.sharedTripId === sharedTrip.id && !row.removedAt)) : [],
      mutations: sharedTrip ? sortMutations((fixture.sharedMutationRows ?? []).filter((row) => row.sharedTripId === sharedTrip.id)) : [],
      sharedTrip,
      signedIn: true,
    }
  }

  const client = requireSupabaseClient()
  const { data: sharedData, error: sharedError } = await client
    .from('companion_shared_trips')
    .select('*')
    .eq('owner_id', user.id)
    .eq('trip_id', tripId)
    .maybeSingle()
  if (sharedError) throw new Error('读取共享设置失败：' + sharedError.message)
  const sharedTrip = sharedData ? mapSharedTripRow(sharedData as SharedTripRow) : null
  if (!sharedTrip) {
    return {
      activities: [],
      configured: true,
      invites: [],
      members: [],
      mutations: [],
      sharedTrip: null,
      signedIn: true,
    }
  }

  const [invites, members, activities, mutations] = await Promise.all([
    client.from('companion_shared_invites').select('*').eq('shared_trip_id', sharedTrip.id).order('created_at', { ascending: false }),
    client.from('companion_shared_members').select('*').eq('shared_trip_id', sharedTrip.id).is('removed_at', null).order('joined_at', { ascending: false }),
    client.from('companion_shared_activities').select('*').eq('shared_trip_id', sharedTrip.id).order('created_at', { ascending: false }).limit(50),
    client.from('companion_shared_mutations').select('*').eq('shared_trip_id', sharedTrip.id).order('created_at', { ascending: false }).limit(50),
  ])
  for (const result of [invites, members, activities, mutations]) {
    if (result.error) throw new Error('读取共享动态失败：' + result.error.message)
  }

  return {
    activities: (activities.data ?? []).map((row) => mapActivityRow(row as SharedActivityRow)),
    configured: true,
    invites: (invites.data ?? []).map((row) => mapInviteRow(row as SharedInviteRow)),
    members: (members.data ?? []).map((row) => mapMemberRow(row as SharedMemberRow)),
    mutations: (mutations.data ?? []).map((row) => mapMutationRow(row as SharedMutationRow)),
    sharedTrip,
    signedIn: true,
  }
}

export async function createSharedTripInvite({
  permission,
  sharedTripId,
}: {
  permission: CompanionPermission
  sharedTripId: string
}): Promise<CreateSharedTripInviteResult> {
  const user = await requireCompanionUser()
  const token = generateCompanionInviteToken()
  const tokenHash = await hashCompanionInviteToken(token)
  const now = new Date().toISOString()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const sharedTrip = (fixture.sharedTripRows ?? []).find((row) => row.id === sharedTripId && row.ownerId === user.id)
    if (!sharedTrip) throw new Error('没有共享行程管理权限。')
    const invite: SharedTripInvite = {
      createdAt: now,
      id: createId('shared_invite'),
      ownerId: user.id,
      permission,
      sharedTripId,
      status: 'active',
      tokenHash,
      updatedAt: now,
    }
    writeCompanionFixture({
      ...fixture,
      sharedInviteRows: [invite, ...(fixture.sharedInviteRows ?? [])],
    })
    return { invite, token, url: buildCompanionInviteUrl(token) }
  }

  const client = requireSupabaseClient()
  const { data, error } = await client
    .from('companion_shared_invites')
    .insert({
      owner_id: user.id,
      permission,
      shared_trip_id: sharedTripId,
      token_hash: tokenHash,
    })
    .select('*')
    .single()
  if (error) throw new Error('创建共享链接失败：' + error.message)
  return { invite: mapInviteRow(data as SharedInviteRow), token, url: buildCompanionInviteUrl(token) }
}

export async function revokeSharedTripInvite(inviteId: string) {
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    writeCompanionFixture({
      ...fixture,
      sharedInviteRows: (fixture.sharedInviteRows ?? []).map((invite) =>
        invite.id === inviteId
          ? { ...invite, revokedAt: new Date().toISOString(), status: 'revoked', updatedAt: new Date().toISOString() }
          : invite,
      ),
    })
    return
  }

  const client = requireSupabaseClient()
  const { error } = await client
    .from('companion_shared_invites')
    .update({ revoked_at: new Date().toISOString(), status: 'revoked' })
    .eq('id', inviteId)
  if (error) throw new Error('撤销共享链接失败：' + error.message)
}

export async function updateSharedTripMemberPermission(
  sharedTripId: string,
  userId: string,
  permission: CompanionPermission,
) {
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    writeCompanionFixture({
      ...fixture,
      sharedMemberRows: (fixture.sharedMemberRows ?? []).map((member) =>
        member.sharedTripId === sharedTripId && member.userId === userId
          ? { ...member, permission, updatedAt: new Date().toISOString() }
          : member,
      ),
    })
    return
  }
  const { error } = await requireSupabaseClient()
    .from('companion_shared_members')
    .update({ permission })
    .eq('shared_trip_id', sharedTripId)
    .eq('user_id', userId)
  if (error) throw new Error('更新同行权限失败：' + error.message)
}

export async function removeSharedTripMember(sharedTripId: string, userId: string) {
  const now = new Date().toISOString()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    writeCompanionFixture({
      ...fixture,
      sharedMemberRows: (fixture.sharedMemberRows ?? []).map((member) =>
        member.sharedTripId === sharedTripId && member.userId === userId
          ? { ...member, removedAt: now, updatedAt: now }
          : member,
      ),
    })
    return
  }
  const { error } = await requireSupabaseClient()
    .from('companion_shared_members')
    .update({ removed_at: now })
    .eq('shared_trip_id', sharedTripId)
    .eq('user_id', userId)
  if (error) throw new Error('移除同行人失败：' + error.message)
}

export async function claimSharedTripInvite(token: string, displayName?: string): Promise<ClaimSharedTripInviteResult> {
  const tokenHash = await hashCompanionInviteToken(token.trim())
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const invite = (fixture.sharedInviteRows ?? []).find((row) =>
      row.tokenHash === tokenHash
      && row.status === 'active'
      && !row.revokedAt
      && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()),
    )
    if (!invite) throw new Error('共享链接不可用或已撤销。')
    const sharedTrip = (fixture.sharedTripRows ?? []).find((row) => row.id === invite.sharedTripId)
    if (!sharedTrip) throw new Error('共享旅行不存在。')
    const now = new Date().toISOString()
    if (sharedTrip.ownerId !== user.id) {
      const member: SharedTripMember = {
        displayName: displayName?.trim() || user.email || '同行人',
        email: user.email,
        joinedAt: now,
        ownerId: sharedTrip.ownerId,
        permission: invite.permission,
        sharedTripId: sharedTrip.id,
        updatedAt: now,
        userId: user.id,
      }
      writeCompanionFixture({
        ...fixture,
        sharedActivityRows: [
          buildFixtureActivity(sharedTrip.id, user.id, 'joined', '加入了共享旅行', member.displayName),
          ...(fixture.sharedActivityRows ?? []),
        ],
        sharedMemberRows: upsertMember(fixture.sharedMemberRows ?? [], member),
      })
    }
    return { permission: sharedTrip.ownerId === user.id ? 'collaborate' : invite.permission, sharedTripId: sharedTrip.id, tripId: sharedTrip.tripId }
  }

  const { data, error } = await requireSupabaseClient().rpc('companion_claim_invite', {
    companion_display_name: displayName?.trim() || null,
    invite_token_hash: tokenHash,
  })
  if (error) throw new Error('加入共享旅行失败：' + error.message)
  const first = Array.isArray(data) ? data[0] : data
  return {
    permission: normalizePermission(first.permission),
    sharedTripId: first.shared_trip_id,
    tripId: first.trip_id,
  }
}

export async function loadCompanionSharedTrip(sharedTripId: string): Promise<CompanionSharedTripBundle> {
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const sharedTrip = (fixture.sharedTripRows ?? []).find((row) => row.id === sharedTripId)
    if (!sharedTrip) throw new Error('没有找到共享旅行。')
    const member = sharedTrip.ownerId === user.id
      ? ownerAsMember(sharedTrip, user)
      : (fixture.sharedMemberRows ?? []).find((row) => row.sharedTripId === sharedTripId && row.userId === user.id && !row.removedAt) ?? null
    if (!member) throw new Error('你还没有加入这趟共享旅行。')
    return {
      activities: sortActivities((fixture.sharedActivityRows ?? []).filter((row) => row.sharedTripId === sharedTripId)),
      comments: sortComments((fixture.sharedCommentRows ?? []).filter((row) => row.sharedTripId === sharedTripId && !row.deletedAt)),
      confirmations: (fixture.sharedConfirmationRows ?? []).filter((row) => row.sharedTripId === sharedTripId),
      member,
      mutations: sortMutations((fixture.sharedMutationRows ?? []).filter((row) => row.sharedTripId === sharedTripId)),
      sharedTrip,
    }
  }

  const client = requireSupabaseClient()
  const { data: sharedData, error: sharedError } = await client
    .from('companion_shared_trips')
    .select('*')
    .eq('id', sharedTripId)
    .single()
  if (sharedError) throw new Error('读取共享旅行失败：' + sharedError.message)
  const sharedTrip = mapSharedTripRow(sharedData as SharedTripRow)
  const [member, comments, confirmations, activities, mutations] = await Promise.all([
    client.from('companion_shared_members').select('*').eq('shared_trip_id', sharedTripId).eq('user_id', user.id).maybeSingle(),
    client.from('companion_shared_comments').select('*').eq('shared_trip_id', sharedTripId).is('deleted_at', null).order('created_at', { ascending: true }),
    client.from('companion_meeting_confirmations').select('*').eq('shared_trip_id', sharedTripId),
    client.from('companion_shared_activities').select('*').eq('shared_trip_id', sharedTripId).order('created_at', { ascending: false }).limit(50),
    client.from('companion_shared_mutations').select('*').eq('shared_trip_id', sharedTripId).order('created_at', { ascending: false }).limit(50),
  ])
  for (const result of [member, comments, confirmations, activities, mutations]) {
    if (result.error) throw new Error('读取共享旅行详情失败：' + result.error.message)
  }
  const activeMember = sharedTrip.ownerId === user.id
    ? ownerAsMember(sharedTrip, user)
    : member.data
      ? mapMemberRow(member.data as SharedMemberRow)
      : null
  if (!activeMember) throw new Error('你还没有加入这趟共享旅行。')
  return {
    activities: (activities.data ?? []).map((row) => mapActivityRow(row as SharedActivityRow)),
    comments: (comments.data ?? []).map((row) => mapCommentRow(row as SharedCommentRow)),
    confirmations: (confirmations.data ?? []).map((row) => mapConfirmationRow(row as SharedConfirmationRow)),
    member: activeMember,
    mutations: (mutations.data ?? []).map((row) => mapMutationRow(row as SharedMutationRow)),
    sharedTrip,
  }
}

export async function recordSharedTripView(sharedTripId: string) {
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(sharedTripId, user.id, 'viewed', '查看了共享旅行', user.email),
        ...(fixture.sharedActivityRows ?? []),
      ],
    })
    return
  }
  await requireSupabaseClient().rpc('companion_record_view', { target_shared_trip_id: sharedTripId })
}

export async function addSharedTripComment(sharedTripId: string, itemId: string, body: string) {
  const normalized = body.trim()
  if (!normalized || normalized.length > MAX_COMMENT_LENGTH) {
    throw new Error('留言需要在 1 到 500 字之间。')
  }
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const member = requireFixtureMember(fixture, sharedTripId, user.id)
    if (!canCompanionComment(member.permission)) throw new Error('当前权限不能留言。')
    const now = new Date().toISOString()
    const comment: SharedTripComment = {
      body: normalized,
      createdAt: now,
      displayName: member.displayName ?? user.email,
      id: createId('shared_comment'),
      itemId,
      sharedTripId,
      updatedAt: now,
      userId: user.id,
    }
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(sharedTripId, user.id, 'commented', normalized.slice(0, 160), member.displayName ?? user.email, itemId),
        ...(fixture.sharedActivityRows ?? []),
      ],
      sharedCommentRows: [...(fixture.sharedCommentRows ?? []), comment],
    })
    return comment.id
  }
  const { data, error } = await requireSupabaseClient().rpc('companion_add_comment', {
    comment_body: normalized,
    target_item_id: itemId,
    target_shared_trip_id: sharedTripId,
  })
  if (error) throw new Error('留言失败：' + error.message)
  return data as string
}

export async function confirmSharedTripMeeting(sharedTripId: string, itemId: string, note?: string) {
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const member = requireFixtureMember(fixture, sharedTripId, user.id)
    if (!canCompanionComment(member.permission)) throw new Error('当前权限不能确认集合。')
    const now = new Date().toISOString()
    const confirmation: SharedTripMeetingConfirmation = {
      confirmedAt: now,
      displayName: member.displayName ?? user.email,
      itemId,
      note: note?.trim() || undefined,
      sharedTripId,
      updatedAt: now,
      userId: user.id,
    }
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(sharedTripId, user.id, 'confirmed_meeting', '确认了集合时间', member.displayName ?? user.email, itemId),
        ...(fixture.sharedActivityRows ?? []),
      ],
      sharedConfirmationRows: upsertConfirmation(fixture.sharedConfirmationRows ?? [], confirmation),
    })
    return
  }
  const { error } = await requireSupabaseClient().rpc('companion_confirm_meeting', {
    confirmation_note: note?.trim() || null,
    target_item_id: itemId,
    target_shared_trip_id: sharedTripId,
  })
  if (error) throw new Error('确认集合失败：' + error.message)
}

export function validateSharedTripMutationDraft(draft: SharedTripMutationDraft) {
  if (draft.mutationType === 'update_item') {
    if (!draft.payload.itemId) return { message: '缺少行程点。', ok: false as const }
    const patch = sanitizeItemPatch(draft.payload.patch)
    if (Object.keys(patch).length === 0) return { message: '没有可提交的修改。', ok: false as const }
    return { ok: true as const, payload: { ...draft.payload, patch } }
  }
  if (draft.mutationType === 'create_item') {
    const title = draft.payload.item.title.trim()
    if (!draft.payload.dayId || !title) return { message: '新增行程点需要日期和标题。', ok: false as const }
    return {
      ok: true as const,
      payload: {
        dayId: draft.payload.dayId,
        item: {
          ...sanitizeItemPatch(draft.payload.item),
          title,
        },
      },
    }
  }
  if (draft.mutationType === 'delete_item') {
    if (!draft.payload.itemId) return { message: '缺少要删除的行程点。', ok: false as const }
    return { ok: true as const, payload: draft.payload }
  }
  if (draft.mutationType === 'reorder_day_items') {
    if (!draft.payload.dayId || draft.payload.orderedItemIds.length === 0) return { message: '缺少排序信息。', ok: false as const }
    return { ok: true as const, payload: draft.payload }
  }
  if (draft.mutationType === 'report_disruption') {
    const kind = readDisruptionKind(asRecord(draft.payload).kind)
    if (!kind) return { message: '突发情况类型无效。', ok: false as const }
    const payload = asRecord(draft.payload)
    return {
      ok: true as const,
      payload: {
        dayId: readOptionalShortString(payload.dayId),
        delayMinutes: typeof payload.delayMinutes === 'number' && Number.isFinite(payload.delayMinutes)
          ? Math.max(0, Math.min(24 * 60, Math.round(payload.delayMinutes)))
          : undefined,
        itemId: readOptionalShortString(payload.itemId),
        kind,
        notes: readOptionalLimitedText(payload.notes, MAX_COMMENT_LENGTH),
        occurredAt: readOptionalShortString(payload.occurredAt),
        segmentId: readOptionalShortString(payload.segmentId),
      },
    }
  }
  if (draft.mutationType === 'request_replan_undo') {
    const payload = asRecord(draft.payload)
    const recordId = readString(payload.recordId).trim()
    if (!recordId) return { message: '缺少要撤销的重排记录。', ok: false as const }
    return {
      ok: true as const,
      payload: {
        notes: readOptionalLimitedText(payload.notes, MAX_COMMENT_LENGTH),
        recordId,
      },
    }
  }
  if (!draft.payload.itemId) return { message: '缺少行程点。', ok: false as const }
  if (draft.payload.status !== null && draft.payload.status !== 'completed' && draft.payload.status !== 'skipped') {
    return { message: '执行状态无效。', ok: false as const }
  }
  return { ok: true as const, payload: draft.payload }
}

export async function submitSharedTripMutation(sharedTripId: string, draft: SharedTripMutationDraft) {
  const validation = validateSharedTripMutationDraft(draft)
  if (!validation.ok) throw new Error(validation.message)
  const user = await requireCompanionUser()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    const member = requireFixtureMember(fixture, sharedTripId, user.id)
    const canSubmit = draft.mutationType === 'report_disruption'
      ? canCompanionComment(member.permission)
      : canCompanionCollaborate(member.permission)
    if (!canSubmit) {
      throw new Error(draft.mutationType === 'report_disruption' ? '当前权限不能报告突发情况。' : '当前权限不能协作修改行程。')
    }
    const now = new Date().toISOString()
    const mutation: SharedTripMutation = {
      createdAt: now,
      displayName: member.displayName ?? user.email,
      id: createId('shared_mutation'),
      mutationType: draft.mutationType,
      payload: validation.payload,
      sharedTripId,
      status: 'pending',
      updatedAt: now,
      userId: user.id,
    }
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(sharedTripId, user.id, 'submitted_change', '提交了协作修改', member.displayName ?? user.email),
        ...(fixture.sharedActivityRows ?? []),
      ],
      sharedMutationRows: [mutation, ...(fixture.sharedMutationRows ?? [])],
    })
    return mutation.id
  }
  const { data, error } = await requireSupabaseClient().rpc('companion_submit_mutation', {
    mutation_payload: validation.payload,
    target_mutation_type: draft.mutationType,
    target_shared_trip_id: sharedTripId,
  })
  if (error) throw new Error('提交协作修改失败：' + error.message)
  return data as string
}

export async function syncSharedTripForOwner(tripId: string) {
  const state = await loadOwnerSharedTripState(tripId)
  if (!state.configured || !state.signedIn || !state.sharedTrip) {
    return { applied: 0, conflicts: 0, published: false }
  }

  let applied = 0
  let conflicts = 0
  for (const mutation of state.mutations.filter((item) => item.status === 'pending' && item.mutationType !== 'request_replan_undo').reverse()) {
    const result = await applySharedTripMutationToLocal(tripId, mutation)
    if (result.status === 'applied') applied += 1
    if (result.status === 'conflict' || result.status === 'rejected') conflicts += 1
  }
  await publishSharedTripFromLocal(tripId)
  return { applied, conflicts, published: true }
}

export async function applySharedTripMutationToLocal(
  tripId: string,
  mutation: SharedTripMutation,
): Promise<ApplySharedTripMutationResult> {
  if (mutation.status !== 'pending') {
    return { message: '这条协作修改已经处理过。', mutationId: mutation.id, status: mutation.status }
  }

  try {
    await applyMutationPayload(tripId, mutation)
    await markSharedTripMutation(mutation, 'applied', '已应用到主人行程。')
    return { message: '已应用到主人行程。', mutationId: mutation.id, status: 'applied' }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : '协作修改无法应用。'
    const status: SharedTripMutationStatus = message.includes('冲突') ? 'conflict' : 'rejected'
    await markSharedTripMutation(mutation, status, message)
    return { message, mutationId: mutation.id, status }
  }
}

async function applyMutationPayload(tripId: string, mutation: SharedTripMutation) {
  const payload = asRecord(mutation.payload)
  if (mutation.mutationType === 'update_item') {
    const itemId = readString(payload.itemId)
    const item = await getItineraryItem(itemId)
    if (!item || item.tripId !== tripId) throw new Error('行程点不存在。')
    if (typeof payload.baselineUpdatedAt === 'number' && item.updatedAt > payload.baselineUpdatedAt) {
      throw new Error('行程点已被主人更新，存在冲突。')
    }
    const patch = sanitizeItemPatch(asRecord(payload.patch))
    if (Object.keys(patch).length === 0) throw new Error('没有可应用的行程修改。')
    await updateItineraryItem(item.id, patch)
    return
  }

  if (mutation.mutationType === 'create_item') {
    const dayId = readString(payload.dayId)
    const trip = await getTrip(tripId)
    const days = await listDaysByTrip(tripId)
    const day = days.find((candidate) => candidate.id === dayId)
    if (!trip || !day) throw new Error('新增目标日期不存在。')
    const existing = await listItemsByDay(day.id)
    const itemInput = asRecord(payload.item)
    const title = readString(itemInput.title).trim()
    if (!title) throw new Error('新增行程点缺少标题。')
    await createItineraryItem({
      ...sanitizeItemPatch(itemInput),
      dayId: day.id,
      sortOrder: Math.max(0, ...existing.map((item) => item.sortOrder)) + 1,
      ticketIds: [],
      title,
      tripId: trip.id,
    })
    return
  }

  if (mutation.mutationType === 'delete_item') {
    const itemId = readString(payload.itemId)
    const item = await getItineraryItem(itemId)
    if (!item || item.tripId !== tripId) throw new Error('行程点不存在。')
    if (item.ticketIds.length > 0) throw new Error('此行程点已绑定票据，不能由同行人删除。')
    if (typeof payload.baselineUpdatedAt === 'number' && item.updatedAt > payload.baselineUpdatedAt) {
      throw new Error('行程点已被主人更新，存在冲突。')
    }
    await deleteItineraryItemCascade(item.id)
    return
  }

  if (mutation.mutationType === 'reorder_day_items') {
    const dayId = readString(payload.dayId)
    const orderedItemIds = Array.isArray(payload.orderedItemIds)
      ? payload.orderedItemIds.filter((value): value is string => typeof value === 'string')
      : []
    const items = await listItemsByDay(dayId)
    if (items.length !== orderedItemIds.length) throw new Error('排序列表与当前行程不一致，存在冲突。')
    const itemIds = new Set(items.map((item) => item.id))
    if (!orderedItemIds.every((id) => itemIds.has(id))) throw new Error('排序列表包含无效行程点。')
    await reorderDayItems(dayId, orderedItemIds, items.map((item) => item.id))
    return
  }

  if (mutation.mutationType === 'report_disruption') {
    const kind = readDisruptionKind(payload.kind)
    if (!kind) throw new Error('突发情况类型无效。')
    const dayId = readOptionalShortString(payload.dayId)
    const itemId = readOptionalShortString(payload.itemId)
    if (itemId) {
      const item = await getItineraryItem(itemId)
      if (!item || item.tripId !== tripId) throw new Error('行程点不存在。')
    }
    await createTripDisruptionEvent({
      dayId,
      delayMinutes: typeof payload.delayMinutes === 'number' ? payload.delayMinutes : undefined,
      evidence: [],
      itemId,
      kind,
      notes: readOptionalLimitedText(payload.notes, MAX_COMMENT_LENGTH),
      occurredAt: readOptionalShortString(payload.occurredAt) ?? new Date().toISOString(),
      reportedByDisplayName: mutation.displayName,
      reportedByRole: 'companion',
      reportedByUserId: mutation.userId,
      segmentId: readOptionalShortString(payload.segmentId),
      sharedMutationId: mutation.id,
      status: 'reported',
      tripId,
    })
    return
  }

  if (mutation.mutationType === 'request_replan_undo') {
    throw new Error('撤销请求需要主人在重排面板中确认。')
  }

  const itemId = readString(payload.itemId)
  const status = payload.status === 'completed' || payload.status === 'skipped' ? payload.status : null
  const item = await getItineraryItem(itemId)
  if (!item || item.tripId !== tripId) throw new Error('行程点不存在。')
  await setItineraryItemExecutionState(item.id, status)
}

async function markSharedTripMutation(
  mutation: SharedTripMutation,
  status: SharedTripMutationStatus,
  message: string,
) {
  const now = new Date().toISOString()
  const fixture = readCompanionFixture()
  if (fixture?.user) {
    writeCompanionFixture({
      ...fixture,
      sharedActivityRows: [
        buildFixtureActivity(
          mutation.sharedTripId,
          fixture.user.id,
          status === 'applied' ? 'applied_change' : 'rejected_change',
          message,
        ),
        ...(fixture.sharedActivityRows ?? []),
      ],
      sharedMutationRows: (fixture.sharedMutationRows ?? []).map((row) =>
        row.id === mutation.id
          ? {
              ...row,
              appliedAt: status === 'applied' ? now : row.appliedAt,
              rejectedReason: status === 'applied' ? undefined : message,
              status,
              updatedAt: now,
            }
          : row,
      ),
    })
    return
  }
  const { error } = await requireSupabaseClient()
    .from('companion_shared_mutations')
    .update({
      applied_at: status === 'applied' ? now : null,
      rejected_reason: status === 'applied' ? null : message,
      status,
    })
    .eq('id', mutation.id)
  if (error) throw new Error('更新协作修改状态失败：' + error.message)
  await requireSupabaseClient().from('companion_shared_activities').insert({
    activity_type: status === 'applied' ? 'applied_change' : 'rejected_change',
    body: message,
    shared_trip_id: mutation.sharedTripId,
  })
}

function sanitizeSharedItem(item: ItineraryItem, ticketIds: Set<string>): SharedItineraryItem {
  const rest = { ...item } as Omit<ItineraryItem, 'contentEnrichment' | 'ticketIds'> & {
    contentEnrichment?: ItineraryItem['contentEnrichment']
    ticketIds?: string[]
  }
  const itemTicketIds = rest.ticketIds ?? []
  delete rest.contentEnrichment
  delete rest.ticketIds
  return {
    ...rest,
    ticketSummaryIds: itemTicketIds.filter((ticketId) => ticketIds.has(ticketId)),
  }
}

function sanitizeItemPatch(input: unknown): Partial<ItineraryItem> {
  const record = asRecord(input)
  const patch: Partial<ItineraryItem> = {}
  for (const key of [
    'address',
    'endTime',
    'locationName',
    'notes',
    'previousTransportMode',
    'startTime',
    'title',
    'transportMode',
  ] as const) {
    if (typeof record[key] === 'string') {
      const value = record[key].trim()
      if (value.length > 0 && value.length <= MAX_MUTATION_TEXT_LENGTH) {
        patch[key] = value as never
      }
    }
  }
  if (typeof record.previousTransportDurationMinutes === 'number' && Number.isFinite(record.previousTransportDurationMinutes)) {
    patch.previousTransportDurationMinutes = Math.max(0, Math.min(24 * 60, Math.round(record.previousTransportDurationMinutes)))
  }
  return patch
}

function readCompanionFixture(): CompanionFixture | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(CLOUD_FIXTURE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CompanionFixture
    return parsed.user ? parsed : null
  } catch {
    return null
  }
}

function writeCompanionFixture(fixture: CompanionFixture) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CLOUD_FIXTURE_KEY, JSON.stringify(fixture))
}

async function requireCompanionUser() {
  const fixture = readCompanionFixture()
  if (fixture?.user) return fixture.user
  const user = await getCurrentUser()
  if (!user) throw new Error('请先登录后使用同行共享。')
  return { email: user.email, id: user.id }
}

function requireFixtureMember(fixture: CompanionFixture, sharedTripId: string, userId: string): SharedTripMember {
  const sharedTrip = (fixture.sharedTripRows ?? []).find((row) => row.id === sharedTripId)
  if (!sharedTrip) throw new Error('共享旅行不存在。')
  if (sharedTrip.ownerId === userId) return ownerAsMember(sharedTrip, fixture.user ?? { id: userId })
  const member = (fixture.sharedMemberRows ?? []).find((row) => row.sharedTripId === sharedTripId && row.userId === userId && !row.removedAt)
  if (!member) throw new Error('你还没有加入这趟共享旅行。')
  return member
}

function ownerAsMember(sharedTrip: SharedTrip, user: { email?: string; id: string }): SharedTripMember {
  return {
    displayName: user.email ?? '主人',
    email: user.email,
    joinedAt: sharedTrip.createdAt,
    ownerId: sharedTrip.ownerId,
    permission: 'collaborate',
    sharedTripId: sharedTrip.id,
    updatedAt: sharedTrip.updatedAt,
    userId: user.id,
  }
}

function mapSharedTripRow(row: SharedTripRow): SharedTrip {
  return {
    createdAt: row.created_at,
    id: row.id,
    ownerId: row.owner_id,
    projection: row.projection,
    projectionUpdatedAt: row.projection_updated_at,
    title: row.title,
    tripId: row.trip_id,
    updatedAt: row.updated_at,
  }
}

function mapInviteRow(row: SharedInviteRow): SharedTripInvite {
  return {
    createdAt: row.created_at,
    expiresAt: row.expires_at ?? undefined,
    id: row.id,
    ownerId: row.owner_id,
    permission: normalizePermission(row.permission),
    revokedAt: row.revoked_at ?? undefined,
    sharedTripId: row.shared_trip_id,
    status: row.status,
    tokenHash: row.token_hash,
    updatedAt: row.updated_at,
  }
}

function mapMemberRow(row: SharedMemberRow): SharedTripMember {
  return {
    displayName: row.display_name ?? undefined,
    email: row.email ?? undefined,
    joinedAt: row.joined_at,
    ownerId: row.owner_id,
    permission: normalizePermission(row.permission),
    removedAt: row.removed_at ?? undefined,
    sharedTripId: row.shared_trip_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
  }
}

function mapCommentRow(row: SharedCommentRow): SharedTripComment {
  return {
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at ?? undefined,
    displayName: row.display_name ?? undefined,
    id: row.id,
    itemId: row.item_id,
    sharedTripId: row.shared_trip_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
  }
}

function mapConfirmationRow(row: SharedConfirmationRow): SharedTripMeetingConfirmation {
  return {
    confirmedAt: row.confirmed_at,
    displayName: row.display_name ?? undefined,
    itemId: row.item_id,
    note: row.note ?? undefined,
    sharedTripId: row.shared_trip_id,
    updatedAt: row.updated_at,
    userId: row.user_id,
  }
}

function mapActivityRow(row: SharedActivityRow): SharedTripActivity {
  return {
    activityType: row.activity_type,
    body: row.body ?? undefined,
    createdAt: row.created_at,
    displayName: row.display_name ?? undefined,
    id: row.id,
    itemId: row.item_id ?? undefined,
    sharedTripId: row.shared_trip_id,
    userId: row.user_id ?? undefined,
  }
}

function mapMutationRow(row: SharedMutationRow): SharedTripMutation {
  return {
    appliedAt: row.applied_at ?? undefined,
    createdAt: row.created_at,
    displayName: row.display_name ?? undefined,
    id: row.id,
    mutationType: row.mutation_type,
    payload: row.payload,
    rejectedReason: row.rejected_reason ?? undefined,
    sharedTripId: row.shared_trip_id,
    status: row.status,
    updatedAt: row.updated_at,
    userId: row.user_id,
  }
}

function normalizePermission(value: unknown): CompanionPermission {
  return value === 'collaborate' || value === 'comment' || value === 'read' ? value : 'read'
}

function upsertById<T extends { id: string }>(rows: T[], next: T) {
  const without = rows.filter((row) => row.id !== next.id)
  return [next, ...without]
}

function upsertMember(rows: SharedTripMember[], next: SharedTripMember) {
  return [
    next,
    ...rows.filter((row) => row.sharedTripId !== next.sharedTripId || row.userId !== next.userId),
  ]
}

function upsertConfirmation(rows: SharedTripMeetingConfirmation[], next: SharedTripMeetingConfirmation) {
  return [
    next,
    ...rows.filter((row) =>
      row.sharedTripId !== next.sharedTripId || row.itemId !== next.itemId || row.userId !== next.userId,
    ),
  ]
}

function buildFixtureActivity(
  sharedTripId: string,
  userId: string | undefined,
  activityType: CompanionActivityType,
  body: string,
  displayName?: string,
  itemId?: string,
): SharedTripActivity {
  return {
    activityType,
    body,
    createdAt: new Date().toISOString(),
    displayName,
    id: createId('shared_activity'),
    itemId,
    sharedTripId,
    userId,
  }
}

function sortInvites(rows: SharedTripInvite[]) {
  return [...rows].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
}

function sortMembers(rows: SharedTripMember[]) {
  return [...rows].sort((first, second) => Date.parse(second.joinedAt) - Date.parse(first.joinedAt))
}

function sortComments(rows: SharedTripComment[]) {
  return [...rows].sort((first, second) => Date.parse(first.createdAt) - Date.parse(second.createdAt))
}

function sortActivities(rows: SharedTripActivity[]) {
  return [...rows].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
}

function sortMutations(rows: SharedTripMutation[]) {
  return [...rows].sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt))
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function readString(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('缺少必要字段。')
  }
  return value.trim()
}

function readOptionalShortString(value: unknown) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= MAX_MUTATION_TEXT_LENGTH ? trimmed : undefined
}

function readOptionalLimitedText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, maxLength) : undefined
}

function readDisruptionKind(value: unknown): TripDisruptionEvent['kind'] | null {
  return value === 'delay' ||
    value === 'closure' ||
    value === 'weather_unsuitable' ||
    value === 'late' ||
    value === 'cancelled' ||
    value === 'skip'
    ? value
    : null
}

function base64UrlEncode(bytes: Uint8Array) {
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
