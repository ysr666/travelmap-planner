import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronRight, FileText, MapPin, Search } from 'lucide-react'
import { listDaysByTrip, listItemsByTrip, listTicketsByTrip, listTrips } from '../db'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import { formatDateRange } from '../lib/dates'
import { describeItemTime } from '../lib/itinerary'
import { getTicketCategoryLabel, getTicketDisplayTitle } from '../lib/tickets'
import { navigateTo } from '../lib/routes'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'

type SearchRecord =
  | { kind: 'trip'; trip: Trip }
  | { day: Day | null; item: ItineraryItem; kind: 'item'; trip: Trip }
  | { item: ItineraryItem | null; kind: 'ticket'; ticket: TicketMeta; trip: Trip }

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<SearchRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const trips = await listTrips()
        const nextRecords = await Promise.all(trips.map(loadTripRecords))
        if (!cancelled) {
          setRecords(nextRecords.flat())
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : '读取本地搜索索引失败')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load()
    const unsubscribe = subscribeTravelDataChanged(() => void load())
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return records.slice(0, 12)
    }
    return records.filter((record) => getSearchText(record).includes(needle)).slice(0, 30)
  }, [query, records])

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-section-gap px-4 pb-32 pt-24">
      <section className="space-y-3">
        <div>
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">搜索</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">查找本机保存的旅行、行程点和票据</p>
        </div>
        <label className="relative block">
          <span className="sr-only">搜索关键词</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant" />
          <input
            autoComplete="off"
            className="min-h-12 w-full rounded-xl border border-outline-variant/30 bg-surface-container py-3 pl-12 pr-4 font-body-md text-body-md text-on-surface outline-none transition placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/20"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索旅行、地点、票据..."
            type="search"
            value={query}
          />
        </label>
      </section>

      {isLoading ? (
        <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container p-4">
          <SkeletonLine className="w-1/2" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-2/3" />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-error/30 bg-error-container px-4 py-3 text-sm font-medium text-on-error-container">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && results.length === 0 ? (
        <EmptyState
          body={query.trim() ? '换个关键词再试试。搜索只读取本机数据，不会联网查询。' : '还没有可搜索的旅行数据。'}
          icon={<Search className="size-6" />}
          title="没有搜索结果"
        />
      ) : null}

      {results.length > 0 ? (
        <section className="space-y-stack-gap">
          <h3 className="font-headline-md text-headline-md text-on-surface">
            {query.trim() ? '搜索结果' : '最近内容'}
          </h3>
          <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container">
            {results.map((record, index) => (
              <SearchResultRow
                key={getRecordKey(record)}
                record={record}
                separator={index < results.length - 1}
              />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

async function loadTripRecords(trip: Trip): Promise<SearchRecord[]> {
  const [days, items, tickets] = await Promise.all([
    listDaysByTrip(trip.id),
    listItemsByTrip(trip.id),
    listTicketsByTrip(trip.id),
  ])
  const dayById = new Map(days.map((day) => [day.id, day]))
  const itemById = new Map(items.map((item) => [item.id, item]))
  return [
    { kind: 'trip', trip },
    ...items.map((item): SearchRecord => ({
      day: dayById.get(item.dayId) ?? null,
      item,
      kind: 'item',
      trip,
    })),
    ...tickets.map((ticket): SearchRecord => ({
      item: ticket.itemId ? itemById.get(ticket.itemId) ?? null : null,
      kind: 'ticket',
      ticket,
      trip,
    })),
  ]
}

function SearchResultRow({ record, separator }: { record: SearchRecord; separator: boolean }) {
  const view = getRecordView(record)
  return (
    <button
      aria-label={`打开${view.title}`}
      className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-surface-container-high/50 active:scale-[0.99] tm-focus"
      data-testid="search-result-item"
      onClick={view.onClick}
      type="button"
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-full ${view.iconClassName}`}>
        {view.icon}
      </span>
      <span className={`min-w-0 flex-1 ${separator ? 'border-b border-outline-variant/30 pb-4' : ''}`}>
        <span className="block line-clamp-2 font-body-lg text-body-lg text-on-surface" title={view.title}>{view.title}</span>
        <span className="mt-0.5 block line-clamp-2 font-label-sm text-label-sm text-on-surface-variant" title={view.detail}>{view.detail}</span>
      </span>
      <ChevronRight className={`size-5 shrink-0 text-on-surface-variant ${separator ? 'mb-4' : ''}`} />
    </button>
  )
}

function getRecordView(record: SearchRecord) {
  if (record.kind === 'trip') {
    return {
      detail: formatDateRange(record.trip.startDate, record.trip.endDate),
      icon: <CalendarDays className="size-5" />,
      iconClassName: 'bg-primary/20 text-primary',
      onClick: () => navigateTo('trip', { tripId: record.trip.id }),
      title: record.trip.title,
    }
  }

  if (record.kind === 'item') {
    return {
      detail: `${record.trip.title} · ${record.day?.title ?? '未分配日期'} · ${describeItemTime(record.item)}`,
      icon: <MapPin className="size-5" />,
      iconClassName: 'bg-secondary/20 text-secondary',
      onClick: () => navigateTo('item', {
        dayId: record.item.dayId,
        itemId: record.item.id,
        tripId: record.trip.id,
      }),
      title: record.item.title,
    }
  }

  return {
    detail: `${record.trip.title}${record.item ? ` · ${record.item.title}` : ''} · ${getTicketCategoryLabel(record.ticket)}`,
    icon: <FileText className="size-5" />,
    iconClassName: 'bg-tertiary/20 text-tertiary',
    onClick: () => navigateTo('tickets', { tripId: record.trip.id, itemId: record.ticket.itemId ?? '' }),
    title: getTicketDisplayTitle(record.ticket),
  }
}

function getSearchText(record: SearchRecord) {
  if (record.kind === 'trip') {
    return [record.trip.title, record.trip.destination, record.trip.notes].join(' ').toLowerCase()
  }
  if (record.kind === 'item') {
    return [
      record.trip.title,
      record.day?.title,
      record.item.title,
      record.item.locationName,
      record.item.address,
      record.item.notes,
    ].join(' ').toLowerCase()
  }
  return [
    record.trip.title,
    record.item?.title,
    record.ticket.title,
    getTicketCategoryLabel(record.ticket),
    record.ticket.fileName,
    record.ticket.note,
  ].join(' ').toLowerCase()
}

function getRecordKey(record: SearchRecord) {
  if (record.kind === 'trip') return `trip:${record.trip.id}`
  if (record.kind === 'item') return `item:${record.item.id}`
  return `ticket:${record.ticket.id}`
}
