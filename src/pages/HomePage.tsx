import { useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronRight,
  Clock3,
  Download,
  FolderLock,
  MapPin,
  Plus,
  Settings,
  Sparkles,
  Trash2,
} from 'lucide-react'
import {
  createDemoTrip,
  deleteTripCascade,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  listTrips,
} from '../db'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import { describeItemTime } from '../lib/itinerary'
import { formatDateRange, formatShortDateWithWeekday } from '../lib/dates'
import {
  buildHomePortfolioModel,
  type HomePortfolioModel,
  type HomeTripOverview,
  type HomeTripSnapshot,
} from '../lib/homeOverview'
import { readTripNavigationContext } from '../lib/navigationContext'
import { navigateTo } from '../lib/routes'
import type { Trip } from '../types'

const EMPTY_PORTFOLIO: HomePortfolioModel = { activeAndUpcoming: [], completed: [], primary: null }

export function HomePage() {
  const [snapshots, setSnapshots] = useState<HomeTripSnapshot[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null)
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const preferredTripId = useMemo(() => readTripNavigationContext()?.tripId ?? null, [])
  const portfolio = useMemo(
    () => snapshots.length > 0
      ? buildHomePortfolioModel(snapshots, { preferredTripId })
      : EMPTY_PORTFOLIO,
    [preferredTripId, snapshots],
  )

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextSnapshots = await loadHomeTripSnapshots()
        if (!cancelled) {
          setSnapshots(nextSnapshots)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '读取本地数据库失败')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    const unsubscribe = subscribeTravelDataChanged(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function refreshTrips() {
    setSnapshots(await loadHomeTripSnapshots())
  }

  async function handleCreateDemoTrip() {
    setIsCreatingDemo(true)
    setError(null)
    try {
      await createDemoTrip()
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建示例旅行失败')
    } finally {
      setIsCreatingDemo(false)
    }
  }

  async function confirmDeleteTrip() {
    if (!pendingDeleteTrip) return
    const trip = pendingDeleteTrip
    setDeletingTripId(trip.id)
    setError(null)
    try {
      await deleteTripCascade(trip.id)
      setPendingDeleteTrip(null)
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除旅行失败')
    } finally {
      setDeletingTripId(null)
    }
  }

  return (
    <>
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 px-4 pb-40 pt-24">
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">旅图管家</p>
            <h2 className="mt-1 font-headline-lg-mobile text-headline-lg-mobile text-on-surface">随身管家</h2>
            <p className="mt-1 font-body-md text-body-md text-on-surface-variant">旅行、票据和提醒都在这里。</p>
          </div>
          <button
            aria-label="设置"
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant/70 bg-surface-container text-on-surface-variant shadow-[0_1px_2px_rgba(20,37,32,0.04)] transition hover:text-primary active:scale-95 tm-focus"
            onClick={() => navigateTo('settings')}
            title="设置"
            type="button"
          >
            <Settings className="size-5" />
          </button>
        </header>

        {isLoading ? <HomeLoading /> : null}

        {error ? (
          <div className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm font-medium text-on-error-container">
            {error}
          </div>
        ) : null}

        {!isLoading && snapshots.length === 0 ? (
          <div className="space-y-3">
            <EmptyState
              body="新建一趟旅行，或创建东京示例体验地图、时间轴和票据。"
              icon={<CalendarDays className="size-6" />}
              title="还没有旅行"
            />
            <Button className="w-full" loading={isCreatingDemo} onClick={() => void handleCreateDemoTrip()} variant="secondary">
              创建示例旅行
            </Button>
          </div>
        ) : null}

        {portfolio.primary ? (
          <PrimaryTripPanel onDelete={setPendingDeleteTrip} overview={portfolio.primary} />
        ) : null}

        {portfolio.activeAndUpcoming.length > 0 ? (
          <TripSection
            onDelete={setPendingDeleteTrip}
            overviews={portfolio.activeAndUpcoming}
            title="接下来的旅行"
          />
        ) : null}

        {portfolio.completed.length > 0 ? (
          <TripSection
            onDelete={setPendingDeleteTrip}
            overviews={portfolio.completed}
            title="已完成"
          />
        ) : null}

        <HomeActions primaryTrip={portfolio.primary?.trip ?? null} />
      </div>

      <ConfirmDialog
        body="删除后，本机保存的日程、行程点、票据元数据、票据文件和绑定关系都会被移除。"
        confirmLabel="删除旅行"
        loading={Boolean(deletingTripId)}
        onCancel={() => { if (!deletingTripId) setPendingDeleteTrip(null) }}
        onConfirm={() => void confirmDeleteTrip()}
        open={Boolean(pendingDeleteTrip)}
        title={pendingDeleteTrip ? `确认删除「${pendingDeleteTrip.title}」吗？` : '确认删除这个旅行吗？'}
      />
    </>
  )
}

function PrimaryTripPanel({ onDelete, overview }: { onDelete: (trip: Trip) => void; overview: HomeTripOverview }) {
  const { focusDay, nextItem, stats, trip } = overview
  return (
    <section
      className="overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container shadow-[0_14px_32px_rgba(20,37,32,0.08)]"
      data-testid="home-primary-trip"
    >
      <div className="space-y-4 p-4" data-testid="trip-card">
        <div className="flex items-start justify-between gap-3">
          <button
            className="min-w-0 flex-1 text-left active:opacity-80 tm-focus"
            onClick={() => navigateTo('trip', { tripId: trip.id })}
            type="button"
          >
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={getStatusClassName(overview.status)}>{overview.statusLabel}</span>
              <span className="text-xs font-medium text-on-surface-variant">{formatDateRange(trip.startDate, trip.endDate)}</span>
            </div>
            <h3 className="break-words font-headline-lg text-headline-lg text-on-surface">{trip.title}</h3>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-on-surface-variant">
              <MapPin className="size-4 shrink-0" />
              <span className="truncate">{trip.destination || '目的地待补充'}</span>
            </p>
          </button>
          <button
            aria-label={`删除${trip.title}`}
            className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-outline-variant/60 bg-surface text-on-surface-variant transition hover:bg-error-container hover:text-error active:scale-95 tm-focus"
            onClick={() => onDelete(trip)}
            title="删除旅行"
            type="button"
          >
            <Trash2 className="size-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <TripStat label="日程" value={`${stats.dayCount} 天`} />
          <TripStat label="行程点" value={`${stats.itemCount} 个`} />
          <TripStat label="票据" value={`${stats.ticketCount} 张`} />
        </div>

        <div className="flex items-start gap-3 rounded-lg bg-primary p-4 text-on-primary" data-testid="home-primary-next-step">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white">
            <Clock3 className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white/75">
              {focusDay ? formatShortDateWithWeekday(focusDay.date) : '旅行准备'}
            </p>
            <p className="mt-0.5 break-words text-sm font-semibold text-white">
              {nextItem ? nextItem.title : overview.preparationLabel}
            </p>
            {nextItem ? (
              <p className="mt-0.5 text-xs text-white/75">{describeItemTime(nextItem)} · {overview.preparationLabel}</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button className="w-full" onClick={() => navigateTo('trip', { tripId: trip.id })}>
            打开旅行
          </Button>
          <Button
            className="w-full"
            icon={nextItem ? <ChevronRight className="size-4" /> : <FolderLock className="size-4" />}
            onClick={() => nextItem
              ? navigateTo('item', { dayId: nextItem.dayId, itemId: nextItem.id, tripId: trip.id })
              : navigateTo('documents', { tripId: trip.id })}
            variant="secondary"
          >
            {nextItem ? '查看下一项' : '打开资料'}
          </Button>
        </div>
      </div>
    </section>
  )
}

function TripStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-container-high px-2 py-3 text-center">
      <p className="font-headline-md text-headline-md text-on-surface">{value}</p>
      <p className="mt-0.5 text-[11px] font-semibold text-on-surface-variant">{label}</p>
    </div>
  )
}

function TripSection({
  onDelete,
  overviews,
  title,
}: {
  onDelete: (trip: Trip) => void
  overviews: HomeTripOverview[]
  title: string
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-on-surface">{title}</h3>
      <div className="overflow-hidden rounded-lg border border-outline-variant/70 bg-surface-container">
        {overviews.map((overview, index) => (
          <TripPortfolioRow
            key={overview.trip.id}
            onDelete={onDelete}
            overview={overview}
            separator={index < overviews.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function TripPortfolioRow({
  onDelete,
  overview,
  separator,
}: {
  onDelete: (trip: Trip) => void
  overview: HomeTripOverview
  separator: boolean
}) {
  const { trip } = overview
  return (
    <div className={`flex items-center gap-2 px-2 ${separator ? 'border-b border-outline-variant/70' : ''}`}>
      <button
        aria-label={`打开${trip.title}`}
        className="flex min-h-16 min-w-0 flex-1 items-center gap-3 px-2 py-3 text-left transition hover:bg-surface-container-high active:scale-[0.99] tm-focus"
        data-testid="trip-card"
        onClick={() => navigateTo('trip', { tripId: trip.id })}
        type="button"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-fixed text-lg">
          {getTripEmoji(trip)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-on-surface">{trip.title}</span>
          <span className="mt-0.5 block truncate text-xs text-on-surface-variant">
            {overview.statusLabel} · {formatDateRange(trip.startDate, trip.endDate)}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-on-surface-variant" />
      </button>
      <button
        aria-label={`删除${trip.title}`}
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition hover:bg-error-container hover:text-error active:scale-95 tm-focus"
        onClick={() => onDelete(trip)}
        title="删除旅行"
        type="button"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

function HomeActions({ primaryTrip }: { primaryTrip: Trip | null }) {
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold text-on-surface">常用</h3>
      <div className="grid grid-cols-2 gap-2">
        <Button className="w-full" icon={<Plus className="size-4" />} onClick={() => navigateTo('trip/new')}>
          新建旅行
        </Button>
        <Button className="w-full border-secondary/30 bg-secondary-container text-secondary" icon={<Sparkles className="size-4" />} onClick={() => navigateTo('ai-draft')} variant="secondary">
          AI 生成行程
        </Button>
        <Button
          className="w-full"
          icon={<FolderLock className="size-4" />}
          onClick={() => navigateTo('documents', primaryTrip ? { tripId: primaryTrip.id } : undefined)}
          variant="secondary"
        >
          旅行资料
        </Button>
        <Button className="w-full" icon={<Download className="size-4" />} onClick={() => navigateTo('settings')} variant="secondary">
          导入恢复
        </Button>
      </div>
    </section>
  )
}

function HomeLoading() {
  return (
    <div className="space-y-3 rounded-lg border border-outline-variant/70 bg-surface-container p-5">
      <SkeletonLine className="w-1/3" />
      <SkeletonLine className="w-2/3" />
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-1/2" />
    </div>
  )
}

function getStatusClassName(status: HomeTripOverview['status']) {
  const base = 'inline-flex min-h-6 items-center rounded-lg px-2.5 text-xs font-semibold'
  if (status === 'ongoing') return `${base} bg-primary text-on-primary`
  if (status === 'completed') return `${base} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`
  return `${base} bg-surface-container-high text-on-surface-variant`
}

function getTripEmoji(trip: Trip) {
  const destination = (trip.destination || trip.title || '').toLowerCase()
  if (destination.includes('东京') || destination.includes('日本') || destination.includes('japan')) return '🗼'
  if (destination.includes('伦敦') || destination.includes('london') || destination.includes('英国')) return '🎡'
  if (destination.includes('巴黎') || destination.includes('paris') || destination.includes('法国')) return '🗼'
  if (destination.includes('纽约') || destination.includes('new york') || destination.includes('美国')) return '🗽'
  if (destination.includes('首尔') || destination.includes('seoul') || destination.includes('韩国')) return '🇰🇷'
  if (destination.includes('曼谷') || destination.includes('bangkok') || destination.includes('泰国')) return '🇹🇭'
  if (destination.includes('悉尼') || destination.includes('sydney') || destination.includes('澳洲')) return '🦘'
  if (destination.includes('迪拜') || destination.includes('dubai')) return '🏙️'
  if (destination.includes('罗马') || destination.includes('rome') || destination.includes('意大利')) return '🏛️'
  if (destination.includes('巴塞罗那') || destination.includes('barcelona') || destination.includes('西班牙')) return '🇪🇸'
  return '✈️'
}

async function loadHomeTripSnapshots(): Promise<HomeTripSnapshot[]> {
  const trips = await listTrips()
  return Promise.all(trips.map(async (trip) => {
    const [days, items, tickets] = await Promise.all([
      listDaysByTrip(trip.id),
      listItemsByTrip(trip.id),
      listTicketsByTrip(trip.id),
    ])
    return { days, items, tickets, trip }
  }))
}
