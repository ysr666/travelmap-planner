import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronRight,
  FileText,
  MapPin,
  ReceiptText,
  Search,
  TrainFront,
} from 'lucide-react'
import {
  listDaysByTrip,
  listItemsByTrip,
  listLedgerExpenses,
  listTicketsByTrip,
  listTrips,
} from '../db'
import { EmptyState } from '../components/ui/EmptyState'
import { SkeletonLine } from '../components/ui/SkeletonLine'
import { subscribeTravelDataChanged } from '../lib/dataEvents'
import {
  buildLocalSearchIndex,
  buildLocalSearchView,
  localSearchCategoryLabels,
  type LocalSearchCategory,
  type LocalSearchFilter,
  type LocalSearchRecord,
} from '../lib/localSearch'
import { navigateTo } from '../lib/routes'
import { listTransportBookings, listTransportSegments } from '../lib/travelDocumentCenter'

const filterOptions: LocalSearchFilter[] = ['all', 'trip', 'item', 'ticket', 'transport', 'ledger']

export function SearchPage() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState<LocalSearchFilter>('all')
  const [index, setIndex] = useState<LocalSearchRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const nextIndex = await loadLocalSearchIndex()
        if (!cancelled) {
          setIndex(nextIndex)
          setError(null)
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : '读取本机搜索索引失败')
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

  const view = useMemo(
    () => buildLocalSearchView(index, { filter, query: deferredQuery }),
    [deferredQuery, filter, index],
  )
  const hasQuery = Boolean(deferredQuery.trim())

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-section-gap px-4 pb-36 pt-24">
      <section className="space-y-3">
        <div>
          <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">搜索</h2>
          <p className="font-body-md text-body-md text-on-surface-variant">本机旅行、行程、票据、交通与账本</p>
        </div>
        <label className="relative block">
          <span className="sr-only">搜索关键词</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant" />
          <input
            autoComplete="off"
            autoFocus
            className="min-h-12 w-full rounded-lg border border-outline-variant/30 bg-surface-container py-3 pl-12 pr-4 font-body-md text-body-md text-on-surface outline-none transition placeholder:text-on-surface-variant focus:border-primary focus:ring-2 focus:ring-primary/20"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="搜索地点、班次、票据、账单..."
            type="search"
            value={query}
          />
        </label>

        <div
          aria-label="搜索分类"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 app-scrollbar"
          role="tablist"
        >
          {filterOptions.map((option) => (
            <button
              aria-pressed={filter === option}
              className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition active:scale-95 tm-focus ${
                filter === option
                  ? 'bg-primary text-on-primary shadow-sm'
                  : 'border border-outline-variant/30 bg-surface-container text-on-surface-variant'
              }`}
              data-testid={`search-filter-${option}`}
              key={option}
              onClick={() => setFilter(option)}
              role="tab"
              type="button"
            >
              <span>{localSearchCategoryLabels[option]}</span>
              <span className={`min-w-5 rounded-full px-1.5 py-0.5 text-[10px] ${filter === option ? 'bg-white/20' : 'bg-surface-container-high'}`}>
                {view.counts[option]}
              </span>
            </button>
          ))}
        </div>
      </section>

      {isLoading ? <SearchLoading /> : null}

      {error ? (
        <div className="rounded-lg border border-error/30 bg-error-container px-4 py-3 text-sm font-medium text-on-error-container">
          {error}
        </div>
      ) : null}

      {!isLoading && !error && view.results.length === 0 ? (
        <EmptyState
          body={hasQuery
            ? `${localSearchCategoryLabels[filter]}中没有匹配内容，换个关键词或分类再试试。`
            : filter === 'all'
              ? '还没有可搜索的本机旅行数据。'
              : `还没有${localSearchCategoryLabels[filter]}记录。`}
          icon={<Search className="size-6" />}
          title={hasQuery ? '没有搜索结果' : '暂无本机内容'}
        />
      ) : null}

      {view.results.length > 0 ? (
        <section className="space-y-4" data-testid="local-search-results">
          <div className="flex items-end justify-between gap-3">
            <h3 className="font-headline-md text-headline-md text-on-surface">
              {hasQuery ? '搜索结果' : '最近内容'}
            </h3>
            <p className="text-xs font-semibold text-on-surface-variant">
              {filter === 'all' ? `${view.totalMatches} 条` : `${view.results.length} 条`}
            </p>
          </div>

          {view.groups.map((group) => (
            <SearchResultGroup group={group} key={group.category} />
          ))}
        </section>
      ) : null}
    </main>
  )
}

function SearchResultGroup({
  group,
}: {
  group: { category: LocalSearchCategory; label: string; results: ReturnType<typeof buildLocalSearchView>['results'] }
}) {
  return (
    <section className="space-y-2 [content-visibility:auto]" data-testid={`search-group-${group.category}`}>
      <div className="flex items-center justify-between gap-3 px-1">
        <h4 className="text-sm font-semibold text-on-surface">{group.label}</h4>
        <span className="text-xs text-on-surface-variant">{group.results.length}</span>
      </div>
      <div className="overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container">
        {group.results.map((result, index) => (
          <SearchResultRow
            key={result.record.id}
            record={result.record}
            separator={index < group.results.length - 1}
          />
        ))}
      </div>
    </section>
  )
}

function SearchResultRow({ record, separator }: { record: LocalSearchRecord; separator: boolean }) {
  const iconView = getRecordIcon(record.category)
  return (
    <button
      aria-label={`打开${record.title}`}
      className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-surface-container-high/50 active:scale-[0.99] tm-focus"
      data-testid="search-result-item"
      onClick={() => navigateTo(record.route, record.params)}
      type="button"
    >
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconView.className}`}>
        {iconView.icon}
      </span>
      <span className={`min-w-0 flex-1 ${separator ? 'border-b border-outline-variant/30 pb-3' : ''}`}>
        <span className="block truncate text-[11px] font-semibold text-on-surface-variant">{record.eyebrow}</span>
        <span className="mt-0.5 block line-clamp-2 text-sm font-semibold text-on-surface" title={record.title}>{record.title}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-on-surface-variant" title={record.detail}>{record.detail}</span>
      </span>
      <ChevronRight className={`size-4 shrink-0 text-on-surface-variant ${separator ? 'mb-3' : ''}`} />
    </button>
  )
}

function SearchLoading() {
  return (
    <div className="space-y-3 rounded-lg border border-outline-variant/30 bg-surface-container p-4">
      <SkeletonLine className="w-1/3" />
      <SkeletonLine className="w-full" />
      <SkeletonLine className="w-2/3" />
    </div>
  )
}

function getRecordIcon(category: LocalSearchCategory) {
  if (category === 'trip') return { className: 'bg-primary-container text-on-primary-container', icon: <CalendarDays className="size-5" /> }
  if (category === 'item') return { className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', icon: <MapPin className="size-5" /> }
  if (category === 'ticket') return { className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', icon: <FileText className="size-5" /> }
  if (category === 'transport') return { className: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300', icon: <TrainFront className="size-5" /> }
  return { className: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300', icon: <ReceiptText className="size-5" /> }
}

async function loadLocalSearchIndex() {
  const [trips, bookings] = await Promise.all([
    listTrips(),
    listTransportBookings(),
  ])
  const [tripDatasets, segmentGroups] = await Promise.all([
    Promise.all(trips.map(async (trip) => {
      const [days, items, tickets, expenses] = await Promise.all([
        listDaysByTrip(trip.id),
        listItemsByTrip(trip.id),
        listTicketsByTrip(trip.id),
        listLedgerExpenses(trip.id),
      ])
      return { days, expenses, items, tickets }
    })),
    Promise.all(bookings.map((booking) => listTransportSegments(booking.id))),
  ])

  return buildLocalSearchIndex({
    bookings,
    days: tripDatasets.flatMap((dataset) => dataset.days),
    expenses: tripDatasets.flatMap((dataset) => dataset.expenses),
    items: tripDatasets.flatMap((dataset) => dataset.items),
    segments: segmentGroups.flat(),
    tickets: tripDatasets.flatMap((dataset) => dataset.tickets),
    trips,
  })
}
