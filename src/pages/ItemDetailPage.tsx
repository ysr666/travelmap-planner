import { useCallback, useMemo, useState } from 'react'
import { Edit3, ExternalLink, FileText, MapPin, Navigation, Ticket, Trash2 } from 'lucide-react'
import {
  deleteItineraryItemCascade,
  getItineraryItem,
  listItemsByDay,
  listTicketsByItem,
  updateItineraryItem,
} from '../db'
import { ItineraryItemForm, type ItineraryItemFormValue } from '../components/ItineraryItemForm'
import { TicketPreview } from '../components/TicketPreview'
import {
  buildAppleMapsDirectionsUrl,
  buildAppleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsUrl,
} from '../lib/mapLinks'
import { describeItemTime, describePreviousTransport, transportModeLabels } from '../lib/itinerary'
import { formatDate } from '../lib/dates'
import { navigateTo } from '../lib/routes'
import {
  describeTicketMetaLine,
  formatTicketCreatedAt,
  getTicketDisplayTitle,
} from '../lib/tickets'
import type { Day, ItineraryItem, TicketMeta, Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { ListRow } from '../components/ui/ListRow'
import { SectionHeader } from '../components/ui/SectionHeader'

type ItemDetailContentProps = {
  trip: Trip
  day: Day
  item: ItineraryItem
  onClose: () => void
  onItemDeleted: () => void
}

export function ItemDetailContent({ trip, day, item: initialItem, onClose, onItemDeleted }: ItemDetailContentProps) {
  void onClose
  const [item, setItem] = useState<ItineraryItem>(initialItem)
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [tickets, setTickets] = useState<TicketMeta[]>([])
  const [previewTicket, setPreviewTicket] = useState<TicketMeta | null>(null)
  const [isLoadingRelations, setIsLoadingRelations] = useState(true)
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const loadRelations = useCallback(async () => {
    setIsLoadingRelations(true)
    try {
      const [foundDayItems, foundTickets] = await Promise.all([
        listItemsByDay(day.id),
        listTicketsByItem(item.id),
      ])
      setDayItems(foundDayItems)
      setTickets(foundTickets)
    } catch {
      // silently ignore
    } finally {
      setIsLoadingRelations(false)
    }
  }, [day.id, item.id])

  useState(() => {
    void loadRelations()
  })

  const itemIndex = useMemo(() => {
    return dayItems.findIndex((dayItem) => dayItem.id === item.id)
  }, [dayItems, item.id])
  const previousItem = itemIndex > 0 ? dayItems[itemIndex - 1] : null

  async function handleUpdateItem(value: ItineraryItemFormValue) {
    setIsSubmitting(true)
    setActionError(null)
    try {
      await updateItineraryItem(item.id, value)
      setIsEditing(false)
      const refreshed = await getItineraryItem(item.id)
      if (refreshed) {
        setItem(refreshed)
      }
      await loadRelations()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '保存修改失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function confirmDeleteItem() {
    setIsDeleting(true)
    setActionError(null)
    try {
      await deleteItineraryItemCascade(item.id)
      setIsDeleteConfirmOpen(false)
      onItemDeleted()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : '删除行程点失败')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5 pb-2">
      <Card className="space-y-3">
        {actionError ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
            {actionError}
          </div>
        ) : null}
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-sky-600">
              {formatDate(day.date)} · {describeItemTime(item)}
            </p>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">{item.title}</h2>
          </div>
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-xs font-semibold text-sky-600">
            {item.transportMode ? transportModeLabels[item.transportMode] : '未定'}
          </span>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="flex items-start gap-2 text-sm font-semibold text-slate-950">
            <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
            {item.locationName || '地点未填写'}
          </p>
          <p className="mt-1 pl-6 text-sm leading-6 text-slate-500">
            {item.address || '地址未填写'}
          </p>
          {item.lat !== undefined && item.lng !== undefined ? (
            <p className="mt-1 pl-6 text-xs text-slate-400">
              {item.lat}, {item.lng}
            </p>
          ) : null}
        </div>
        <p className="text-sm leading-6 text-slate-500">{item.notes || '暂无备注。'}</p>
        <PreviousTransportCard
          isFirstItem={itemIndex <= 0}
          item={item}
          previousItem={previousItem}
        />
        <div className="grid grid-cols-2 gap-3">
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white shadow-[0_6px_16px_var(--color-primary-shadow)]"
            href={buildAppleMapsUrl(item)}
            rel="noreferrer"
            target="_blank"
          >
            <Navigation className="size-4" />
            Apple 地图
          </a>
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-900 ring-1 ring-slate-200/80"
            href={buildGoogleMapsUrl(item)}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-4" />
            Google 地图
          </a>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            icon={<Edit3 className="size-4" />}
            onClick={() => setIsEditing((current) => !current)}
            variant="secondary"
          >
            编辑
          </Button>
          <Button
            className="text-red-600"
            disabled={isDeleting}
            icon={<Trash2 className="size-4" />}
            onClick={() => setIsDeleteConfirmOpen(true)}
            variant="secondary"
          >
            删除
          </Button>
        </div>
      </Card>

      {isEditing ? (
        <Card>
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-950">编辑行程点</h3>
            <p className="mt-1 text-sm text-slate-500">{item.title}</p>
          </div>
          <ItineraryItemForm
            initialItem={item}
            loading={isSubmitting}
            onCancel={() => setIsEditing(false)}
            onSubmit={handleUpdateItem}
            submitLabel="保存修改"
          />
        </Card>
      ) : null}

      <section className="space-y-3">
        <SectionHeader
          action="添加票据"
          onAction={() => navigateTo('tickets', { tripId: trip.id, itemId: item.id })}
          title={`绑定票据（${tickets.length}）`}
        />
        {isLoadingRelations ? (
          <div className="space-y-2">
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
            <div className="h-10 animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : tickets.length === 0 ? (
          <EmptyState
            body="可以上传门票、车票、二维码截图或 PDF，并绑定到这个行程点。"
            icon={<Ticket className="size-6" />}
            title="暂无绑定票据"
          />
        ) : (
          <Card className="divide-y divide-slate-100 py-1">
            {tickets.map((ticket) => (
              <ListRow
                detail={`${describeTicketMetaLine(ticket)} · ${formatTicketCreatedAt(ticket.createdAt)}`}
                icon={<FileText className="size-5" />}
                key={ticket.id}
                meta="查看"
                onClick={() => setPreviewTicket(ticket)}
                title={getTicketDisplayTitle(ticket)}
              />
            ))}
          </Card>
        )}
      </section>

      {previewTicket ? (
        <TicketPreview
          key={previewTicket.id}
          onClose={() => setPreviewTicket(null)}
          ticket={previewTicket}
        />
      ) : null}

      <ConfirmDialog
        body="删除后，绑定到该行程点的票据记录也会被移除。"
        confirmLabel="删除行程点"
        loading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setIsDeleteConfirmOpen(false)
          }
        }}
        onConfirm={() => void confirmDeleteItem()}
        open={isDeleteConfirmOpen}
        title={`确认删除「${item.title}」吗？`}
      />
    </div>
  )
}

function PreviousTransportCard({
  item,
  previousItem,
  isFirstItem,
}: {
  item: ItineraryItem
  previousItem: ItineraryItem | null
  isFirstItem: boolean
}) {
  const description = describePreviousTransport(item)
  const appleUrl = previousItem
    ? buildAppleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
    : null
  const googleUrl = previousItem
    ? buildGoogleMapsDirectionsUrl(previousItem, item, item.previousTransportMode)
    : null

  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-950">从上一站到此处</h3>
      {isFirstItem ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">
          这是当天第一个行程点，没有上一站交通段。
        </p>
      ) : (
        <>
          {description ? (
            <div className="mt-2 space-y-1.5 text-sm text-slate-600">
              {item.previousTransportMode ? (
                <p>
                  <span className="font-semibold text-slate-500">交通方式：</span>
                  {transportModeLabels[item.previousTransportMode]}
                </p>
              ) : null}
              {item.previousTransportDurationMinutes !== undefined ? (
                <p>
                  <span className="font-semibold text-slate-500">预计耗时：</span>
                  {item.previousTransportDurationMinutes} 分钟
                </p>
              ) : null}
              {item.previousTransportNote ? (
                <p>
                  <span className="font-semibold text-slate-500">交通备注：</span>
                  {item.previousTransportNote}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm leading-6 text-slate-500">尚未填写交通信息。</p>
          )}

          {appleUrl && googleUrl ? (
            <div className="mt-3 grid grid-cols-1 gap-2">
              <a
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-xs font-semibold text-white"
                href={appleUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Navigation className="size-4" />
                用 Apple Maps 查看上一站到此处路线
              </a>
              <a
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-slate-800 ring-1 ring-slate-200"
                href={googleUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink className="size-4" />
                用 Google Maps 查看上一站到此处路线
              </a>
            </div>
          ) : (
            <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-400">
              上一站或当前地点信息不足
            </p>
          )}
        </>
      )}
    </div>
  )
}
