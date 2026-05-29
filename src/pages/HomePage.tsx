import { useEffect, useState } from 'react'
import { CalendarDays, ChevronRight, Plus, Settings } from 'lucide-react'
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
      {/* Hero title section */}
      <section className="shrink-0 flex justify-between items-end">
        <div>
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-1">旅图</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">你的旅行现场控制台</p>
        </div>
        <button
          aria-label="设置"
          className="flex size-10 items-center justify-center rounded-full bg-surface-container border border-outline-variant/30 text-on-surface-variant transition hover:text-primary active:scale-95"
          onClick={() => navigateTo('settings')}
          type="button"
        >
          <Settings className="size-5" />
        </button>
      </section>

      {/* Hero card for first trip */}
      {hasTrips ? (
        <button
          className="shrink-0 text-left tm-focus active:scale-[0.98] transition w-full"
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
            <section className="flex flex-col gap-3">
              <h3 className="font-headline-md text-headline-md text-on-surface">最近行程</h3>
              <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden">
                {trips.map((trip, index) => (
                  <TripCard
                    key={trip.id}
                    onOpen={() => navigateTo('trip', { tripId: trip.id })}
                    separator={index > 0}
                    trip={trip}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </section>

      <div className="shrink-0 flex flex-col gap-3">
        <button
          className="w-full py-4 rounded-xl bg-primary-container text-on-primary-container font-headline-md text-headline-md flex items-center justify-center gap-2 transition active:scale-[0.98]"
          onClick={() => navigateTo('trip/new')}
          type="button"
        >
          <Plus className="size-5" />
          新建行程
        </button>
        <button
          className="w-full py-4 rounded-xl bg-surface-container-high text-primary font-headline-md text-headline-md flex items-center justify-center gap-2 transition active:scale-[0.98]"
          onClick={() => navigateTo('settings')}
          type="button"
        >
          导入行程
        </button>
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
  separator,
}: {
  trip: Trip
  onOpen: () => void
  separator?: boolean
}) {
  const status = getTripStatus(trip)

  return (
    <div className="relative" data-testid="trip-card">
      <button className={`flex w-full min-h-[72px] items-center gap-4 p-4 text-left transition hover:bg-surface-container-high/50 active:scale-[0.99] tm-focus ${separator ? 'border-t border-outline-variant/30' : ''}`} onClick={onOpen} type="button">
        <TripCover trip={trip} variant="thumbnail" />
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <span className="font-body-lg text-body-lg text-on-surface block truncate">{trip.title}</span>
          <span className="font-label-sm text-label-sm text-on-surface-variant block truncate mt-0.5">
            {status.label} · {formatDateRange(trip.startDate, trip.endDate)}
          </span>
        </div>
        <ChevronRight className="size-4 shrink-0 text-outline-variant" />
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
