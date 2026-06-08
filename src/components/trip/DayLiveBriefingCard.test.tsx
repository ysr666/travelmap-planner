// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DayLiveBriefingCard } from './DayLiveBriefingCard'

const defaultBriefingLine = { text: '', severity: 'info' as const }

const mocks = vi.hoisted(() => ({
  buildDayLiveBriefing: vi.fn(() => ({
    targetItem: null,
    currentTimeLabel: '10:00',
    locationLine: { text: '东京', severity: 'info' as const },
    noticeLines: [],
    openingHoursLine: defaultBriefingLine,
    routeRiskLines: [],
    status: 'active' as const,
    subtitle: '4月1日',
    ticketLine: defaultBriefingLine,
    ticketPriceLine: defaultBriefingLine,
    timeLine: { text: '10:00 - 18:00', severity: 'info' as const },
    title: '第 1 天',
  })),
  describeItemTime: vi.fn(() => '10:00'),
}))

vi.mock('../../lib/dayLiveBriefing', () => ({
  buildDayLiveBriefing: mocks.buildDayLiveBriefing,
}))

vi.mock('../../lib/itinerary', () => ({
  describeItemTime: mocks.describeItemTime,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const defaultTrip = {
  id: 'trip_1',
  title: '东京旅行',
  destination: '东京',
  startDate: '2026-04-01',
  endDate: '2026-04-05',
  createdAt: 100,
  updatedAt: 100,
}

const defaultDay = {
  id: 'day_1',
  tripId: 'trip_1',
  date: '2026-04-01',
  title: '第 1 天',
  sortOrder: 1,
  createdAt: 100,
  updatedAt: 100,
}

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.buildDayLiveBriefing.mockReturnValue({
    targetItem: null,
    currentTimeLabel: '10:00',
    locationLine: { text: '东京', severity: 'info' },
    noticeLines: [],
    openingHoursLine: defaultBriefingLine,
    routeRiskLines: [],
    status: 'active',
    subtitle: '4月1日',
    ticketLine: defaultBriefingLine,
    ticketPriceLine: defaultBriefingLine,
    timeLine: { text: '10:00 - 18:00', severity: 'info' },
    title: '第 1 天',
  })
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('DayLiveBriefingCard', () => {
  it('renders briefing card', async () => {
    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.querySelector('[data-testid="day-live-briefing-card"]')).toBeTruthy()
  })

  it('renders summary text', async () => {
    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('第 1 天')
  })

  it('renders notice lines when available', async () => {
    mocks.buildDayLiveBriefing.mockReturnValue({
      targetItem: null,
      currentTimeLabel: '10:00',
      locationLine: { text: '东京', severity: 'info' },
      noticeLines: [
        { text: '10:00 浅草寺', severity: 'info' },
        { text: '注意时间', severity: 'warning' },
      ],
      openingHoursLine: defaultBriefingLine,
      routeRiskLines: [],
      status: 'active',
      subtitle: '4月1日',
      ticketLine: defaultBriefingLine,
      ticketPriceLine: defaultBriefingLine,
      timeLine: { text: '10:00 - 18:00', severity: 'info' },
      title: '第 1 天',
    })

    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('注意时间')
  })

  it('renders action buttons', async () => {
    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.querySelectorAll('button').length).toBeGreaterThan(0)
  })

  it('renders map button', async () => {
    const onOpenMap = vi.fn()

    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={onOpenMap}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    const mapButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('打开地图'))
    expect(mapButton).toBeTruthy()
  })

  it('renders with items', async () => {
    const items = [
      { id: 'item_1', dayId: 'day_1', tripId: 'trip_1', title: '浅草寺', sortOrder: 1, createdAt: 100, updatedAt: 100 },
    ]

    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={items}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.querySelector('[data-testid="day-live-briefing-card"]')).toBeTruthy()
  })

  it('renders with route day', async () => {
    const routeDay = {
      day: defaultDay,
      status: 'ready' as const,
      segments: [],
    }

    await act(async () => {
      root?.render(
        <DayLiveBriefingCard
          day={defaultDay}
          items={[]}
          onOpenItem={vi.fn()}
          onOpenMap={vi.fn()}
          onOpenTickets={vi.fn()}
          routeDay={routeDay}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.querySelector('[data-testid="day-live-briefing-card"]')).toBeTruthy()
  })
})
