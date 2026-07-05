import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarDays, Check, Clock3, Download, ExternalLink, IdCard, Loader2, MessageCircle, Navigation, Plus, ShieldCheck, Ticket, UsersRound, X } from 'lucide-react'
import {
  addSharedTripComment,
  canCompanionCollaborate,
  canCompanionComment,
  claimSharedTripInvite,
  confirmSharedTripMeeting,
  getCompanionPermissionLabel,
  hasCompanionSession,
  loadCompanionSharedTrip,
  openSharedTripTicketFile,
  recordSharedTripView,
  submitSharedTripMutation,
  subscribeToSharedTripRealtime,
  type CompanionSharedTripBundle,
} from '../lib/companion'
import { getCurrentSession, signInWithEmailOtp, verifyEmailOtp } from '../lib/cloudBackup'
import { getSupabaseConfigStatus } from '../lib/supabaseClient'
import { describeItemTime, describePreviousTransport, sortItineraryItems } from '../lib/itinerary'
import { buildGoogleMapsDirectionsUrl } from '../lib/mapLinks'
import { getRouteParams, navigateTo } from '../lib/routes'
import { buildTripLiveModel } from '../lib/tripLiveMode'
import { getZonedPlainDate, resolveDayTimeZone } from '../lib/timeZone'
import { useLiveClock } from '../hooks/useLiveClock'
import type {
  CompanionPermission,
  ItineraryItem,
  SharedItineraryItem,
  SharedTripMemberProfile,
  SharedTicketSummary,
  SharedTripComment,
  TicketMeta,
} from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'

type SharedTicketFilePreviewState = {
  fileName: string
  mimeType: string
  objectUrl: string
  title: string
}

export function SharedTripPage() {
  const params = getRouteParams()
  const inviteToken = params.get('invite') ?? ''
  const sharedTripId = params.get('sharedTripId') ?? ''
  const [bundle, setBundle] = useState<CompanionSharedTripBundle | null>(null)
  const [sessionReady, setSessionReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filePreview, setFilePreview] = useState<SharedTicketFilePreviewState | null>(null)
  const [openingTicketId, setOpeningTicketId] = useState<string | null>(null)
  const viewRecordedRef = useRef('')

  const refresh = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const configured = getSupabaseConfigStatus()
      if (!configured.configured) {
        setSessionReady(false)
        setBundle(null)
        setError(`同行共享需要 Supabase 配置：${configured.missing.join('、')}`)
        return
      }

      const hasSession = await hasCompanionSession()
      setSessionReady(hasSession)
      if (!hasSession) {
        setBundle(null)
        return
      }

      if (inviteToken) {
        const result = await claimSharedTripInvite(inviteToken)
        navigateTo('shared-trip', { sharedTripId: result.sharedTripId })
        return
      }

      if (!sharedTripId) {
        setBundle(null)
        setError('缺少共享旅行链接。')
        return
      }

      const nextBundle = await loadCompanionSharedTrip(sharedTripId)
      setBundle(nextBundle)
      if (viewRecordedRef.current !== sharedTripId) {
        viewRecordedRef.current = sharedTripId
        void recordSharedTripView(sharedTripId).catch(() => undefined)
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打开共享旅行失败。')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [inviteToken, sharedTripId])

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timeout)
  }, [refresh])

  useEffect(() => {
    if (!bundle?.sharedTrip.id) return undefined
    return subscribeToSharedTripRealtime(bundle.sharedTrip.id, () => void refresh({ silent: true }))
  }, [bundle?.sharedTrip.id, refresh])

  useEffect(() => {
    return () => {
      if (filePreview?.objectUrl) URL.revokeObjectURL(filePreview.objectUrl)
    }
  }, [filePreview?.objectUrl])

  async function handleAuthenticated() {
    const session = await getCurrentSession().catch(() => null)
    setSessionReady(Boolean(session))
    await refresh()
  }

  async function handleOpenTicketFile(ticket: SharedTicketSummary) {
    if (!bundle) return
    setOpeningTicketId(ticket.id)
    setError(null)
    try {
      const file = await openSharedTripTicketFile(bundle.sharedTrip.id, ticket.id)
      setFilePreview({
        fileName: file.fileName,
        mimeType: file.mimeType,
        objectUrl: URL.createObjectURL(file.blob),
        title: file.title,
      })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '打开票据原件失败。')
    } finally {
      setOpeningTicketId(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (!sessionReady) {
    return (
      <div className="space-y-4">
        <SharedTripHeader title="同行共享" subtitle="登录后查看主人分享的旅行。" />
        <SharedTripLoginPanel inviteToken={inviteToken} onAuthenticated={handleAuthenticated} />
        {error ? <Notice tone="error">{error}</Notice> : null}
      </div>
    )
  }

  if (error || !bundle) {
    return (
      <div className="space-y-4">
        <SharedTripHeader title="同行共享" subtitle="这条共享入口暂时不可用。" />
        <EmptyState
          body={error || '请让主人重新生成共享链接。'}
          icon={<UsersRound className="size-6" />}
          title="无法打开共享旅行"
        />
      </div>
    )
  }

  const permission = bundle.member?.permission ?? 'read'
  const projection = bundle.sharedTrip.projection
  const itemsByDay = groupSharedItemsByDay(projection.items)
  const commentsByItem = groupCommentsByItem(bundle.comments)
  const confirmationsByItem = groupConfirmationsByItem(bundle.confirmations)

  return (
    <div className="space-y-5 pb-4" data-testid="shared-trip-page">
      <SharedTripHeader
        subtitle={`${projection.trip.destination} · ${projection.days.length} 天`}
        title={projection.trip.title}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3" variant="grouped">
        <div>
          <p className="text-xs font-semibold text-primary">同行人视角</p>
          <p className="mt-1 text-sm tm-muted">{getCompanionPermissionLabel(permission)} · 协作动态会实时刷新，授权票据原件可直接打开。</p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-container-high px-3 text-xs font-semibold text-on-surface-variant">
          <ShieldCheck className="size-3.5" />
          已登录
        </span>
      </Card>

      <MemberProfileSummary profile={bundle.member?.profile} />

      <CompanionLiveCard
        permission={permission}
        sharedTripId={bundle.sharedTrip.id}
        ticketSummaries={projection.ticketSummaries}
        onChanged={refresh}
        projection={projection}
      />

      <TicketSummaryPanel
        onOpenTicketFile={handleOpenTicketFile}
        openingTicketId={openingTicketId}
        ticketSummaries={projection.ticketSummaries}
      />

      {projection.days.map((day) => (
        <Card className="space-y-3" data-testid="shared-trip-day" key={day.id} variant="grouped">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-primary">{day.date}</p>
              <h3 className="mt-1 text-base font-semibold text-on-surface">{day.title}</h3>
            </div>
            <span className="rounded-full bg-surface-container-high px-2 py-1 text-xs font-semibold text-on-surface-variant">
              {itemsByDay[day.id]?.length ?? 0} 站
            </span>
          </div>

          <div className="space-y-3">
            {(itemsByDay[day.id] ?? []).map((item, index, dayItems) => {
              const previousItem = index > 0 ? dayItems[index - 1] : null
              return (
                <SharedItemCard
                  comments={commentsByItem[item.id] ?? []}
                  confirmations={confirmationsByItem[item.id] ?? []}
                  item={item}
                  key={item.id}
                  onChanged={refresh}
                  permission={permission}
                  previousItem={previousItem}
                  sharedTripId={bundle.sharedTrip.id}
                  ticketSummaries={projection.ticketSummaries.filter((ticket) => item.ticketSummaryIds.includes(ticket.id))}
                />
              )
            })}
          </div>

          {canCompanionCollaborate(permission) ? (
            <CreateItemForm dayId={day.id} onChanged={refresh} sharedTripId={bundle.sharedTrip.id} />
          ) : null}
        </Card>
      ))}

      {bundle.activities.length > 0 ? (
        <Card className="space-y-2" variant="grouped">
          <h3 className="text-base font-semibold text-on-surface">同行人动态</h3>
          {bundle.activities.slice(0, 10).map((activity) => (
            <div className="rounded-lg bg-surface-container-low px-3 py-2" key={activity.id}>
              <p className="text-sm font-semibold text-on-surface">{activity.displayName || '同行人'}</p>
              <p className="text-xs tm-muted">{activity.body || '更新了共享旅行'}</p>
            </div>
          ))}
        </Card>
      ) : null}

      {filePreview ? (
        <SharedTicketFilePreview
          preview={filePreview}
          onClose={() => setFilePreview(null)}
        />
      ) : null}

    </div>
  )
}

function SharedTripLoginPanel({ inviteToken, onAuthenticated }: { inviteToken: string; onAuthenticated: () => Promise<void> }) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode() {
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailOtp(email.trim())
      setSent(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '发送验证码失败。')
    } finally {
      setBusy(false)
    }
  }

  async function verify() {
    setBusy(true)
    setError(null)
    try {
      await verifyEmailOtp(email.trim(), code.trim())
      await onAuthenticated()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '验证码验证失败。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="space-y-3" data-testid="shared-trip-login" variant="grouped">
      <div>
        <h3 className="text-base font-semibold text-on-surface">登录后加入</h3>
        <p className="mt-1 text-xs leading-5 tm-muted">
          {inviteToken ? '这条链接会在登录后绑定到你的账号。' : '请使用主人分享的链接打开。'}
        </p>
      </div>
      <label className="block text-xs font-semibold text-on-surface-variant">
        邮箱
        <input
          className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface"
          onChange={(event) => setEmail(event.currentTarget.value)}
          type="email"
          value={email}
        />
      </label>
      {sent ? (
        <label className="block text-xs font-semibold text-on-surface-variant">
          验证码
          <input
            className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm text-on-surface"
            onChange={(event) => setCode(event.currentTarget.value)}
            value={code}
          />
        </label>
      ) : null}
      <Button
        className="w-full"
        disabled={!email.trim() || (sent && !code.trim())}
        loading={busy}
        onClick={() => void (sent ? verify() : sendCode())}
      >
        {sent ? '验证并加入' : '发送邮箱验证码'}
      </Button>
      {error ? <Notice tone="error">{error}</Notice> : null}
    </Card>
  )
}

function MemberProfileSummary({ profile }: { profile?: SharedTripMemberProfile }) {
  const fields = [
    ['证件姓名', profile?.legalName],
    ['生日', profile?.birthday],
    ['护照', profile?.passport],
    ['签证', profile?.visa],
    ['保险', profile?.insurance],
    ['身份证件', profile?.identityDocument],
    ['座位', profile?.seat],
    ['房间', profile?.room],
    ['紧急联系人', profile?.emergencyContact],
  ].filter((entry): entry is [string, string] => Boolean(entry[1]))

  if (fields.length === 0 && !profile?.notes) {
    return null
  }

  return (
    <Card className="space-y-3" data-testid="shared-trip-member-profile" variant="grouped">
      <div className="flex items-center gap-2">
        <IdCard className="size-4 text-primary" />
        <h3 className="text-base font-semibold text-on-surface">我的同行资料</h3>
      </div>
      {fields.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([label, value]) => (
            <InfoCell icon={<IdCard className="size-3.5" />} key={label} label={label} value={value} />
          ))}
        </div>
      ) : null}
      {profile?.notes ? <p className="rounded-lg bg-surface-container-low px-3 py-2 text-sm tm-muted">{profile.notes}</p> : null}
    </Card>
  )
}

function CompanionLiveCard({
  onChanged,
  permission,
  projection,
  sharedTripId,
  ticketSummaries,
}: {
  onChanged: () => Promise<void>
  permission: CompanionPermission
  projection: CompanionSharedTripBundle['sharedTrip']['projection']
  sharedTripId: string
  ticketSummaries: SharedTicketSummary[]
}) {
  const now = useLiveClock()
  const today = projection.days.find((day) => day.date === getZonedPlainDate(now, resolveDayTimeZone(projection.trip, day))) ?? projection.days[0]
  const items = today ? sortItineraryItems(projection.items.filter((item) => item.dayId === today.id).map(toItineraryItem)) : []
  const model = today
    ? buildTripLiveModel({
        day: today,
        items,
        now,
        tickets: toTicketMetas(ticketSummaries, projection.trip.id),
        trip: projection.trip,
      })
    : null
  const targetItem = model?.targetItem

  async function markCompleted() {
    if (!targetItem) return
    await submitSharedTripMutation(sharedTripId, {
      mutationType: 'update_item_execution_state',
      payload: { itemId: targetItem.id, status: 'completed' },
    })
    await onChanged()
  }

  return (
    <Card className="space-y-3" data-testid="shared-trip-live-card" variant="grouped">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Navigation className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary">Live Mode · 同行人视角</p>
          <h3 className="mt-1 break-words text-lg font-semibold text-on-surface">{model?.title ?? '今天暂无安排'}</h3>
          <p className="mt-1 text-sm leading-6 tm-muted">{model?.subtitle ?? '主人更新共享行程后会显示下一步。'}</p>
          <p className="mt-1 text-xs leading-5 tm-muted">仅基于已共享数据本地计算，不包含实时交通、实时开闭园或位置追踪。</p>
        </div>
      </div>
      {targetItem ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <InfoCell icon={<Clock3 className="size-3.5" />} label="集合时间" value={describeItemTime(targetItem)} />
          <InfoCell icon={<Navigation className="size-3.5" />} label="路线提示" value={describePreviousTransport(targetItem) || '按主人行程前往'} />
          <InfoCell icon={<Ticket className="size-3.5" />} label="需要票据" value={model.ticketTitles.length ? model.ticketTitles.join('、') : '暂无绑定票据'} />
        </div>
      ) : null}
      {targetItem && canCompanionComment(permission) ? (
        <div className="flex flex-wrap gap-2">
          <Button icon={<Check className="size-4" />} onClick={() => void confirmSharedTripMeeting(sharedTripId, targetItem.id).then(onChanged)} variant="secondary">
            确认集合时间
          </Button>
          {canCompanionCollaborate(permission) ? (
            <Button icon={<Check className="size-4" />} onClick={() => void markCompleted()} variant="secondary">
              提交已完成
            </Button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function SharedItemCard({
  comments,
  confirmations,
  item,
  onChanged,
  permission,
  previousItem,
  sharedTripId,
  ticketSummaries,
}: {
  comments: SharedTripComment[]
  confirmations: Array<{ displayName?: string; userId: string }>
  item: SharedItineraryItem
  onChanged: () => Promise<void>
  permission: CompanionPermission
  previousItem: SharedItineraryItem | null
  sharedTripId: string
  ticketSummaries: SharedTicketSummary[]
}) {
  const [comment, setComment] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [title, setTitle] = useState(item.title)
  const [startTime, setStartTime] = useState(item.startTime ?? '')
  const [busy, setBusy] = useState(false)
  const googleDirectionsUrl = previousItem ? buildGoogleMapsDirectionsUrl(toItineraryItem(previousItem), toItineraryItem(item), item.previousTransportMode) : null

  async function submitComment(body = comment) {
    setBusy(true)
    try {
      await addSharedTripComment(sharedTripId, item.id, body)
      setComment('')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function submitEdit() {
    setBusy(true)
    try {
      await submitSharedTripMutation(sharedTripId, {
        mutationType: 'update_item',
        payload: {
          baselineUpdatedAt: item.updatedAt,
          itemId: item.id,
          patch: {
            startTime: startTime || undefined,
            title,
          },
        },
      })
      setEditOpen(false)
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container-low p-3" data-testid="shared-trip-item">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-container/20 text-primary">
          <CalendarDays className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-primary">{describeItemTime(toItineraryItem(item))}</p>
          <h4 className="mt-1 break-words text-base font-semibold text-on-surface">{item.title}</h4>
          <p className="mt-1 text-sm leading-5 tm-muted">{item.locationName || item.address || '地点待补充'}</p>
          {describePreviousTransport(toItineraryItem(item)) ? <p className="mt-1 text-xs tm-muted">{describePreviousTransport(toItineraryItem(item))}</p> : null}
        </div>
      </div>

      {ticketSummaries.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {ticketSummaries.map((ticket) => <span className="tm-chip text-xs" key={ticket.id}><Ticket className="size-3.5" />{ticket.title}</span>)}
        </div>
      ) : null}

      {googleDirectionsUrl ? (
        <a className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-xs font-semibold text-primary" href={googleDirectionsUrl} rel="noreferrer" target="_blank">
          <Navigation className="size-3.5" />
          Google 路线
        </a>
      ) : null}

      {confirmations.length > 0 ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200">
          {confirmations.map((confirmation) => confirmation.displayName || '同行人').join('、')} 已确认集合
        </p>
      ) : null}

      {comments.length > 0 ? (
        <div className="space-y-2">
          {comments.map((entry) => (
            <div className="rounded-lg bg-surface px-3 py-2" key={entry.id}>
              <p className="text-xs font-semibold text-on-surface">{entry.displayName || '同行人'}</p>
              <p className="mt-0.5 text-sm leading-5 tm-muted">{entry.body}</p>
            </div>
          ))}
        </div>
      ) : null}

      {canCompanionComment(permission) ? (
        <div className="space-y-2 border-t border-outline-variant/20 pt-3">
          <div className="flex flex-wrap gap-2">
            {['我想去这个', '这个太早了', '我已到集合点'].map((body) => (
              <Button disabled={busy} key={body} onClick={() => void submitComment(body)} variant="ghost">{body}</Button>
            ))}
            <Button disabled={busy} icon={<Check className="size-4" />} onClick={() => void confirmSharedTripMeeting(sharedTripId, item.id).then(onChanged)} variant="ghost">
              确认集合
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm"
              onChange={(event) => setComment(event.currentTarget.value)}
              placeholder="给这个行程点留言"
              value={comment}
            />
            <Button disabled={!comment.trim() || busy} icon={<MessageCircle className="size-4" />} onClick={() => void submitComment()}>
              发送
            </Button>
          </div>
        </div>
      ) : null}

      {canCompanionCollaborate(permission) ? (
        <div className="border-t border-outline-variant/20 pt-3">
          <Button onClick={() => setEditOpen((open) => !open)} variant="secondary">协作修改</Button>
          {editOpen ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <input className="min-h-11 rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm" data-testid="shared-trip-edit-title" onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
              <input className="min-h-11 rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm" data-testid="shared-trip-edit-time" onChange={(event) => setStartTime(event.currentTarget.value)} type="time" value={startTime} />
              <Button disabled={busy || !title.trim()} loading={busy} onClick={() => void submitEdit()}>提交修改</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CreateItemForm({ dayId, onChanged, sharedTripId }: { dayId: string; onChanged: () => Promise<void>; sharedTripId: string }) {
  const [title, setTitle] = useState('')
  const [startTime, setStartTime] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await submitSharedTripMutation(sharedTripId, {
        mutationType: 'create_item',
        payload: { dayId, item: { startTime: startTime || undefined, title } },
      })
      setTitle('')
      setStartTime('')
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-2 rounded-lg border border-dashed border-outline-variant/40 p-3 sm:grid-cols-[1fr_auto_auto]">
      <input className="min-h-11 rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm" onChange={(event) => setTitle(event.currentTarget.value)} placeholder="新增同行补充" value={title} />
      <input className="min-h-11 rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm" onChange={(event) => setStartTime(event.currentTarget.value)} type="time" value={startTime} />
      <Button disabled={busy || !title.trim()} icon={<Plus className="size-4" />} loading={busy} onClick={() => void submit()} variant="secondary">提交新增</Button>
    </div>
  )
}

function TicketSummaryPanel({
  onOpenTicketFile,
  openingTicketId,
  ticketSummaries,
}: {
  onOpenTicketFile: (ticket: SharedTicketSummary) => void
  openingTicketId: string | null
  ticketSummaries: SharedTicketSummary[]
}) {
  return (
    <Card className="space-y-3" data-testid="shared-trip-ticket-summary" variant="grouped">
      <div className="flex items-center gap-2">
        <Ticket className="size-4 text-primary" />
        <h3 className="text-base font-semibold text-on-surface">重要票据</h3>
      </div>
      <p className="text-xs leading-5 tm-muted">只显示主人授权给你的票据。可共享副本会提供原件入口，未授权同行不会看到。</p>
      {ticketSummaries.length === 0 ? <p className="text-sm tm-muted">主人还没有共享给你的票据。</p> : null}
      <div className="grid gap-2">
        {ticketSummaries.map((ticket) => (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-surface-container-low px-3 py-2" key={ticket.id}>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-semibold text-on-surface">{ticket.title}</p>
              <p className="text-xs tm-muted">{ticket.fileType.toUpperCase()} · {ticket.storageMode === 'copy' ? '已授权原件' : '外部引用'}</p>
            </div>
            {ticket.storageMode === 'copy' ? (
              <Button
                disabled={openingTicketId === ticket.id}
                icon={openingTicketId === ticket.id ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
                onClick={() => onOpenTicketFile(ticket)}
                variant="secondary"
              >
                打开原件
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}

function SharedTicketFilePreview({
  onClose,
  preview,
}: {
  onClose: () => void
  preview: SharedTicketFilePreviewState
}) {
  const isImage = preview.mimeType.startsWith('image/')
  const isPdf = preview.mimeType === 'application/pdf'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="shared-trip-ticket-file-preview">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-outline-variant/30 px-4 py-3">
          <Ticket className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-base font-semibold text-on-surface">{preview.title}</h3>
            <p className="truncate text-xs tm-muted">{preview.fileName}</p>
          </div>
          <a
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-outline-variant/40 px-3 text-xs font-semibold text-primary"
            download={preview.fileName}
            href={preview.objectUrl}
          >
            <Download className="size-3.5" />
            下载原件
          </a>
          <button
            aria-label="关闭票据预览"
            className="inline-flex size-10 items-center justify-center rounded-lg text-on-surface-variant tm-focus hover:bg-surface-container-high"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-container-low p-3">
          {isImage ? (
            <img alt={preview.title} className="mx-auto max-h-[72vh] max-w-full rounded-lg bg-surface object-contain" src={preview.objectUrl} />
          ) : isPdf ? (
            <iframe className="h-[72vh] w-full rounded-lg bg-surface" data-testid="shared-trip-ticket-file-frame" src={preview.objectUrl} title={preview.title} />
          ) : (
            <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-lg bg-surface p-6 text-center">
              <Ticket className="size-8 text-primary" />
              <p className="text-sm font-semibold text-on-surface">{preview.fileName}</p>
              <a className="text-sm font-semibold text-primary" href={preview.objectUrl} rel="noreferrer" target="_blank">打开原件</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SharedTripHeader({ subtitle, title }: { subtitle: string; title: string }) {
  return (
    <section className="space-y-1">
      <p className="text-xs font-semibold text-primary">Companion / Shared Trip Mode</p>
      <h2 className="break-words text-2xl font-semibold text-on-surface">{title}</h2>
      <p className="text-sm tm-muted">{subtitle}</p>
    </section>
  )
}

function InfoCell({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-high/60 px-3 py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold uppercase text-on-surface-variant">{icon}{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-on-surface">{value}</p>
    </div>
  )
}

function Notice({ children, tone }: { children: ReactNode; tone: 'error' | 'success' }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-sm font-medium ${tone === 'error' ? 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-200'}`}>
      {children}
    </div>
  )
}

function groupSharedItemsByDay(items: SharedItineraryItem[]) {
  return items.reduce<Record<string, SharedItineraryItem[]>>((result, item) => {
    result[item.dayId] = [...(result[item.dayId] ?? []), item]
    result[item.dayId] = result[item.dayId].sort((first, second) => first.sortOrder - second.sortOrder || first.title.localeCompare(second.title))
    return result
  }, {})
}

function groupCommentsByItem(comments: SharedTripComment[]) {
  return comments.reduce<Record<string, SharedTripComment[]>>((result, comment) => {
    result[comment.itemId] = [...(result[comment.itemId] ?? []), comment]
    return result
  }, {})
}

function groupConfirmationsByItem(confirmations: Array<{ itemId: string; displayName?: string; userId: string }>) {
  return confirmations.reduce<Record<string, Array<{ displayName?: string; userId: string }>>>((result, confirmation) => {
    result[confirmation.itemId] = [...(result[confirmation.itemId] ?? []), confirmation]
    return result
  }, {})
}

function toItineraryItem(item: SharedItineraryItem): ItineraryItem {
  return {
    ...item,
    ticketIds: item.ticketSummaryIds,
  }
}

function toTicketMetas(ticketSummaries: SharedTicketSummary[], tripId: string): TicketMeta[] {
  return ticketSummaries.map((ticket) => ({
    createdAt: 0,
    fileName: ticket.title,
    fileType: ticket.fileType,
    id: ticket.id,
    itemId: ticket.itemId,
    mimeType: '',
    scope: ticket.scope,
    size: 0,
    storageMode: ticket.storageMode,
    ticketCategory: ticket.ticketCategory,
    title: ticket.title,
    tripId,
    updatedAt: 0,
  }))
}
