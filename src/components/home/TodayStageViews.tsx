import {
  CalendarDays,
  ChevronRight,
  FileText,
  Hotel,
  Import,
  MapPinCheck,
  Plane,
  Plus,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Ticket,
  WalletCards,
} from 'lucide-react'
import { getTicketDisplayTitle } from '../../lib/tickets'
import { formatDateRange, formatShortDate } from '../../lib/dates'
import { navigateTo } from '../../lib/routes'
import { plainDateDaysBetween } from '../../lib/timeSemantics'
import type { HomeTripOverview, HomeTripSnapshot } from '../../lib/homeOverview'
import type { TicketMeta } from '../../types'
import { Button } from '../ui/Button'
import { DisclosureRow } from '../ui/DisclosureRow'
import { EmptyState } from '../ui/EmptyState'
import { RecordRow } from '../ui/RecordRow'
import { Section } from '../ui/Section'
import { SkeletonLine } from '../ui/SkeletonLine'
import { StatusStrip } from '../ui/StatusStrip'

type TodayStageViewProps = {
  error?: string | null
  otherTrips: HomeTripOverview[]
  overview: HomeTripOverview
  snapshot: HomeTripSnapshot
}

export function UpcomingTodayView({ error, otherTrips, overview, snapshot }: TodayStageViewProps) {
  const daysUntilDeparture = plainDateDaysBetween(overview.today, overview.trip.startDate)
  const issues = getUpcomingIssues(snapshot)
  const readyTickets = getReadyTickets(snapshot.tickets)

  return (
    <div className="today-stage-page" data-testid="today-upcoming">
      <header className="today-stage-hero">
        <p className="today-stage-kicker">{formatShortDate(overview.trip.startDate)}出发</p>
        <h2 className="today-stage-title">
          {typeof daysUntilDeparture === 'number' && daysUntilDeparture > 0
            ? <>还有 <strong>{daysUntilDeparture}</strong> 天</>
            : '准备出发'}
        </h2>
        <p className="today-stage-destination">{overview.trip.destination || overview.trip.title}</p>
      </header>

      {issues.total > 0 ? (
        <StatusStrip
          action={(
            <button
              className="today-stage-inline-action tm-focus"
              data-testid="home-smart-repair"
              onClick={() => openSmartRepair()}
              type="button"
            >
              一键补全
            </button>
          )}
          icon={<MapPinCheck className="size-5" />}
          tone="danger"
        >
          {issues.label}
        </StatusStrip>
      ) : (
        <StatusStrip icon={<ShieldCheck className="size-5" />} tone="success">
          出发准备已就绪
        </StatusStrip>
      )}

      {error ? <p className="today-inline-error" role="status">{error}</p> : null}

      <Section
        action={(
          <button
            className="today-stage-section-link tm-focus"
            onClick={() => navigateTo('documents', { tripId: overview.trip.id })}
            type="button"
          >
            查看全部 <ChevronRight className="size-4" />
          </button>
        )}
        title="出发准备"
      >
        <div className="today-ready-list">
          {readyTickets.length > 0 ? readyTickets.map((ticket) => (
            <RecordRow
              key={ticket.id}
              leading={<ReadyTicketIcon ticket={ticket} />}
              meta={<span className="today-ready-status">已就绪</span>}
              onClick={() => navigateTo('documents', {
                tab: 'attachments',
                ticketId: ticket.id,
                tripId: overview.trip.id,
              })}
              subtitle={getReadyTicketSubtitle(ticket)}
              title={getTicketDisplayTitle(ticket)}
            />
          )) : (
            <RecordRow
              leading={<Import className="size-5" />}
              onClick={() => navigateTo('inbox')}
              subtitle="导入机票、住宿、保险或门票"
              title="添加旅行资料"
            />
          )}
        </div>
      </Section>

      <Button
        className="w-full"
        icon={<CalendarDays className="size-4" />}
        onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
      >
        查看全部行程
      </Button>

      <OtherTrips overviews={otherTrips} />
    </div>
  )
}

export function CompletedTodayView({ error, otherTrips, overview, snapshot }: TodayStageViewProps) {
  return (
    <div className="today-stage-page" data-testid="today-completed">
      <header className="today-stage-hero">
        <p className="today-stage-kicker">旅程已结束</p>
        <h2 className="today-stage-title">{overview.trip.title}</h2>
        <p className="today-stage-destination">{formatDateRange(overview.trip.startDate, overview.trip.endDate)}</p>
      </header>

      {error ? <p className="today-inline-error" role="status">{error}</p> : null}

      <Section title="旅行记录">
        <div className="today-ready-list">
          <RecordRow
            leading={<CalendarDays className="size-5" />}
            meta={`${overview.stats.dayCount} 天`}
            onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
            subtitle={`${overview.stats.itemCount} 个行程点`}
            title="行程回顾"
          />
          <RecordRow
            leading={<FileText className="size-5" />}
            meta={`${snapshot.tickets.length} 份`}
            onClick={() => navigateTo('documents', { tripId: overview.trip.id })}
            subtitle="票据、订单与证件"
            title="旅行资料"
          />
          <RecordRow
            leading={<WalletCards className="size-5" />}
            onClick={() => navigateTo('ledger', { tripId: overview.trip.id })}
            subtitle="支出、分类与结算"
            title="费用汇总"
          />
        </div>
      </Section>

      <OtherTrips overviews={otherTrips} />
    </div>
  )
}

export function EmptyTodayView({
  error,
  isCreatingDemo,
  onCreateDemo,
}: {
  error: string | null
  isCreatingDemo: boolean
  onCreateDemo: () => void
}) {
  return (
    <div className="today-empty-page" data-testid="today-empty">
      <div className="today-empty-content">
        <EmptyState
          body="先把已有订单、行程单和票据放进来。"
          icon={<Import className="size-6" />}
          title="开始准备下一次旅行"
        />
        {error ? <p className="today-inline-error" role="status">{error}</p> : null}
        <Button className="w-full" icon={<Import className="size-4" />} onClick={() => navigateTo('inbox')}>
          导入旅行材料
        </Button>
        <Button
          className="w-full"
          icon={<Sparkles className="size-4" />}
          onClick={() => navigateTo('ai-draft')}
          variant="secondary"
        >
          用 AI 创建旅行
        </Button>
        <button className="today-empty-manual tm-focus" onClick={() => navigateTo('trip/new')} type="button">
          <Plus className="size-4" /> 手动新建
        </button>
        {import.meta.env.VITE_E2E_AUTH_BYPASS === '1' ? (
          <Button className="w-full" loading={isCreatingDemo} onClick={onCreateDemo} variant="ghost">
            创建示例旅行
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function TodayStageLoading() {
  return (
    <div aria-label="正在加载今日行程" className="today-stage-page" role="status">
      <div className="space-y-3 py-4">
        <SkeletonLine className="w-1/3" />
        <SkeletonLine className="h-8 w-2/3" />
        <SkeletonLine className="w-1/2" />
      </div>
      <SkeletonLine className="h-12 w-full" />
      <div className="mt-6 space-y-3">
        <SkeletonLine className="h-16 w-full" />
        <SkeletonLine className="h-16 w-full" />
        <SkeletonLine className="h-16 w-full" />
      </div>
    </div>
  )
}

function OtherTrips({ overviews }: { overviews: HomeTripOverview[] }) {
  if (overviews.length === 0) return null
  return (
    <DisclosureRow className="today-stage-other-trips" detail={`${overviews.length} 个`} title="其他旅行">
      {overviews.map((overview) => (
        <RecordRow
          key={overview.trip.id}
          meta={overview.statusLabel}
          onClick={() => navigateTo('trip', { tripId: overview.trip.id })}
          subtitle={formatDateRange(overview.trip.startDate, overview.trip.endDate)}
          title={overview.trip.title}
        />
      ))}
    </DisclosureRow>
  )
}

function getUpcomingIssues(snapshot: HomeTripSnapshot) {
  const missingCoordinateCount = snapshot.items.filter((item) => (
    typeof item.lat !== 'number' || !Number.isFinite(item.lat)
    || typeof item.lng !== 'number' || !Number.isFinite(item.lng)
  )).length
  const missingTicketCount = snapshot.tickets.length === 0 ? 1 : 0
  const missingScheduleCount = snapshot.days.length === 0 || snapshot.items.length === 0 ? 1 : 0
  const total = missingCoordinateCount + missingTicketCount + missingScheduleCount
  if (missingCoordinateCount > 0) return { label: `${missingCoordinateCount} 个地点待补全`, total }
  if (missingScheduleCount > 0) return { label: '行程安排待补全', total }
  if (missingTicketCount > 0) return { label: '旅行资料待添加', total }
  return { label: '', total: 0 }
}

function getReadyTickets(tickets: TicketMeta[]) {
  const ranked = [...tickets].sort((first, second) => (
    getReadyTicketRank(first) - getReadyTicketRank(second)
    || second.updatedAt - first.updatedAt
  ))
  return ranked.slice(0, 4)
}

function getReadyTicketRank(ticket: TicketMeta) {
  if (ticket.ticketCategory === 'flight_ticket') return 0
  if (ticket.ticketCategory === 'hotel_booking') return 1
  if (/保险|保单|insurance|policy/i.test(`${ticket.title} ${ticket.fileName} ${ticket.note ?? ''}`)) return 2
  return 3
}

function ReadyTicketIcon({ ticket }: { ticket: TicketMeta }) {
  if (ticket.ticketCategory === 'flight_ticket') return <Plane className="size-6" />
  if (ticket.ticketCategory === 'hotel_booking') return <Hotel className="size-6" />
  if (/保险|保单|insurance|policy/i.test(`${ticket.title} ${ticket.fileName} ${ticket.note ?? ''}`)) {
    return <ShieldCheck className="size-6" />
  }
  if (ticket.ticketCategory === 'admission_ticket' || ticket.ticketCategory === 'train_ticket') {
    return <Ticket className="size-6" />
  }
  return <ReceiptText className="size-6" />
}

function getReadyTicketSubtitle(ticket: TicketMeta) {
  const note = ticket.note?.trim()
  if (note) return note
  if (ticket.ticketCategory === 'flight_ticket') return '机票'
  if (ticket.ticketCategory === 'hotel_booking') return '住宿订单'
  if (ticket.ticketCategory === 'train_ticket') return '火车票'
  if (ticket.ticketCategory === 'admission_ticket') return '门票'
  return ticket.fileType?.toUpperCase() || '旅行资料'
}

function openSmartRepair() {
  window.dispatchEvent(new CustomEvent('tripmap:open-ai', {
    detail: { command: '把这个旅行缺失的地点、路线、景点内容、每日提示和票据同步问题全部修复' },
  }))
}
