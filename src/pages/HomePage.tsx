import { useEffect, useState } from 'react'
import { CalendarDays, Plus, Settings, Trash2 } from 'lucide-react'
import {
  createDemoTrip,
  deleteTripCascade,
  listDaysByTrip,
  listItemsByTrip,
  listTicketsByTrip,
  listTrips,
} from '../db'
import { navigateTo } from '../lib/routes'
import { formatDateRange } from '../lib/dates'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import type { Trip } from '../types'
import { Button } from '../components/ui/Button'
import { AppVersion } from '../components/AppVersion'
import { GroupedSection } from '../components/ui/GroupedSection'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { TripCover } from '../components/trip/TripCover'
import { getTripStatus } from '../lib/tripVisuals'

type TripCardStats = {
  dayCount: number
  itemCount: number
  ticketCount: number
}

export function HomePage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null)
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tripStatsById, setTripStatsById] = useState<Record<string, TripCardStats>>({})

  const hasTrips = trips.length > 0

  async function refreshTrips() {
    setError(null)
    const { statsById, trips: nextTrips } = await loadTripsWithStats()
    setTrips(nextTrips)
    setTripStatsById(statsById)
  }

  useEffect(() => {
    let isMounted = true

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const { statsById, trips: nextTrips } = await loadTripsWithStats()
        if (isMounted) {
          setTrips(nextTrips)
          setTripStatsById(statsById)
        }
      } catch (caught) {
        if (isMounted) {
          setError(caught instanceof Error ? caught.message : '读取本地数据库失败')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [])

  useEffect(() => subscribeTravelDataChanged(() => void refreshTrips()), [])

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
    if (!pendingDeleteTrip) {
      return
    }

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
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
      {/* Page header */}
      <header className="shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-on-surface dark:text-on-surface">旅图</h1>
          <p className="text-[13px] tm-muted">你的旅行现场控制台</p>
        </div>
        <button
          aria-label="设置"
          className="flex size-10 items-center justify-center rounded-xl text-on-surface-variant transition hover:bg-surface-container active:bg-surface-container-high dark:hover:bg-surface-container-highest dark:active:bg-surface-container-high tm-focus"
          onClick={() => navigateTo('settings')}
          type="button"
        >
          <Settings className="size-5" />
        </button>
      </header>

      {/* Hero card for first trip */}
      {hasTrips ? (
        <button
          className="shrink-0 text-left tm-focus rounded-2xl active:scale-[0.98] transition"
          onClick={() => navigateTo('trip', { tripId: trips[0].id })}
          type="button"
        >
          <TripCover
            heroStats={tripStatsById[trips[0].id] ? {
              days: tripStatsById[trips[0].id].dayCount,
              spots: tripStatsById[trips[0].id].itemCount,
              tickets: tripStatsById[trips[0].id].ticketCount,
            } : undefined}
            trip={trips[0]}
            variant="hero"
          />
        </button>
      ) : null}

      {error ? (
        <div className="shrink-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
          {isLoading ? (
            <div className="space-y-3">
              <SkeletonLine className="w-2/3" />
              <SkeletonLine className="w-full" />
              <SkeletonLine className="w-1/2" />
            </div>
          ) : null}

          {!isLoading && !hasTrips ? (
            <div className="space-y-3">
              <EmptyState
                body="新用户不会自动生成示例数据。你可以新建旅行，也可以手动创建一个东京示例用于体验地图和时间轴。"
                icon={<CalendarDays className="size-6" />}
                title="还没有旅行"
              />
              <Button
                className="w-full"
                loading={isCreatingDemo}
                onClick={() => void handleCreateDemoTrip()}
                variant="secondary"
              >
                创建示例旅行
              </Button>
            </div>
          ) : null}

          {!isLoading && hasTrips ? (
            <GroupedSection title="最近行程">
              {trips.map((trip, index) => (
                <TripCard
                  key={trip.id}
                  onDelete={() => setPendingDeleteTrip(trip)}
                  onOpen={() => navigateTo('trip', { tripId: trip.id })}
                  separator={index > 0}
                  stats={tripStatsById[trip.id]}
                  trip={trip}
                  isDeleting={deletingTripId === trip.id}
                />
              ))}
            </GroupedSection>
          ) : null}
        </div>
      </section>

      <div className="shrink-0">
        <Button
          className="w-full"
          icon={<Plus className="size-4" />}
          onClick={() => navigateTo('trip/new')}
        >
          新建旅行
        </Button>
        <button
          className="mt-2 w-full text-center text-sm font-medium text-outline transition hover:text-on-surface-variant"
          onClick={() => navigateTo('settings')}
          type="button"
        >
          导入备份
        </button>
        <AppVersion className="mt-3" suffix="本地优先" />
      </div>

      <ConfirmDialog
        body="删除后，本机保存的日程、行程点、票据元数据、票据文件和绑定关系都会被移除。"
        confirmLabel="删除旅行"
        loading={Boolean(deletingTripId)}
        onCancel={() => {
          if (!deletingTripId) {
            setPendingDeleteTrip(null)
          }
        }}
        onConfirm={() => void confirmDeleteTrip()}
        open={Boolean(pendingDeleteTrip)}
        title={pendingDeleteTrip ? `确认删除「${pendingDeleteTrip.title}」吗？` : '确认删除这个旅行吗？'}
      />
    </div>
  )
}

function TripCard({
  trip,
  onOpen,
  onDelete,
  stats,
  isDeleting,
  separator,
}: {
  trip: Trip
  onOpen: () => void
  onDelete: () => void
  stats?: TripCardStats
  isDeleting: boolean
  separator?: boolean
}) {
  const status = getTripStatus(trip)

  return (
    <div className="relative" data-testid="trip-card">
      {separator ? <div className="absolute left-[60px] right-0 top-0 h-[0.5px] bg-outline-variant/30" /> : null}
      <button className="grid w-full min-h-[56px] grid-cols-[5rem_1fr] gap-3 p-3 pr-11 text-left transition active:bg-black/[0.03] dark:active:bg-white/[0.06] tm-focus" onClick={onOpen} type="button">
        <TripCover trip={trip} variant="thumbnail" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${status.className}`}>
              {status.label}
            </span>
            <p className="truncate text-xs text-outline">{formatDateRange(trip.startDate, trip.endDate)}</p>
          </div>
          <h3 className="mt-1.5 truncate text-base font-semibold text-on-surface dark:text-on-surface">{trip.title}</h3>
          <p className="mt-0.5 truncate text-sm tm-muted">{trip.destination}</p>
          {stats ? (
            <p className="mt-1 truncate text-xs font-medium tm-muted">
              {stats.dayCount} 天 · {stats.itemCount} 个行程点 · {stats.ticketCount} 张票据
            </p>
          ) : null}
        </div>
      </button>
      <button
        aria-label={`删除 ${trip.title}`}
        className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full bg-white/80 text-outline ring-1 ring-outline-variant/30/70 backdrop-blur transition hover:bg-red-50 hover:text-red-500 active:scale-[0.98] dark:bg-surface-container-highest/80 dark:ring-outline-variant/30/70 dark:hover:bg-red-500/10 tm-focus"
        disabled={isDeleting}
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="size-4" />
      </button>
    </div>
  )
}

async function loadTripsWithStats() {
  const trips = await listTrips()
  const entries = await Promise.all(
    trips.map(async (trip) => {
      try {
        const [days, items, tickets] = await Promise.all([
          listDaysByTrip(trip.id),
          listItemsByTrip(trip.id),
          listTicketsByTrip(trip.id),
        ])
        return [
          trip.id,
          {
            dayCount: days.length,
            itemCount: items.length,
            ticketCount: tickets.length,
          },
        ] as const
      } catch {
        return null
      }
    }),
  )

  return {
    statsById: Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)),
    trips,
  }
}
