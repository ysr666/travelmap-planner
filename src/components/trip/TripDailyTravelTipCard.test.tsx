// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripDailyTravelTipCard } from './TripDailyTravelTipCard'

const defaultModel = {
  mode: 'today' as const,
  sections: [],
  warnings: [],
  title: '今日行程',
  subtitle: '4月1日',
  searchTargets: [],
  targetItems: [],
  localSourceSummaries: [],
}

const mocks = vi.hoisted(() => ({
  getProviderProxyConfig: vi.fn(() => ({ baseUrl: '' })),
  buildTripDailyTravelTip: vi.fn(() => defaultModel),
  generateEnhancedTripDailyTravelTip: vi.fn(),
  saveTripDailyTravelTipPreviewToNotes: vi.fn(),
  SYNC_QUEUE_SUCCESS_COPY: '已保存',
}))

vi.mock('../../lib/providerProxyClient', () => ({
  getProviderProxyConfig: mocks.getProviderProxyConfig,
  ProviderProxyClientError: class extends Error {},
}))

vi.mock('../../lib/ai/tripDailyTravelTip', () => ({
  buildTripDailyTravelTip: mocks.buildTripDailyTravelTip,
  generateEnhancedTripDailyTravelTip: mocks.generateEnhancedTripDailyTravelTip,
  saveTripDailyTravelTipPreviewToNotes: mocks.saveTripDailyTravelTipPreviewToNotes,
}))

vi.mock('../../lib/tripSyncQueue', () => ({
  SYNC_QUEUE_SUCCESS_COPY: mocks.SYNC_QUEUE_SUCCESS_COPY,
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
  mocks.buildTripDailyTravelTip.mockReturnValue(defaultModel)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('TripDailyTravelTipCard', () => {
  it('renders card with title and subtitle', async () => {
    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('今日行程')
    expect(container?.textContent).toContain('4月1日')
  })

  it('renders generate button', async () => {
    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    const generateButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('生成'))
    expect(generateButton).toBeTruthy()
  })

  it('renders pre-trip mode', async () => {
    mocks.buildTripDailyTravelTip.mockReturnValue({
      ...defaultModel,
      mode: 'pre_trip',
      title: '出行前准备',
    })

    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('出行前准备')
  })

  it('renders completed mode', async () => {
    mocks.buildTripDailyTravelTip.mockReturnValue({
      ...defaultModel,
      mode: 'completed',
      title: '旅行已结束',
    })

    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('旅行已结束')
  })

  it('renders with empty days', async () => {
    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[]}
          itemsByDay={{}}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toBeTruthy()
  })

  it('renders warnings', async () => {
    mocks.buildTripDailyTravelTip.mockReturnValue({
      ...defaultModel,
      warnings: ['部分行程点缺少坐标'],
    })

    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('部分行程点缺少坐标')
  })

  it('renders provider not configured notice', async () => {
    mocks.getProviderProxyConfig.mockReturnValue({ baseUrl: '' })

    await act(async () => {
      root?.render(
        <TripDailyTravelTipCard
          days={[defaultDay]}
          itemsByDay={{ day_1: [] }}
          trip={defaultTrip}
        />,
      )
    })

    expect(container?.textContent).toContain('provider proxy')
  })
})
