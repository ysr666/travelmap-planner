import { useEffect, useState } from 'react'
import { CalendarDays, ChevronRight, Download, Plus, Settings, Sparkles } from 'lucide-react'
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
import { AppVersion } from '../components/AppVersion'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'

type TripCardStats = {
  dayCount: number
  itemCount: number
  ticketCount: number
}

// ── 直接基于 design-reference/_3/code.html 转换 ──

export function HomePage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null)
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tripStatsById, setTripStatsById] = useState<Record<string, TripCardStats>>({})

  const hasTrips = trips.length > 0
  const firstTrip = hasTrips ? trips[0] : null
  const firstStats = firstTrip ? tripStatsById[firstTrip.id] : null
  const firstStatus = firstTrip ? getTripStatus(firstTrip) : null

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
        if (isMounted) { setTrips(nextTrips); setTripStatsById(statsById) }
      } catch (caught) {
        if (isMounted) setError(caught instanceof Error ? caught.message : '读取本地数据库失败')
      } finally {
        if (isMounted) setIsLoading(false)
      }
    }
    void load()
    return () => { isMounted = false }
  }, [])

  useEffect(() => subscribeTravelDataChanged(() => void refreshTrips()), [])

  async function handleCreateDemoTrip() {
    setIsCreatingDemo(true)
    setError(null)
    try { await createDemoTrip(); await refreshTrips() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '创建示例旅行失败') }
    finally { setIsCreatingDemo(false) }
  }

  async function confirmDeleteTrip() {
    if (!pendingDeleteTrip) return
    const trip = pendingDeleteTrip
    setDeletingTripId(trip.id)
    setError(null)
    try { await deleteTripCascade(trip.id); setPendingDeleteTrip(null); await refreshTrips() }
    catch (caught) { setError(caught instanceof Error ? caught.message : '删除旅行失败') }
    finally { setDeletingTripId(null) }
  }

  return (
    <>{/* ── Main Content Canvas ── 参考: 124 行 (TopAppBar 由 AppShell 管理) */}
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-section-gap px-4 pb-32 pt-24">

        {/* ── Hero Section ── */}
        <section className="flex justify-between items-end">
          <div>
            <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface mb-1">旅图</h2>
            <p className="font-body-md text-body-md text-on-surface-variant">你的旅行现场控制台</p>
            <AppVersion className="mt-1 text-left text-on-surface-variant" suffix="本地优先" />
          </div>
          <button
            aria-label="设置"
            className="w-11 h-11 flex items-center justify-center rounded-full bg-surface-container border border-outline-variant/30 text-on-surface-variant hover:text-primary transition-colors"
            onClick={() => navigateTo('settings')}
            type="button"
          >
            <Settings className="size-5" />
          </button>
        </section>

        {/* Loading */}
        {isLoading ? (
          <div className="space-y-3"><SkeletonLine className="w-2/3" /><SkeletonLine className="w-full" /><SkeletonLine className="w-1/2" /></div>
        ) : null}

        {/* Error */}
        {error ? (
          <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-medium text-on-error-container">{error}</div>
        ) : null}

        {/* Empty */}
        {!isLoading && !hasTrips ? (
          <div className="space-y-3">
            <EmptyState body="新用户不会自动生成示例数据。你可以新建旅行，也可以手动创建一个东京示例用于体验地图和时间轴。" icon={<CalendarDays className="size-6" />} title="还没有旅行" />
            <Button className="w-full" loading={isCreatingDemo} onClick={() => void handleCreateDemoTrip()} variant="secondary">创建示例旅行</Button>
          </div>
        ) : null}

        {/* ── Current Trip Card (Travel Pass) ── 参考: 136-167 行 */}
        {firstTrip ? (
          <button
            className="group relative w-full overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container text-left transition active:scale-[0.99]"
            data-testid="trip-card"
            onClick={() => navigateTo('trip', { tripId: firstTrip.id })}
            type="button"
          >
            <div className="absolute inset-0 z-0">
              <div className="w-full h-full bg-surface-variant" />
              <div className="absolute inset-0 bg-gradient-to-t from-surface-container via-surface-container/80 to-transparent" />
            </div>
            <div className="relative z-10 p-6 flex flex-col gap-4">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-headline-md text-headline-md text-on-surface mb-1">{firstTrip.title}</h3>
                  <p className="font-body-md text-body-md text-on-surface-variant">{formatDateRange(firstTrip.startDate, firstTrip.endDate)}</p>
                  <p className="mt-1 font-body-sm text-body-sm text-on-surface-variant">{firstTrip.destination}</p>
                </div>
                {firstStatus ? (
                  <div className={`${firstStatus.className} px-3 py-1 rounded-full border border-primary/30 flex items-center gap-1`}>
                    <span className="font-label-sm text-label-sm">{firstStatus.label}</span>
                  </div>
                ) : null}
              </div>
              {firstStats ? (
                <div className="grid grid-cols-3 gap-4 pt-4 border-t border-outline-variant/30">
                  <div className="flex flex-col">
                    <span className="font-headline-md text-headline-md text-on-surface">{firstStats.dayCount} 天</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">日程</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline-md text-headline-md text-on-surface">{firstStats.itemCount} 个</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">行程点</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="font-headline-md text-headline-md text-on-surface">{firstStats.ticketCount} 张</span>
                    <span className="font-label-sm text-label-sm text-on-surface-variant">票据</span>
                  </div>
                </div>
              ) : null}
            </div>
          </button>
        ) : null}

        {/* ── Recent Trips Section ── 参考: 169-217 行 */}
        {trips.length > 0 ? (
          <section className="flex flex-col gap-stack-gap">
            <h3 className="font-headline-md text-headline-md text-on-surface">最近行程</h3>
            <div className="bg-surface-container rounded-xl border border-outline-variant/30 flex flex-col">
              {trips.map((trip, index) => {
                const status = getTripStatus(trip)
                const isLast = index === trips.length - 1
                return (
                  <button
                    key={trip.id}
                    className="flex items-center gap-4 p-4 hover:bg-surface-container-high/50 transition-colors w-full text-left"
                    onClick={() => navigateTo('trip', { tripId: trip.id })}
                    type="button"
                  >
                    <div className="w-12 h-12 rounded-lg bg-surface-variant border border-outline-variant/30 flex-shrink-0 overflow-hidden flex items-center justify-center">
                      <span className="text-lg">{getTripEmoji(trip)}</span>
                    </div>
                    <div className={`flex-1 flex flex-col h-full justify-center ${isLast ? '' : 'border-b border-outline-variant/30 pb-4'}`}>
                      <span className="font-body-lg text-body-lg text-on-surface">{trip.title}</span>
                      <span className="font-label-sm text-label-sm text-on-surface-variant">{status.label} · {formatDateRange(trip.startDate, trip.endDate)}</span>
                    </div>
                    <ChevronRight className={`size-5 text-on-surface-variant ${isLast ? '' : 'border-b border-outline-variant/30 pb-4'}`} />
                  </button>
                )
              })}
            </div>
          </section>
        ) : null}

        {/* ── Action Buttons ── 参考: 219-228 行 */}
        <section className="flex flex-col gap-3 mt-4">
          <button
            className="w-full py-4 rounded-xl bg-primary text-on-primary font-headline-md text-headline-md flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors active:scale-[0.98]"
            onClick={() => navigateTo('ai-draft')}
            type="button"
          >
            <Sparkles className="size-5" />
            AI 生成行程
          </button>
          <button
            className="w-full py-4 rounded-xl bg-[#0A84FF] text-white font-headline-md text-headline-md flex items-center justify-center gap-2 hover:bg-[#0A84FF]/90 transition-colors active:scale-[0.98]"
            onClick={() => navigateTo('trip/new')}
            type="button"
          >
            <Plus className="size-5" />
            新建旅行
          </button>
          <button
            className="w-full py-4 rounded-xl bg-[#2C2C2E] text-[#0A84FF] font-headline-md text-headline-md flex items-center justify-center gap-2 hover:bg-[#2C2C2E]/80 transition-colors active:scale-[0.98]"
            onClick={() => navigateTo('settings')}
            type="button"
          >
            <Download className="size-5" />
            导入行程
          </button>
        </section>
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

function getTripEmoji(trip: Trip): string {
  const dest = (trip.destination || trip.title || '').toLowerCase()
  if (dest.includes('东京') || dest.includes('日本') || dest.includes('japan')) return '🗼'
  if (dest.includes('伦敦') || dest.includes('london') || dest.includes('英国')) return '🎡'
  if (dest.includes('巴黎') || dest.includes('paris') || dest.includes('法国')) return '🗼'
  if (dest.includes('纽约') || dest.includes('new york') || dest.includes('美国')) return '🗽'
  if (dest.includes('首尔') || dest.includes('seoul') || dest.includes('韩国')) return '🇰🇷'
  if (dest.includes('曼谷') || dest.includes('bangkok') || dest.includes('泰国')) return '🇹🇭'
  if (dest.includes('悉尼') || dest.includes('sydney') || dest.includes('澳洲')) return '🦘'
  if (dest.includes('迪拜') || dest.includes('dubai')) return '🏙️'
  if (dest.includes('罗马') || dest.includes('rome') || dest.includes('意大利')) return '🏛️'
  if (dest.includes('巴塞罗那') || dest.includes('barcelona') || dest.includes('西班牙')) return '🇪🇸'
  return '✈️'
}

function getTripStatus(trip: Trip): { label: string; className: string } {
  const now = new Date()
  const start = new Date(trip.startDate)
  const end = new Date(trip.endDate)
  if (now > end) return { label: '已完成', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400' }
  if (now >= start) return { label: '进行中', className: 'bg-primary/20 text-primary' }
  return { label: '计划中', className: 'bg-surface-container-high text-on-surface-variant' }
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
        return [trip.id, { dayCount: days.length, itemCount: items.length, ticketCount: tickets.length }] as const
      } catch { return null }
    }),
  )
  return {
    statsById: Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null)),
    trips,
  }
}
