import { useState } from 'react'
import { ArrowDown, Clock3, ExternalLink, MapPin, Navigation, Plus, Ticket, Trash2 } from 'lucide-react'
import { deleteItineraryItemCascade } from '../../db'
import { navigateTo } from '../../lib/routes'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { SectionHeader } from '../ui/SectionHeader'
import { describeItemTime, describePreviousTransport, transportModeLabels } from '../../lib/itinerary'
import { buildAppleMapsDirectionsUrl, buildGoogleMapsDirectionsUrl } from '../../lib/mapLinks'
import type { Day, ItineraryItem, Trip } from '../../types'

type DayTimelineViewProps = {
  trip: Trip
  day: Day
  items: ItineraryItem[]
  onItemsChange: () => Promise<void> | void
  onOpenItem: (item: ItineraryItem) => void
  compact?: boolean
  onSwitchToMap?: () => void
  sourceView?: 'schedule' | 'map'
}

export function DayTimelineView({
  trip,
  day,
  items,
  onItemsChange,
  onOpenItem,
  compact = false,
  onSwitchToMap,
  sourceView = 'schedule',
}: DayTimelineViewProps) {
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null)
  const [pendingDeleteItem, setPendingDeleteItem] = useState<ItineraryItem | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function confirmDeleteItem() {
    if (!pendingDeleteItem) {
      return
    }

    const item = pendingDeleteItem
    setDeletingItemId(item.id)
    setActionError(null)
    try {
      await deleteItineraryItemCascade(item.id)
      setPendingDeleteItem(null)
      await onItemsChange()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除行程点失败')
    } finally {
      setDeletingItemId(null)
    }
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface dark:text-on-surface">当天日程</h3>
          <p className="mt-0.5 text-xs tm-muted">{items.length} 个行程点</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {onSwitchToMap ? (
            <Button className="min-h-10 px-3 whitespace-nowrap" onClick={onSwitchToMap} variant="secondary">
              地图
            </Button>
          ) : null}
          <Button
            className="min-h-10 px-3"
            icon={<Plus className="size-4" />}
            onClick={() => navigateTo('item/new', { tripId: trip.id, dayId: day.id, view: sourceView })}
          >
            新增
          </Button>
        </div>
      </div>

      {actionError ? (
        <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300">
          {actionError}
        </div>
      ) : null}

      <section className="space-y-3">
        {!compact ? <SectionHeader title="时间轴" /> : null}
        {items.length === 0 ? (
          <EmptyState
            body="点击新增按钮，添加当天的酒店、景点、交通或餐厅。"
            icon={<Clock3 className="size-6" />}
            title="这一天还没有行程点"
          />
        ) : (
          <div className="space-y-3">
            {items.map((item, index) => {
              const previousItem = index > 0 ? items[index - 1] : null
              const previousTransportDescription = describePreviousTransport(item)

              return (
                <div className="space-y-2" key={item.id}>
                  {previousItem && previousTransportDescription ? (
                    <TransportSegment description={previousTransportDescription} />
                  ) : null}
                  <div className="grid w-full grid-cols-[2.8rem_1fr] gap-3">
                    <div className="relative flex justify-center">
                      <div className="z-10 flex size-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-white shadow-[0_6px_14px_var(--color-primary-shadow)]">
                        {index + 1}
                      </div>
                      {index !== items.length - 1 ? (
                        <div className="absolute top-9 h-[calc(100%+0.75rem)] w-px bg-surface-container-high dark:bg-surface-container-high" />
                      ) : null}
                    </div>
                    <Card variant="grouped">
                      <button className="w-full text-left" onClick={() => onOpenItem(item)} type="button">
                        <p className="flex items-center gap-1.5 text-xs font-semibold tm-muted">
                          <Clock3 className="size-3.5" />
                          {describeItemTime(item)} ·{' '}
                          {item.transportMode ? transportModeLabels[item.transportMode] : '交通未定'}
                        </p>
                        <h3 className="mt-1 truncate text-lg font-semibold text-on-surface dark:text-on-surface">{item.title}</h3>
                        <p className="mt-1 flex items-start gap-1.5 text-sm leading-5 tm-muted">
                          <MapPin className="mt-0.5 size-4 shrink-0" />
                          <span className="line-clamp-2">
                            {item.locationName || item.address || '地点未填写'}
                          </span>
                        </p>
                      </button>
                      {previousItem ? (
                        <DirectionsLinks fromItem={previousItem} toItem={item} />
                      ) : null}
                      <div className="mt-3 flex items-center justify-between gap-2 border-t tm-row pt-3">
                        <span className="tm-chip">
                          <Ticket className="size-3.5" />
                          {item.ticketIds.length}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            className="min-h-9 rounded-xl px-3"
                            onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
                            variant="secondary"
                          >
                            编辑
                          </Button>
                          <Button
                            className="min-h-9 rounded-xl px-3"
                            disabled={deletingItemId === item.id}
                            icon={<Trash2 className="size-4" />}
                            onClick={() => setPendingDeleteItem(item)}
                            variant="destructive"
                          >
                            删除
                          </Button>
                        </div>
                      </div>
                    </Card>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        body="删除后，绑定到该行程点的票据记录也会被移除。"
        confirmLabel="删除行程点"
        loading={Boolean(deletingItemId)}
        onCancel={() => {
          if (!deletingItemId) {
            setPendingDeleteItem(null)
          }
        }}
        onConfirm={() => void confirmDeleteItem()}
        open={Boolean(pendingDeleteItem)}
        title={pendingDeleteItem ? `确认删除「${pendingDeleteItem.title}」吗？` : '确认删除这个行程点吗？'}
      />
    </div>
  )
}

function TransportSegment({ description }: { description: string }) {
  return (
    <div className="ml-[3.4rem] flex items-center gap-2 rounded-lg bg-surface-container-low/80 px-3 py-2 text-xs font-medium leading-5 tm-muted dark:bg-surface-container-highest/45">
      <ArrowDown className="size-3.5 shrink-0 text-outline" />
      <span className="min-w-0 truncate">{description}</span>
    </div>
  )
}

function DirectionsLinks({ fromItem, toItem }: { fromItem: ItineraryItem; toItem: ItineraryItem }) {
  const appleUrl = buildAppleMapsDirectionsUrl(fromItem, toItem, toItem.previousTransportMode)
  const googleUrl = buildGoogleMapsDirectionsUrl(fromItem, toItem, toItem.previousTransportMode)

  if (!appleUrl || !googleUrl) {
    return (
      <p className="mt-3 rounded-xl bg-surface-container-low/80 px-3 py-2 text-xs font-medium tm-muted dark:bg-surface-container-highest/45">
        上一站或当前地点信息不足
      </p>
    )
  }

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <a
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-sky-50/80 px-2 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
        href={appleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Navigation className="size-3.5" />
        Apple 路线
      </a>
      <a
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-xl tm-surface px-2 text-xs font-semibold text-on-surface dark:text-outline-variant"
        href={googleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-3.5" />
        Google 路线
      </a>
    </div>
  )
}
