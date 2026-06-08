// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DaySelector } from './DaySelector'

vi.mock('../../lib/dates', () => ({
  formatShortDateWithWeekday: vi.fn((date: string) => {
    const d = new Date(date + 'T00:00:00')
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }),
}))

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

const defaultDays = [
  { id: 'day_1', tripId: 'trip_1', date: '2026-04-01', title: '第 1 天', sortOrder: 1, createdAt: 100, updatedAt: 100 },
  { id: 'day_2', tripId: 'trip_1', date: '2026-04-02', title: '第 2 天', sortOrder: 2, createdAt: 100, updatedAt: 100 },
  { id: 'day_3', tripId: 'trip_1', date: '2026-04-03', title: '第 3 天', sortOrder: 3, createdAt: 100, updatedAt: 100 },
]

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  Element.prototype.scrollIntoView = vi.fn()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('DaySelector', () => {
  it('renders all days', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} onSelectDay={onSelectDay} selectedDayId="day_1" />,
      )
    })

    expect(container?.textContent).toContain('Day 1')
    expect(container?.textContent).toContain('Day 2')
    expect(container?.textContent).toContain('Day 3')
  })

  it('renders dates for each day', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} onSelectDay={onSelectDay} selectedDayId="day_1" />,
      )
    })

    expect(container?.textContent).toContain('4月1日')
    expect(container?.textContent).toContain('4月2日')
    expect(container?.textContent).toContain('4月3日')
  })

  it('marks selected day with aria-current', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} onSelectDay={onSelectDay} selectedDayId="day_2" />,
      )
    })

    const buttons = container?.querySelectorAll('button') ?? []
    const day2Button = Array.from(buttons).find((b) => b.textContent?.includes('Day 2'))
    expect(day2Button?.getAttribute('aria-current')).toBe('page')

    const day1Button = Array.from(buttons).find((b) => b.textContent?.includes('Day 1'))
    expect(day1Button?.getAttribute('aria-current')).toBeNull()
  })

  it('calls onSelectDay when day clicked', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} onSelectDay={onSelectDay} selectedDayId="day_1" />,
      )
    })

    const day2Button = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('Day 2'))

    await act(async () => {
      day2Button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectDay).toHaveBeenCalledWith(expect.objectContaining({ id: 'day_2' }))
  })

  it('renders as links when getDayHref provided', async () => {
    const onSelectDay = vi.fn()
    const getDayHref = (day: { id: string }) => `#/day?dayId=${day.id}`

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} getDayHref={getDayHref} onSelectDay={onSelectDay} selectedDayId="day_1" />,
      )
    })

    const links = container?.querySelectorAll('a') ?? []
    expect(links.length).toBe(3)
    expect(links[0].getAttribute('href')).toContain('day_1')
    expect(links[1].getAttribute('href')).toContain('day_2')
  })

  it('renders compact density', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} density="compact" onSelectDay={onSelectDay} selectedDayId="day_1" />,
      )
    })

    expect(container?.textContent).toContain('Day 1')
  })

  it('renders empty when no days', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={[]} onSelectDay={onSelectDay} />,
      )
    })

    expect(container?.querySelector('[data-testid="day-selector"]')).toBeTruthy()
  })

  it('renders without selected day', async () => {
    const onSelectDay = vi.fn()

    await act(async () => {
      root?.render(
        <DaySelector days={defaultDays} onSelectDay={onSelectDay} />,
      )
    })

    expect(container?.textContent).toContain('Day 1')
    const buttons = container?.querySelectorAll('button') ?? []
    expect(Array.from(buttons).every((b) => b.getAttribute('aria-current') === null)).toBe(true)
  })
})
