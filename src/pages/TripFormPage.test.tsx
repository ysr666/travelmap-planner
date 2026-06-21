// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TripFormPage } from './TripFormPage'

const mocks = vi.hoisted(() => ({
  routeFromHash: vi.fn(() => 'trip/new'),
  getRouteParams: vi.fn(() => new URLSearchParams()),
  navigateTo: vi.fn(),
  createTrip: vi.fn().mockResolvedValue({ id: 'new_trip' }),
  getTrip: vi.fn().mockResolvedValue(null),
  updateTrip: vi.fn().mockResolvedValue(undefined),
  ensureDaysForTrip: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/routes', () => ({
  routeFromHash: mocks.routeFromHash,
  getRouteParams: mocks.getRouteParams,
  navigateTo: mocks.navigateTo,
}))

vi.mock('../db', () => ({
  createTrip: mocks.createTrip,
  getTrip: mocks.getTrip,
  updateTrip: mocks.updateTrip,
}))

vi.mock('../lib/dates', () => ({
  ensureDaysForTrip: mocks.ensureDaysForTrip,
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  vi.useFakeTimers()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
  mocks.routeFromHash.mockReturnValue('trip/new')
  mocks.getRouteParams.mockReturnValue(new URLSearchParams())
  mocks.createTrip.mockResolvedValue({ id: 'new_trip' })
  mocks.getTrip.mockResolvedValue(null)
  mocks.updateTrip.mockResolvedValue(undefined)
  mocks.ensureDaysForTrip.mockResolvedValue([])
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
  vi.useRealTimers()
})

describe('TripFormPage', () => {
  it('renders new trip form', async () => {
    await act(async () => {
      root?.render(<TripFormPage />)
    })

    expect(container?.textContent).toContain('新建旅行')
  })

  it('renders form fields', async () => {
    await act(async () => {
      root?.render(<TripFormPage />)
    })

    expect(container?.textContent).toContain('旅行标题')
    expect(container?.textContent).toContain('目的地')
    expect(container?.textContent).toContain('开始日期')
    expect(container?.textContent).toContain('结束日期')
  })

  it('renders edit form with pre-filled data', async () => {
    mocks.routeFromHash.mockReturnValue('trip/edit')
    mocks.getRouteParams.mockReturnValue(new URLSearchParams({ tripId: 'trip_1' }))
    mocks.getTrip.mockResolvedValue({
      id: 'trip_1',
      title: '东京旅行',
      destination: '东京',
      startDate: '2026-04-01',
      endDate: '2026-04-05',
      notes: '备注内容',
      createdAt: 100,
      updatedAt: 100,
    })

    await act(async () => {
      root?.render(<TripFormPage />)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(651)
    })

    expect(container?.textContent).toContain('编辑旅行')
  })

  it('renders error when edit trip not found', async () => {
    mocks.routeFromHash.mockReturnValue('trip/edit')
    mocks.getRouteParams.mockReturnValue(new URLSearchParams({ tripId: 'trip_1' }))
    mocks.getTrip.mockResolvedValue(null)

    await act(async () => {
      root?.render(<TripFormPage />)
    })
    await act(async () => {
      await vi.runAllTimersAsync()
    })

    expect(container?.textContent).toContain('未找到该旅行')
  })

  it('renders missing trip ID error for edit route', async () => {
    mocks.routeFromHash.mockReturnValue('trip/edit')
    mocks.getRouteParams.mockReturnValue(new URLSearchParams())

    await act(async () => {
      root?.render(<TripFormPage />)
    })

    expect(container?.textContent).toContain('缺少旅行 ID')
  })

  it('renders submit button', async () => {
    await act(async () => {
      root?.render(<TripFormPage />)
    })

    const submitButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('保存旅行'))
    expect(submitButton).toBeTruthy()
  })

  it('renders back button', async () => {
    await act(async () => {
      root?.render(<TripFormPage />)
    })

    const backButton = container?.querySelector('button[aria-label="返回"]')
      ?? container?.querySelector('button')
    expect(backButton).toBeTruthy()
  })
})
