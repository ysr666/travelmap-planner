import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Clock3, ExternalLink, GripVertical, MapPin, Navigation, Plus, Save, Ticket, Trash2, X } from 'lucide-react'
import { deleteItineraryItemCascade, reorderDayItems } from '../../db'
import { navigateTo } from '../../lib/routes'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ActionToolbar } from '../ui/ActionToolbar'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { InlineStatus } from '../ui/InlineStatus'
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
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [draftItemIds, setDraftItemIds] = useState<string[]>([])
  const [orderingBaselineItemIds, setOrderingBaselineItemIds] = useState<string[]>([])
  const [isOrdering, setIsOrdering] = useState(false)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const displayedItems = isOrdering
    ? draftItemIds.flatMap((itemId) => {
        const item = itemById.get(itemId)
        return item ? [item] : []
      })
    : items
  const hasOrderChanges = isOrdering && draftItemIds.some((itemId, index) => itemId !== items[index]?.id)

  async function confirmDeleteItem() {
    if (!pendingDeleteItem) {
      return
    }

    const item = pendingDeleteItem
    setDeletingItemId(item.id)
    setActionError(null)
    setActionMessage(null)
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

  function startOrdering() {
    setActionError(null)
    setActionMessage(null)
    const currentItemIds = items.map((item) => item.id)
    setDraftItemIds(currentItemIds)
    setOrderingBaselineItemIds(currentItemIds)
    setIsOrdering(true)
  }

  function cancelOrdering() {
    setDraftItemIds([])
    setOrderingBaselineItemIds([])
    setIsOrdering(false)
    setActionError(null)
  }

  function moveDraftItem(itemId: string, direction: -1 | 1) {
    setDraftItemIds((current) => {
      const index = current.indexOf(itemId)
      const targetIndex = index + direction
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[targetIndex]] = [next[targetIndex], next[index]]
      return next
    })
  }

  async function saveOrdering() {
    setActionError(null)
    setActionMessage(null)
    setIsSavingOrder(true)
    try {
      await reorderDayItems(day.id, draftItemIds, orderingBaselineItemIds)
      setIsOrdering(false)
      setDraftItemIds([])
      setOrderingBaselineItemIds([])
      setActionMessage('当天顺序已保存；时间和交通信息仍跟随各自行程点。')
      await onItemsChange()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '保存行程顺序失败')
    } finally {
      setIsSavingOrder(false)
    }
  }

  return (
    <div className={compact ? 'space-y-4' : 'space-y-5'} data-testid="day-timeline">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface dark:text-on-surface">当天日程</h3>
          <p className="mt-0.5 text-xs tm-muted">{items.length} 个行程点</p>
        </div>
        <ActionToolbar align="end" ariaLabel="日程操作" className="max-w-[70%] shrink-0">
          {isOrdering ? (
            <>
              <Button
                className="min-h-11 px-3"
                disabled={isSavingOrder}
                icon={<X className="size-4" />}
                onClick={cancelOrdering}
                variant="secondary"
              >
                取消
              </Button>
              <Button
                className="min-h-11 px-3"
                disabled={!hasOrderChanges}
                icon={<Save className="size-4" />}
                loading={isSavingOrder}
                onClick={() => void saveOrdering()}
              >
                保存
              </Button>
            </>
          ) : null}
          {!isOrdering && onSwitchToMap ? (
            <Button className="min-h-11 px-3 whitespace-nowrap" onClick={onSwitchToMap} variant="secondary">
              地图
            </Button>
          ) : null}
          {!isOrdering && items.length > 1 ? (
            <Button
              className="min-h-11 px-3"
              icon={<GripVertical className="size-4" />}
              onClick={startOrdering}
              variant="secondary"
            >
              排序
            </Button>
          ) : null}
          {!isOrdering ? (
            <Button
              className="min-h-11 px-3"
              icon={<Plus className="size-4" />}
              onClick={() => navigateTo('item/new', { tripId: trip.id, dayId: day.id, view: sourceView })}
            >
              新增
            </Button>
          ) : null}
        </ActionToolbar>
      </div>

      {actionError ? (
        <InlineStatus role="alert" size="md" tone="error">
          {actionError}
        </InlineStatus>
      ) : null}

      {actionMessage ? (
        <InlineStatus role="status" tone="success">
          {actionMessage}
        </InlineStatus>
      ) : null}

      {isOrdering ? (
        <InlineStatus tone="warning">
          这里只调整浏览和路线顺序，不会改动时间。交通方式、耗时和备注仍跟随当前行程点，保存后请检查新的相邻路段。
        </InlineStatus>
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
            {displayedItems.map((item, index) => {
              const previousItem = index > 0 ? displayedItems[index - 1] : null
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
                    <Card variant="grouped" data-testid={isOrdering ? 'day-order-item' : 'day-timeline-item'}>
                      {isOrdering ? <div className="flex items-start gap-3">
                        <GripVertical aria-hidden="true" className="mt-1 size-4 shrink-0 text-outline" />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-center gap-1.5 text-xs font-semibold tm-muted">
                            <Clock3 className="size-3.5" />
                            {describeItemTime(item)}
                          </p>
                          <h3 className="mt-1 truncate text-base font-semibold text-on-surface">{item.title}</h3>
                          <p className="mt-1 truncate text-xs tm-muted">{item.locationName || item.address || '地点未填写'}</p>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            aria-label={`上移${item.title}`}
                            className="flex size-11 items-center justify-center rounded-xl text-on-surface-variant transition active:bg-surface-container-high disabled:opacity-30 tm-focus"
                            disabled={index === 0 || isSavingOrder}
                            onClick={() => moveDraftItem(item.id, -1)}
                            type="button"
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            aria-label={`下移${item.title}`}
                            className="flex size-11 items-center justify-center rounded-xl text-on-surface-variant transition active:bg-surface-container-high disabled:opacity-30 tm-focus"
                            disabled={index === displayedItems.length - 1 || isSavingOrder}
                            onClick={() => moveDraftItem(item.id, 1)}
                            type="button"
                          >
                            <ArrowDown className="size-4" />
                          </button>
                        </div>
                      </div> : <button className="w-full text-left" onClick={() => onOpenItem(item)} type="button">
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
                      </button>}
                      {!isOrdering && previousItem ? (
                        <DirectionsLinks fromItem={previousItem} toItem={item} />
                      ) : null}
                      {!isOrdering ? (
                        <div className="mt-3 border-t tm-row pt-3">
                          <ActionToolbar align="between" ariaLabel={`${item.title} 操作`}>
                            <span className="tm-chip">
                              <Ticket className="size-3.5" />
                              {item.ticketIds.length}
                            </span>
                            <ActionToolbar align="end">
                              <Button
                                className="min-h-11 rounded-xl px-3"
                                onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
                                variant="secondary"
                              >
                                编辑
                              </Button>
                              <Button
                                className="min-h-11 rounded-xl px-3"
                                disabled={deletingItemId === item.id}
                                icon={<Trash2 className="size-4" />}
                                onClick={() => setPendingDeleteItem(item)}
                                variant="destructive"
                              >
                                删除
                              </Button>
                            </ActionToolbar>
                          </ActionToolbar>
                        </div>
                      ) : null}
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
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-sky-50/80 px-2 text-xs font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300"
        href={appleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Navigation className="size-3.5" />
        Apple 路线
      </a>
      <a
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl tm-surface px-2 text-xs font-semibold text-on-surface dark:text-outline-variant"
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
