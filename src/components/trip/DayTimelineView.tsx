import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Clock3, ExternalLink, GripVertical, MapPin, MoreHorizontal, Navigation, Pencil, Plus, RotateCcw, Save, Ticket, Trash2, X } from 'lucide-react'
import { deleteItineraryItemReversible, reorderDayItems, undoItineraryItemDeletion } from '../../db'
import { navigateTo } from '../../lib/routes'
import { Button } from '../ui/Button'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import { InlineStatus } from '../ui/InlineStatus'
import { SectionHeader } from '../ui/SectionHeader'
import { describePreviousTransport, transportModeLabels } from '../../lib/itinerary'
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
  const [lastDeletion, setLastDeletion] = useState<{ recordId: string; title: string } | null>(null)
  const [undoingRecordId, setUndoingRecordId] = useState<string | null>(null)
  const [draftItemIds, setDraftItemIds] = useState<string[]>([])
  const [orderingBaselineItemIds, setOrderingBaselineItemIds] = useState<string[]>([])
  const [isOrdering, setIsOrdering] = useState(false)
  const [isSavingOrder, setIsSavingOrder] = useState(false)
  const [openItemMenuId, setOpenItemMenuId] = useState<string | null>(null)
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
      const result = await deleteItineraryItemReversible(item.id, {
        expectedCurrentItemIds: items.map((candidate) => candidate.id),
        expectedItemUpdatedAt: item.updatedAt,
        tripId: trip.id,
      })
      setPendingDeleteItem(null)
      if (result) {
        setLastDeletion({
          recordId: result.operationRecord.id,
          title: result.deletedItem.title,
        })
      }
      await onItemsChange()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除行程点失败')
    } finally {
      setDeletingItemId(null)
    }
  }

  async function undoLastDeletion() {
    if (!lastDeletion) return
    setUndoingRecordId(lastDeletion.recordId)
    setActionError(null)
    try {
      const result = await undoItineraryItemDeletion(lastDeletion.recordId, {
        tripId: trip.id,
      })
      setLastDeletion(null)
      setActionMessage(result.restored
        ? `已恢复「${result.restoredItem.title}」及原顺序。`
        : `「${result.restoredItem.title}」已经恢复。`)
      await onItemsChange()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '撤销删除失败')
    } finally {
      setUndoingRecordId(null)
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
    <div className={compact ? 'space-y-3' : 'space-y-4'} data-testid="day-timeline">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-on-surface">当天日程</h3>
          <p className="mt-0.5 text-xs tm-muted">{items.length} 个行程点</p>
        </div>
        <div aria-label="日程操作" className="flex shrink-0 items-center gap-2" role="group">
          {isOrdering ? (
            <>
              <button
                aria-label="取消排序"
                className="flex size-11 items-center justify-center rounded-lg border border-outline-variant bg-surface text-on-surface tm-focus"
                disabled={isSavingOrder}
                onClick={cancelOrdering}
                title="取消排序"
                type="button"
              >
                <X className="size-4" />
              </button>
              <button
                aria-label="保存排序"
                className="flex size-11 items-center justify-center rounded-lg bg-primary text-on-primary disabled:opacity-40 tm-focus"
                disabled={!hasOrderChanges}
                onClick={() => void saveOrdering()}
                title="保存排序"
                type="button"
              >
                <Save className="size-4" />
              </button>
            </>
          ) : null}
          {!isOrdering && onSwitchToMap ? (
            <button aria-label="打开地图" className="flex size-11 items-center justify-center rounded-lg border border-outline-variant bg-surface text-on-surface tm-focus" onClick={onSwitchToMap} title="打开地图" type="button">
              <Navigation className="size-4" />
            </button>
          ) : null}
          {!isOrdering && items.length > 1 ? (
            <button
              aria-label="排序"
              className="flex size-11 items-center justify-center rounded-lg border border-outline-variant bg-surface text-on-surface tm-focus"
              onClick={startOrdering}
              title="排序"
              type="button"
            >
              <GripVertical className="size-4" />
            </button>
          ) : null}
          {!isOrdering ? (
            <button
              aria-label="新增"
              className="flex size-11 items-center justify-center rounded-lg bg-primary text-on-primary tm-focus"
              onClick={() => navigateTo('item/new', { tripId: trip.id, dayId: day.id, view: sourceView })}
              title="新增行程点"
              type="button"
            >
              <Plus className="size-4" />
            </button>
          ) : null}
        </div>
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

      {lastDeletion ? (
        <InlineStatus role="status" tone="success">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate">已移除「{lastDeletion.title}」；关联资料保留。</span>
            <Button
              aria-label={`撤销删除${lastDeletion.title}`}
              className="min-h-8 shrink-0 px-2 text-xs"
              icon={<RotateCcw className="size-3.5" />}
              loading={undoingRecordId === lastDeletion.recordId}
              onClick={() => void undoLastDeletion()}
              variant="ghost"
            >
              撤销
            </Button>
          </span>
        </InlineStatus>
      ) : null}

      {isOrdering ? (
        <InlineStatus tone="warning">
          这里只调整浏览和路线顺序，不会改动时间。交通方式、耗时和备注仍跟随当前行程点，保存后请检查新的相邻路段。
        </InlineStatus>
      ) : null}

      <section>
        {!compact ? <SectionHeader title="时间轴" /> : null}
        {items.length === 0 ? (
          <EmptyState
            body="点击新增按钮，添加当天的酒店、景点、交通或餐厅。"
            icon={<Clock3 className="size-6" />}
            title="这一天还没有行程点"
          />
        ) : (
          <div className="relative border-t border-outline-variant">
            <div className="absolute bottom-8 left-[71px] top-8 w-px bg-outline-variant" />
            {displayedItems.map((item, index) => {
              const previousItem = index > 0 ? displayedItems[index - 1] : null
              const previousTransportDescription = describePreviousTransport(item)
              const itemMenuOpen = openItemMenuId === item.id

              return (
                <div className="relative" key={item.id}>
                  {previousItem && previousTransportDescription ? (
                    <TransportSegment description={previousTransportDescription} />
                  ) : null}
                  <div
                    className="grid min-h-[72px] w-full grid-cols-[56px_16px_minmax(0,1fr)_44px] items-start gap-2 border-b border-outline-variant py-3"
                    data-testid={isOrdering ? 'day-order-item' : 'day-timeline-item'}
                  >
                    <time className="pt-0.5 text-right text-sm font-semibold text-on-surface-variant">
                      {item.startTime || '--:--'}
                    </time>
                    <span className="relative z-10 mt-1.5 flex justify-center">
                      <span className={`size-3 rounded-full border-2 ring-4 ring-surface ${
                        index === 0 ? 'border-primary bg-primary' : 'border-outline bg-surface'
                      }`} />
                    </span>
                    {isOrdering ? (
                      <div className="min-w-0">
                        <div className="flex items-center gap-1 text-xs font-semibold text-on-surface-variant">
                          <GripVertical className="size-3.5" />
                          调整顺序
                        </div>
                        <h3 className="mt-1 truncate text-base font-semibold text-on-surface">{item.title}</h3>
                        <p className="mt-1 truncate text-xs text-on-surface-variant">{item.locationName || item.address || '地点未填写'}</p>
                      </div>
                    ) : (
                      <button aria-label={`打开行程点 ${item.title}`} className="min-w-0 text-left tm-focus" onClick={() => onOpenItem(item)} type="button">
                        <span className="flex min-w-0 items-center gap-2">
                          <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-on-surface">{item.title}</h3>
                          {item.ticketIds.length > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-primary">
                              <Ticket className="size-3" />
                              {item.ticketIds.length}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-on-surface-variant">
                          <MapPin className="size-3.5 shrink-0" />
                          <span className="truncate">{item.locationName || item.address || '地点未填写'}</span>
                        </span>
                        <span className="mt-1 block truncate text-xs text-on-surface-variant">
                          {item.transportMode ? transportModeLabels[item.transportMode] : '交通未定'}
                        </span>
                      </button>
                    )}
                    {isOrdering ? (
                      <div className="flex flex-col">
                          <button
                            aria-label={`上移${item.title}`}
                            className="flex size-9 items-center justify-center rounded-lg text-on-surface-variant transition active:bg-surface-container-high disabled:opacity-30 tm-focus"
                            disabled={index === 0 || isSavingOrder}
                            onClick={() => moveDraftItem(item.id, -1)}
                            type="button"
                          >
                            <ArrowUp className="size-4" />
                          </button>
                          <button
                            aria-label={`下移${item.title}`}
                            className="flex size-9 items-center justify-center rounded-lg text-on-surface-variant transition active:bg-surface-container-high disabled:opacity-30 tm-focus"
                            disabled={index === displayedItems.length - 1 || isSavingOrder}
                            onClick={() => moveDraftItem(item.id, 1)}
                            type="button"
                          >
                            <ArrowDown className="size-4" />
                          </button>
                      </div>
                    ) : (
                      <button
                        aria-expanded={itemMenuOpen}
                        aria-label={`${item.title}更多操作`}
                        className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container-high tm-focus"
                        onClick={() => setOpenItemMenuId((current) => current === item.id ? null : item.id)}
                        type="button"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    )}
                  </div>
                  {!isOrdering && itemMenuOpen ? (
                    <div className="ml-20 grid grid-cols-2 gap-2 border-b border-outline-variant py-3" data-testid="day-timeline-item-menu">
                      {previousItem ? <DirectionsLinks fromItem={previousItem} toItem={item} /> : null}
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-outline-variant bg-surface px-3 text-sm font-semibold text-on-surface tm-focus"
                        onClick={() => navigateTo('item/edit', { tripId: trip.id, dayId: day.id, itemId: item.id, view: sourceView })}
                        type="button"
                      >
                        <Pencil className="size-4" />
                        编辑
                      </button>
                      <button
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-error-container px-3 text-sm font-semibold text-on-error-container tm-focus"
                        disabled={deletingItemId === item.id}
                        onClick={() => setPendingDeleteItem(item)}
                        type="button"
                      >
                        <Trash2 className="size-4" />
                        删除
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        body="仅移除行程点；票据、账本和订单保留，可撤销。"
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
    <div className="ml-[80px] flex min-h-8 items-center gap-2 border-b border-outline-variant px-1 text-xs font-medium leading-5 text-on-surface-variant">
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
    <div className="col-span-2 grid grid-cols-2 gap-2">
      <a
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface px-2 text-xs font-semibold text-primary"
        href={appleUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Navigation className="size-3.5" />
        Apple 路线
      </a>
      <a
        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-outline-variant bg-surface px-2 text-xs font-semibold text-on-surface"
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
