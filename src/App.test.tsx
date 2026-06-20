// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mocks = vi.hoisted(() => ({
  getTrip: vi.fn(),
  subscribeTravelDataChanged: vi.fn(() => () => {}),
}))

vi.mock('./db', () => ({ getTrip: mocks.getTrip }))
vi.mock('./lib/dataEvents', () => ({ subscribeTravelDataChanged: mocks.subscribeTravelDataChanged }))
vi.mock('./components/AppShell', () => ({
  AppShell: ({ children, lastTripId, title }: { children: React.ReactNode; lastTripId?: string | null; title: string }) => (
    <div data-last-trip-id={lastTripId ?? ''} data-testid="app-shell" data-title={title}>{children}</div>
  ),
}))
vi.mock('./components/cloud/AutoSnapshotBackupController', () => ({ AutoSnapshotBackupController: () => null }))
vi.mock('./components/cloud/StartupCloudSnapshotCheckController', () => ({ StartupCloudSnapshotCheckController: () => null }))
vi.mock('./pages/HomePage', () => ({ HomePage: () => <div>首页</div> }))
vi.mock('./pages/TravelDocumentCenterPage', () => ({ TravelDocumentCenterPage: () => <div>资料中心</div> }))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  window.localStorage.clear()
  window.location.hash = '/documents?tripId=trip_1&tab=transport'
  mocks.getTrip.mockResolvedValue({ id: 'trip_1', title: '东京现场', updatedAt: 1 })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  container = null
  root = null
  vi.clearAllMocks()
})

describe('App trip context', () => {
  it('uses the trip title and records context on trip-scoped routes', async () => {
    await act(async () => root?.render(<App />))

    await vi.waitFor(() => {
      const shell = container?.querySelector('[data-testid="app-shell"]')
      expect(shell?.getAttribute('data-title')).toBe('东京现场')
      expect(shell?.getAttribute('data-last-trip-id')).toBe('trip_1')
      expect(container?.textContent).toContain('资料中心')
    })

    expect(JSON.parse(window.localStorage.getItem('tripmap.navigation-context.v1') ?? '{}')).toMatchObject({
      tripId: 'trip_1',
      version: 1,
    })
  })

  it('clears stale persisted context when its trip no longer exists', async () => {
    window.localStorage.setItem('tripmap.navigation-context.v1', JSON.stringify({
      tripId: 'missing_trip',
      updatedAt: 1,
      version: 1,
    }))
    window.location.hash = '/home'
    mocks.getTrip.mockResolvedValue(undefined)

    await act(async () => root?.render(<App />))

    await vi.waitFor(() => {
      expect(window.localStorage.getItem('tripmap.navigation-context.v1')).toBeNull()
      const shell = container?.querySelector('[data-testid="app-shell"]')
      expect(shell?.getAttribute('data-last-trip-id')).toBe('')
      expect(shell?.getAttribute('data-title')).toBe('旅图')
    })
  })
})
