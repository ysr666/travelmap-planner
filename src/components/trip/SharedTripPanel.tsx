import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Copy, IdCard, Link2, Loader2, RefreshCw, Save, ShieldCheck, TicketCheck, UserRoundPlus, UsersRound, XCircle } from 'lucide-react'
import {
  createSharedTripInvite,
  getCompanionPermissionLabel,
  loadOwnerSharedTripState,
  normalizeSharedTripMemberProfile,
  normalizeTicketSharedVisibility,
  publishSharedTripFromLocal,
  removeSharedTripMember,
  revokeSharedTripInvite,
  subscribeToSharedTripRealtime,
  syncSharedTripForOwner,
  updateSharedTripMemberProfile,
  updateSharedTripMemberPermission,
  updateTicketSharedVisibility,
  type OwnerSharedTripState,
  type SharedTripTicketFileEvent,
} from '../../lib/companion'
import { navigateTo } from '../../lib/routes'
import { getTicketCategoryLabel, getTicketDisplayTitle } from '../../lib/tickets'
import { buildTripIntelligenceModel, type TripIntelligenceSuggestion } from '../../lib/tripIntelligence'
import { useTripIntelligencePersistence } from '../../hooks/useTripIntelligencePersistence'
import type { CompanionPermission, Day, ItineraryItem, SharedTripActivity, SharedTripMember, SharedTripMemberProfile, SharedTripMutation, TicketMeta, TicketSharedVisibility, Trip } from '../../types'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Collapsible } from '../ui/Collapsible'
import { RestoreTripIntelligenceSuggestionButton, TripIntelligenceSuggestionControls } from './TripIntelligenceSuggestionControls'

type SharedTripPanelProps = {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  tickets: TicketMeta[]
  trip: Trip
}

const permissionOptions: Array<{ label: string; value: CompanionPermission }> = [
  { label: '只读', value: 'read' },
  { label: '可评论', value: 'comment' },
  { label: '可协作', value: 'collaborate' },
]

export function SharedTripPanel({ days, itemsByDay, tickets, trip }: SharedTripPanelProps) {
  const [state, setState] = useState<OwnerSharedTripState | null>(null)
  const [invitePermission, setInvitePermission] = useState<CompanionPermission>('read')
  const [latestInviteUrl, setLatestInviteUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [memberProfileDrafts, setMemberProfileDrafts] = useState<Record<string, SharedTripMemberProfile>>({})
  const [ticketVisibilityDrafts, setTicketVisibilityDrafts] = useState<Record<string, TicketSharedVisibility>>({})
  const autoSyncAttemptedKeyRef = useRef('')
  const autoSyncInFlightRef = useRef(false)
  const autoPublishSnapshotKeyRef = useRef('')
  const autoPublishInFlightRef = useRef(false)
  const autoPublishMemberKeyRef = useRef<string | null>(null)
  const { restoreSuggestionState, setSuggestionState, suggestionStates } = useTripIntelligencePersistence(trip.id)

  const itemCount = useMemo(() => Object.values(itemsByDay).reduce((sum, items) => sum + items.length, 0), [itemsByDay])
  const pendingMutationCount = state?.configured && state.signedIn
    ? state.mutations.filter((mutation) => mutation.status === 'pending').length
    : 0
  const autoProcessableMutationKey = useMemo(() => {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return ''
    return state.mutations
      .filter((mutation) => mutation.status === 'pending' && mutation.mutationType !== 'request_replan_undo')
      .map((mutation) => `${mutation.id}:${mutation.updatedAt}`)
      .sort()
      .join('|')
  }, [state])
  const sharedTripIntelligenceModel = useMemo(() => buildTripIntelligenceModel({
    sharedMutations: state?.configured && state.signedIn ? state.mutations : [],
    suggestionStates,
  }), [state, suggestionStates])
  const sharedTripSuggestions = sharedTripIntelligenceModel.forSharedTrip()
  const hiddenSharedTripSuggestions = sharedTripIntelligenceModel.allSuggestions.filter((suggestion) =>
    suggestion.scope === 'shared_trip' && (suggestion.status === 'ignored' || suggestion.status === 'later'),
  )
  const memberProfileDraftsWithDefaults = useMemo(() => {
    if (!state?.configured || !state.signedIn) return {}
    const next: Record<string, SharedTripMemberProfile> = {}
    for (const member of state.members) {
      next[member.userId] = memberProfileDrafts[member.userId] ?? normalizeSharedTripMemberProfile(member.profile)
    }
    return next
  }, [memberProfileDrafts, state])
  const ticketVisibilityDraftsWithDefaults = useMemo(() => {
    const next: Record<string, TicketSharedVisibility> = {}
    for (const ticket of tickets) {
      next[ticket.id] = ticketVisibilityDrafts[ticket.id] ?? normalizeTicketSharedVisibility(ticket.sharedVisibility)
    }
    return next
  }, [ticketVisibilityDrafts, tickets])
  const ownerSnapshotKey = useMemo(() => buildOwnerSnapshotKey({ days, itemsByDay, tickets, trip }), [days, itemsByDay, tickets, trip])
  const activeMemberKey = useMemo(() => {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return ''
    return state.members
      .map((member) => member.userId)
      .sort()
      .join('|')
  }, [state])
  const memberRosterNeedsRefresh = useMemo(() => {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return false
    const projectedAt = Date.parse(state.sharedTrip.projectionUpdatedAt)
    return state.members.some((member) => Date.parse(member.joinedAt) > projectedAt)
  }, [state])
  const realtimeSharedTripId = state?.configured && state.signedIn ? state.sharedTrip?.id : undefined

  const refresh = useCallback(async () => {
    try {
      setState(await loadOwnerSharedTripState(trip.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取同行共享状态失败。')
    }
  }, [trip.id])

  useEffect(() => {
    let cancelled = false
    void loadOwnerSharedTripState(trip.id)
      .then((nextState) => { if (!cancelled) setState(nextState) })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : '读取同行共享状态失败。') })
    return () => { cancelled = true }
  }, [trip.id])

  useEffect(() => {
    if (!realtimeSharedTripId) return undefined
    return subscribeToSharedTripRealtime(realtimeSharedTripId, () => void refresh())
  }, [realtimeSharedTripId, refresh])

  useEffect(() => {
    if (!autoProcessableMutationKey || autoSyncInFlightRef.current) return undefined
    if (autoSyncAttemptedKeyRef.current === autoProcessableMutationKey) return undefined
    autoSyncAttemptedKeyRef.current = autoProcessableMutationKey
    autoSyncInFlightRef.current = true
    let cancelled = false
    setBusy('auto-sync')
    setError(null)
    setMessage(null)
    void syncSharedTripForOwner(trip.id)
      .then((result) => {
        if (cancelled) return
        const pendingReview = result.pendingReview ?? 0
        setMessage(`已自动处理同行更改：应用 ${result.applied} 项，需主人确认 ${pendingReview} 项，冲突 ${result.conflicts} 项。`)
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '自动处理同行更改失败。')
      })
      .finally(() => {
        autoSyncInFlightRef.current = false
        if (!cancelled) {
          void refresh().finally(() => setBusy(null))
        }
      })
    return () => {
      cancelled = true
    }
  }, [autoProcessableMutationKey, refresh, trip.id])

  useEffect(() => {
    if (!state?.configured || !state.signedIn || !state.sharedTrip || !ownerSnapshotKey) return undefined
    if (!autoPublishSnapshotKeyRef.current) {
      autoPublishSnapshotKeyRef.current = ownerSnapshotKey
      return undefined
    }
    if (autoPublishSnapshotKeyRef.current === ownerSnapshotKey || autoPublishInFlightRef.current) return undefined

    let cancelled = false
    const nextSnapshotKey = ownerSnapshotKey
    const timer = window.setTimeout(() => {
      if (cancelled) return
      autoPublishInFlightRef.current = true
      setBusy('auto-publish')
      setError(null)
      setMessage(null)
      void publishSharedTripFromLocal(trip.id)
        .then(() => {
          autoPublishSnapshotKeyRef.current = nextSnapshotKey
          if (!cancelled) setMessage('主人更新已自动同步到同行共享。')
        })
        .catch((caught) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : '自动同步主人更新失败。')
        })
        .finally(() => {
          autoPublishInFlightRef.current = false
          if (!cancelled) {
            void refresh().finally(() => setBusy(null))
          }
        })
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [ownerSnapshotKey, refresh, state, trip.id])

  useEffect(() => {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return undefined
    const initialRefresh = autoPublishMemberKeyRef.current === null && memberRosterNeedsRefresh
    if (autoPublishMemberKeyRef.current === null) {
      autoPublishMemberKeyRef.current = activeMemberKey
      if (!memberRosterNeedsRefresh) return undefined
    }
    if (autoPublishInFlightRef.current) return undefined
    if (!initialRefresh && autoPublishMemberKeyRef.current === activeMemberKey) return undefined

    let cancelled = false
    const nextMemberKey = activeMemberKey
    const timer = window.setTimeout(() => {
      if (cancelled) return
      autoPublishInFlightRef.current = true
      setBusy('auto-publish')
      setError(null)
      setMessage(null)
      void publishSharedTripFromLocal(trip.id)
        .then(() => {
          autoPublishMemberKeyRef.current = nextMemberKey
          if (!cancelled) setMessage('同行成员变化已自动同步票据授权。')
        })
        .catch((caught) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : '自动同步同行授权失败。')
        })
        .finally(() => {
          autoPublishInFlightRef.current = false
          if (!cancelled) {
            void refresh().finally(() => setBusy(null))
          }
        })
    }, 800)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [activeMemberKey, memberRosterNeedsRefresh, refresh, state, trip.id])

  async function runAction(key: string, action: () => Promise<void>) {
    setBusy(key)
    setError(null)
    setMessage(null)
    try {
      await action()
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '同行共享操作失败。')
    } finally {
      setBusy(null)
    }
  }

  async function handlePublish() {
    await runAction('publish', async () => {
      await publishSharedTripFromLocal(trip.id)
      setMessage('已更新同行共享版本，并同步票据原件授权。')
    })
  }

  async function handleCreateInvite() {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return
    setLatestInviteUrl('')
    await runAction('invite', async () => {
      const result = await createSharedTripInvite({
        permission: invitePermission,
        sharedTripId: state.sharedTrip!.id,
      })
      setLatestInviteUrl(result.url)
      setMessage(`已生成${getCompanionPermissionLabel(invitePermission)}链接。`)
    })
  }

  async function handleCopyInvite() {
    if (!latestInviteUrl || !navigator.clipboard) return
    await navigator.clipboard.writeText(latestInviteUrl)
    setMessage('共享链接已复制。')
  }

  async function handleSync() {
    await runAction('sync', async () => {
      const result = await syncSharedTripForOwner(trip.id)
      const pendingReview = result.pendingReview ?? 0
      setMessage(`同行同步完成：应用 ${result.applied} 项，需主人确认 ${pendingReview} 项，冲突 ${result.conflicts} 项；共享视图和票据授权已自动刷新。`)
    })
  }

  function updateMemberProfileDraft(userId: string, base: SharedTripMemberProfile, patch: Partial<SharedTripMemberProfile>) {
    setMemberProfileDrafts((current) => ({
      ...current,
      [userId]: normalizeSharedTripMemberProfile({
        ...base,
        ...(current[userId] ?? {}),
        ...patch,
      }),
    }))
  }

  function updateTicketVisibilityDraft(ticketId: string, nextVisibility: TicketSharedVisibility) {
    setTicketVisibilityDrafts((current) => ({
      ...current,
      [ticketId]: nextVisibility.mode === 'assigned'
        ? { memberIds: [...new Set(nextVisibility.memberIds)], mode: 'assigned' }
        : { mode: 'all' },
    }))
  }

  async function handleSaveMemberProfile(member: SharedTripMember) {
    if (!state?.configured || !state.signedIn || !state.sharedTrip) return
    await runAction(`profile:${member.userId}`, async () => {
      await updateSharedTripMemberProfile(state.sharedTrip!.id, member.userId, memberProfileDraftsWithDefaults[member.userId] ?? {})
      setMessage('同行资料已保存。')
    })
  }

  async function handleSaveTicketVisibility(ticket: TicketMeta) {
    await runAction(`ticket:${ticket.id}`, async () => {
      await updateTicketSharedVisibility(ticket.id, ticketVisibilityDraftsWithDefaults[ticket.id] ?? { mode: 'all' })
      await publishSharedTripFromLocal(trip.id)
      setMessage(`「${getTicketDisplayTitle(ticket)}」的同行可见性已保存，并已自动同步共享版本。`)
    })
  }

  function handleSharedTripSuggestion(suggestion: TripIntelligenceSuggestion) {
    if (suggestion.action?.kind === 'open_adaptive_replan') {
      setError(null)
      setMessage('撤销重排请求需要在 Live Mode / 重排记录中确认，当前不会自动撤销。')
      return
    }
    const mutation = state?.configured && state.signedIn
      ? state.mutations.find((entry) => entry.id === suggestion.source.id)
      : undefined
    if (mutation?.status === 'pending' && mutation.mutationType !== 'request_replan_undo') {
      void handleSync()
      return
    }
    setError(null)
    setMessage('请在下方协作修改记录中查看处理状态；不会自动重放已冲突或未应用的更改。')
  }

  return (
    <Card className="space-y-4" data-testid="shared-trip-panel" id="shared-trip-panel" variant="grouped">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <UsersRound className="size-4" />
            </span>
            <h3 className="text-base font-semibold text-on-surface">同行共享</h3>
          </div>
          <p className="mt-1 text-xs leading-5 tm-muted">
            同行动态通过实时通道刷新；票据和同行资料可按成员精确授权，保存分配后会自动更新共享版本和原件授权。同行提交的普通修改会自动进入主人端处理流并回写共享视图，需主人判断的请求仍保留确认入口。
          </p>
        </div>
        {state?.configured && state.signedIn && state.sharedTrip ? (
          <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
            已开启
          </span>
        ) : null}
      </div>

      {!state ? (
        <div className="flex items-center gap-2 rounded-lg bg-surface-container-high/60 px-3 py-2 text-xs tm-muted">
          <Loader2 className="size-3.5 animate-spin" />
          正在读取共享状态
        </div>
      ) : null}

      {state && !state.configured ? (
        <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <p className="text-sm font-semibold text-on-surface">需要先配置 Supabase</p>
          <p className="text-xs leading-5 tm-muted">缺少 {state.missing.join('、')}。同行共享不会使用旧版个人云备份表。</p>
          <Button onClick={() => navigateTo('settings', { section: 'cloud' })} variant="secondary">前往设置</Button>
        </div>
      ) : null}

      {state?.configured && !state.signedIn ? (
        <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
          <p className="text-sm font-semibold text-on-surface">登录后才能管理共享</p>
          <p className="text-xs leading-5 tm-muted">同行成员、留言和协作修改都绑定账号身份。</p>
          <Button onClick={() => navigateTo('settings', { section: 'cloud' })} variant="secondary">前往登录</Button>
        </div>
      ) : null}

      {state?.configured && state.signedIn ? (
        <>
          <div className="grid gap-2 text-xs sm:grid-cols-3">
            <SummaryCell label="共享天数" value={`${days.length} 天`} />
            <SummaryCell label="行程点" value={`${itemCount} 个`} />
            <SummaryCell label="可分配票据" value={`${tickets.length} 条`} />
          </div>

          {sharedTripSuggestions.length > 0 || hiddenSharedTripSuggestions.length > 0 ? (
            <SharedTripIntelligencePanel
              hiddenSuggestions={hiddenSharedTripSuggestions}
              onAction={handleSharedTripSuggestion}
              onIgnore={(suggestion) => void setSuggestionState({ status: 'ignored', suggestion })}
              onLater={(suggestion) => void setSuggestionState({ status: 'later', suggestion })}
              onRestore={(suggestion) => void restoreSuggestionState(suggestion.key)}
              suggestions={sharedTripSuggestions}
            />
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              icon={busy === 'publish' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              loading={busy === 'publish'}
              onClick={() => void handlePublish()}
              variant={state.sharedTrip ? 'secondary' : 'primary'}
            >
              {state.sharedTrip ? '更新共享版本' : '开启同行共享'}
            </Button>
            {state.sharedTrip ? (
              <Button
                disabled={busy === 'sync' || busy === 'auto-sync'}
                icon={busy === 'sync' || busy === 'auto-sync' || busy === 'auto-publish' ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                onClick={() => void handleSync()}
                variant="secondary"
              >
                {busy === 'auto-sync'
                  ? '自动处理同行更改中'
                  : busy === 'auto-publish'
                    ? '自动同步主人更新中'
                    : `处理同行更改${pendingMutationCount ? `（${pendingMutationCount}）` : ''}`}
              </Button>
            ) : null}
          </div>

          {state.sharedTrip ? (
            <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-36 flex-1 text-xs font-semibold text-on-surface-variant">
                  新链接权限
                  <select
                    className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface"
                    onChange={(event) => setInvitePermission(event.currentTarget.value as CompanionPermission)}
                    value={invitePermission}
                  >
                    {permissionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <Button
                  icon={<UserRoundPlus className="size-4" />}
                  loading={busy === 'invite'}
                  onClick={() => void handleCreateInvite()}
                  variant="secondary"
                >
                  生成链接
                </Button>
              </div>
              {latestInviteUrl ? (
                <div className="space-y-2 rounded-lg bg-surface px-3 py-2">
                  <p className="break-all text-xs text-on-surface-variant">{latestInviteUrl}</p>
                  <Button icon={<Copy className="size-4" />} onClick={() => void handleCopyInvite()} variant="ghost">复制链接</Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {state.sharedTrip ? (
            <>
              <Collapsible title={`同行人（${state.members.length}）`}>
                <div className="space-y-2" data-testid="shared-trip-members">
                  {state.members.length === 0 ? <p className="text-xs tm-muted">还没有同行人加入。</p> : null}
                  {state.members.map((member) => {
                    const draft = memberProfileDraftsWithDefaults[member.userId] ?? {}
                    return (
                      <MemberProfileCard
                        busy={busy}
                        draft={draft}
                        key={member.userId}
                        member={member}
                        onChange={(patch) => updateMemberProfileDraft(member.userId, draft, patch)}
                        onPermissionChange={(permission) => void runAction(`member:${member.userId}`, () =>
                          updateSharedTripMemberPermission(state.sharedTrip!.id, member.userId, permission),
                        )}
                        onRemove={() => void runAction(`remove:${member.userId}`, () => removeSharedTripMember(state.sharedTrip!.id, member.userId))}
                        onSave={() => void handleSaveMemberProfile(member)}
                      />
                    )
                  })}
                </div>
              </Collapsible>

              <Collapsible title={`票据分配（${tickets.length}）`}>
                <TicketAssignmentList
                  busy={busy}
                  members={state.members}
                  onChange={updateTicketVisibilityDraft}
                  onSave={(ticket) => void handleSaveTicketVisibility(ticket)}
                  tickets={tickets}
                  visibilityDrafts={ticketVisibilityDraftsWithDefaults}
                />
              </Collapsible>

              <Collapsible title={`共享链接（${state.invites.length}）`}>
                <div className="space-y-2" data-testid="shared-trip-invites">
                  {state.invites.length === 0 ? <p className="text-xs tm-muted">还没有可用链接。</p> : null}
                  {state.invites.map((invite) => (
                    <div className="flex items-center gap-2 rounded-lg bg-surface-container-low px-3 py-2" key={invite.id}>
                      <Link2 className="size-4 shrink-0 text-on-surface-variant" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-on-surface">{getCompanionPermissionLabel(invite.permission)}</p>
                        <p className="text-xs tm-muted">{invite.status === 'active' ? '可用' : '已撤销'} · {formatDateTime(invite.createdAt)}</p>
                      </div>
                      {invite.status === 'active' ? (
                        <Button onClick={() => void runAction(`invite:${invite.id}`, () => revokeSharedTripInvite(invite.id))} variant="ghost">
                          撤销
                        </Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Collapsible>

              <Collapsible title={`同行人动态（${state.activities.length}）`}>
                <ActivityList activities={state.activities} />
              </Collapsible>

              <Collapsible title={`票据原件审计（${state.ticketFileEvents.length}）`}>
                <TicketFileAuditList events={state.ticketFileEvents} />
              </Collapsible>

              <Collapsible title={`协作修改（${state.mutations.length}）`}>
                <MutationList mutations={state.mutations} />
              </Collapsible>
            </>
          ) : null}
        </>
      ) : null}

      {message ? (
        <p className="flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 size-3.5" />
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-500/10 dark:text-red-300" data-testid="shared-trip-error">
          {error}
        </p>
      ) : null}
    </Card>
  )
}

function SummaryCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-high/60 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase text-on-surface-variant">{label}</p>
      <p className="mt-1 text-sm font-semibold text-on-surface">{value}</p>
    </div>
  )
}

function buildOwnerSnapshotKey({
  days,
  itemsByDay,
  tickets,
  trip,
}: {
  days: Day[]
  itemsByDay: Record<string, ItineraryItem[]>
  tickets: TicketMeta[]
  trip: Trip
}) {
  const itemKey = Object.values(itemsByDay)
    .flat()
    .map((item) => [
      item.id,
      item.dayId,
      item.sortOrder,
      item.updatedAt,
      item.ticketIds.join(','),
    ].join(':'))
    .sort()
    .join('|')
  const dayKey = [...days]
    .map((day) => [day.id, day.date, day.sortOrder, day.title, day.timeZone ?? ''].join(':'))
    .sort()
    .join('|')
  const ticketKey = [...tickets]
    .map((ticket) => {
      const visibility = normalizeTicketSharedVisibility(ticket.sharedVisibility)
      return [
        ticket.id,
        ticket.itemId ?? '',
        ticket.scope ?? '',
        ticket.storageMode ?? '',
        ticket.updatedAt,
        visibility.mode === 'assigned'
          ? `assigned:${[...visibility.memberIds].sort().join(',')}`
          : 'all',
      ].join(':')
    })
    .sort()
    .join('|')
  return [
    trip.id,
    trip.updatedAt,
    dayKey,
    itemKey,
    ticketKey,
  ].join('\n')
}

function MemberProfileCard({
  busy,
  draft,
  member,
  onChange,
  onPermissionChange,
  onRemove,
  onSave,
}: {
  busy: string | null
  draft: SharedTripMemberProfile
  member: SharedTripMember
  onChange: (patch: Partial<SharedTripMemberProfile>) => void
  onPermissionChange: (permission: CompanionPermission) => void
  onRemove: () => void
  onSave: () => void
}) {
  return (
    <div className="space-y-3 rounded-lg bg-surface-container-low px-3 py-3" data-testid="shared-trip-member-card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-on-surface">{member.displayName || member.email || '同行人'}</p>
          <p className="text-xs tm-muted">{member.email || member.userId}</p>
        </div>
        <select
          className="min-h-11 rounded-lg border border-outline-variant/40 bg-surface px-2 text-xs font-semibold"
          onChange={(event) => onPermissionChange(event.currentTarget.value as CompanionPermission)}
          value={member.permission}
        >
          {permissionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <Button icon={<XCircle className="size-4" />} onClick={onRemove} variant="ghost">
          移除
        </Button>
      </div>

      <div className="flex items-center gap-2 text-xs font-semibold text-on-surface-variant">
        <IdCard className="size-4 text-primary" />
        同行资料
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <ProfileInput label="证件姓名" onChange={(value) => onChange({ legalName: value })} value={draft.legalName ?? ''} />
        <ProfileInput label="生日" onChange={(value) => onChange({ birthday: value })} type="date" value={draft.birthday ?? ''} />
        <ProfileInput label="护照" onChange={(value) => onChange({ passport: value })} value={draft.passport ?? ''} />
        <ProfileInput label="签证" onChange={(value) => onChange({ visa: value })} value={draft.visa ?? ''} />
        <ProfileInput label="保险" onChange={(value) => onChange({ insurance: value })} value={draft.insurance ?? ''} />
        <ProfileInput label="身份证件" onChange={(value) => onChange({ identityDocument: value })} value={draft.identityDocument ?? ''} />
        <ProfileInput label="座位" onChange={(value) => onChange({ seat: value })} value={draft.seat ?? ''} />
        <ProfileInput label="房间" onChange={(value) => onChange({ room: value })} value={draft.room ?? ''} />
        <ProfileInput label="紧急联系人" onChange={(value) => onChange({ emergencyContact: value })} value={draft.emergencyContact ?? ''} />
      </div>
      <label className="block text-xs font-semibold text-on-surface-variant">
        同行备注
        <textarea
          className="mt-1 min-h-20 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface"
          onChange={(event) => onChange({ notes: event.currentTarget.value })}
          value={draft.notes ?? ''}
        />
      </label>
      <Button
        disabled={busy === `profile:${member.userId}`}
        icon={busy === `profile:${member.userId}` ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
        onClick={onSave}
        variant="secondary"
      >
        保存资料
      </Button>
    </div>
  )
}

function ProfileInput({
  label,
  onChange,
  type = 'text',
  value,
}: {
  label: string
  onChange: (value: string) => void
  type?: string
  value: string
}) {
  return (
    <label className="block text-xs font-semibold text-on-surface-variant">
      {label}
      <input
        className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface"
        onChange={(event) => onChange(event.currentTarget.value)}
        type={type}
        value={value}
      />
    </label>
  )
}

function TicketAssignmentList({
  busy,
  members,
  onChange,
  onSave,
  tickets,
  visibilityDrafts,
}: {
  busy: string | null
  members: SharedTripMember[]
  onChange: (ticketId: string, visibility: TicketSharedVisibility) => void
  onSave: (ticket: TicketMeta) => void
  tickets: TicketMeta[]
  visibilityDrafts: Record<string, TicketSharedVisibility>
}) {
  return (
    <div className="space-y-2" data-testid="shared-trip-ticket-assignments">
      {tickets.length === 0 ? <p className="text-xs tm-muted">还没有票据可分配。</p> : null}
      {tickets.map((ticket) => {
        const visibility = visibilityDrafts[ticket.id] ?? normalizeTicketSharedVisibility(ticket.sharedVisibility)
        const selectedIds = visibility.mode === 'assigned' ? new Set(visibility.memberIds) : new Set<string>()
        return (
          <div className="space-y-3 rounded-lg bg-surface-container-low px-3 py-3" data-testid="shared-trip-ticket-assignment" key={ticket.id}>
            <div className="flex items-start gap-2">
              <TicketCheck className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-semibold text-on-surface">{getTicketDisplayTitle(ticket)}</p>
                <p className="text-xs tm-muted">{getTicketCategoryLabel(ticket)} · {ticket.fileType.toUpperCase()}</p>
              </div>
            </div>
            <label className="block text-xs font-semibold text-on-surface-variant">
              共享给
              <select
                className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface"
                onChange={(event) => {
                  if (event.currentTarget.value === 'assigned') {
                    onChange(ticket.id, { memberIds: visibility.mode === 'assigned' ? visibility.memberIds : [], mode: 'assigned' })
                    return
                  }
                  onChange(ticket.id, { mode: 'all' })
                }}
                value={visibility.mode}
              >
                <option value="all">所有同行</option>
                <option value="assigned">指定同行</option>
              </select>
            </label>
            {visibility.mode === 'assigned' ? (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {members.length === 0 ? <p className="text-xs tm-muted">还没有同行人可选择。</p> : null}
                  {members.map((member) => {
                    const checked = selectedIds.has(member.userId)
                    return (
                      <label className="flex min-h-11 items-center gap-2 rounded-lg bg-surface px-3 text-xs font-semibold text-on-surface-variant" key={member.userId}>
                        <input
                          checked={checked}
                          onChange={(event) => {
                            const nextIds = event.currentTarget.checked
                              ? [...selectedIds, member.userId]
                              : [...selectedIds].filter((id) => id !== member.userId)
                            onChange(ticket.id, { memberIds: nextIds, mode: 'assigned' })
                          }}
                          type="checkbox"
                        />
                        <span className="min-w-0 truncate">{member.displayName || member.email || member.userId}</span>
                      </label>
                    )
                  })}
                </div>
                {selectedIds.size === 0 ? (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-200">
                    当前不会共享给任何同行。
                  </p>
                ) : null}
              </>
            ) : null}
            <Button
              disabled={busy === `ticket:${ticket.id}`}
              icon={busy === `ticket:${ticket.id}` ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              onClick={() => onSave(ticket)}
              variant="secondary"
            >
              保存分配
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function SharedTripIntelligencePanel({
  hiddenSuggestions,
  onAction,
  onIgnore,
  onLater,
  onRestore,
  suggestions,
}: {
  hiddenSuggestions: TripIntelligenceSuggestion[]
  onAction: (suggestion: TripIntelligenceSuggestion) => void
  onIgnore: (suggestion: TripIntelligenceSuggestion) => void
  onLater: (suggestion: TripIntelligenceSuggestion) => void
  onRestore: (suggestion: TripIntelligenceSuggestion) => void
  suggestions: TripIntelligenceSuggestion[]
}) {
  return (
    <div className="space-y-2 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3" data-testid="shared-trip-intelligence-panel">
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-on-surface">同行待处理</h4>
        <span className="text-xs font-semibold text-primary">{suggestions.length} 项</span>
      </div>
      {suggestions.map((suggestion) => (
        <div className="flex min-h-11 items-center gap-1 rounded-lg bg-surface px-1" key={suggestion.id}>
          <button className="flex min-h-11 min-w-0 flex-1 items-start gap-3 px-2 py-2 text-left tm-focus" data-testid="shared-trip-intelligence-action" onClick={() => onAction(suggestion)} type="button">
            <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${suggestion.severity === 'high' ? 'text-red-600' : 'text-amber-600'}`} />
            <span className="min-w-0 flex-1">
              <span className="block break-words text-sm font-semibold text-on-surface [overflow-wrap:anywhere]">{suggestion.title}</span>
              <span className="mt-0.5 block break-words text-xs leading-5 tm-muted [overflow-wrap:anywhere]">{suggestion.message}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-primary">{suggestion.action?.label ?? '查看'}</span>
          </button>
          <TripIntelligenceSuggestionControls onIgnore={onIgnore} onLater={onLater} suggestion={suggestion} />
        </div>
      ))}
      {hiddenSuggestions.length > 0 ? (
        <details className="rounded-lg border border-outline-variant/20 px-3 py-2">
          <summary className="cursor-pointer text-xs font-semibold tm-muted">已隐藏同行建议（{hiddenSuggestions.length}）</summary>
          <div className="mt-2 space-y-1">
            {hiddenSuggestions.map((suggestion) => (
              <div className="flex min-h-11 items-center justify-between gap-2" key={suggestion.key}>
                <span className="min-w-0 truncate text-xs tm-muted">{suggestion.title}</span>
                <RestoreTripIntelligenceSuggestionButton onRestore={onRestore} suggestion={suggestion} />
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  )
}

function ActivityList({ activities }: { activities: SharedTripActivity[] }) {
  return (
    <div className="space-y-2" data-testid="shared-trip-activity">
      {activities.length === 0 ? <p className="text-xs tm-muted">还没有同行人动态。</p> : null}
      {activities.map((activity) => (
        <div className="rounded-lg bg-surface-container-low px-3 py-2" key={activity.id}>
          <p className="text-sm font-semibold text-on-surface">{activity.displayName || '同行人'}</p>
          <p className="mt-0.5 text-xs leading-5 tm-muted">{formatActivity(activity)}</p>
          <p className="mt-1 text-[11px] font-semibold text-on-surface-variant">{formatDateTime(activity.createdAt)}</p>
        </div>
      ))}
    </div>
  )
}

function TicketFileAuditList({ events }: { events: SharedTripTicketFileEvent[] }) {
  return (
    <div className="space-y-2" data-testid="shared-trip-ticket-file-audit">
      {events.length === 0 ? <p className="text-xs tm-muted">还没有票据原件授权或打开记录。</p> : null}
      {events.map((event) => (
        <div className="rounded-lg bg-surface-container-low px-3 py-2" key={event.id}>
          <p className="text-sm font-semibold text-on-surface">{ticketFileEventLabel(event.eventType)}</p>
          <p className="mt-0.5 break-words text-xs leading-5 tm-muted">
            {event.fileName || event.ticketId} · 同行 {event.userId}
          </p>
          <p className="mt-1 text-[11px] font-semibold text-on-surface-variant">{formatDateTime(event.createdAt)}</p>
        </div>
      ))}
    </div>
  )
}

function MutationList({ mutations }: { mutations: SharedTripMutation[] }) {
  return (
    <div className="space-y-2" data-testid="shared-trip-mutations">
      {mutations.length === 0 ? <p className="text-xs tm-muted">还没有协作修改。</p> : null}
      {mutations.map((mutation) => (
        <div className="rounded-lg bg-surface-container-low px-3 py-2" key={mutation.id}>
          <p className="text-sm font-semibold text-on-surface">{mutationTypeLabel(mutation.mutationType)}</p>
          <p className="mt-0.5 text-xs leading-5 tm-muted">{mutationStatusLabel(mutation.status)} · {formatDateTime(mutation.createdAt)}</p>
        </div>
      ))}
    </div>
  )
}

function formatActivity(activity: { activityType: string; body?: string }) {
  if (activity.body) return activity.body
  if (activity.activityType === 'viewed') return '查看了共享旅行'
  if (activity.activityType === 'commented') return '留下了留言'
  if (activity.activityType === 'confirmed_meeting') return '确认了集合时间'
  if (activity.activityType === 'submitted_change') return '提交了协作修改'
  if (activity.activityType === 'applied_change') return '修改已应用'
  if (activity.activityType === 'rejected_change') return '修改未应用'
  if (activity.activityType === 'published') return '更新了共享行程'
  return '更新了同行动态'
}

function mutationTypeLabel(type: SharedTripMutation['mutationType']) {
  if (type === 'create_item') return '新增行程'
  if (type === 'delete_item') return '删除行程'
  if (type === 'reorder_day_items') return '调整顺序'
  if (type === 'report_disruption') return '突发报告'
  if (type === 'request_replan_undo') return '撤销重排请求'
  if (type === 'update_item_execution_state') return '现场状态更新'
  return '行程修改'
}

function mutationStatusLabel(status: SharedTripMutation['status']) {
  if (status === 'applied') return '已应用'
  if (status === 'conflict') return '存在冲突'
  if (status === 'rejected') return '未应用'
  return '待处理'
}

function ticketFileEventLabel(type: SharedTripTicketFileEvent['eventType']) {
  if (type === 'grant_synced') return '已授权票据原件'
  if (type === 'grant_revoked') return '已撤销票据原件授权'
  return '打开了票据原件'
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date)
}
