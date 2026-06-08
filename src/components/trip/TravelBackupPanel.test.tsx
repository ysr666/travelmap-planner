// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TravelBackupPanel } from './TravelBackupPanel'

const mocks = vi.hoisted(() => ({
  exportTripBackup: vi.fn().mockResolvedValue(new Blob(['test'])),
  downloadBlob: vi.fn(),
  buildTripBackupFileName: vi.fn(() => 'trip-backup.zip'),
}))

vi.mock('../../lib/backup', () => ({
  exportTripBackup: mocks.exportTripBackup,
  downloadBlob: mocks.downloadBlob,
  buildTripBackupFileName: mocks.buildTripBackupFileName,
}))

vi.mock('../cloud/CloudBackupPanel', () => ({
  CloudBackupPanel: () => <div data-testid="cloud-backup-panel" />,
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

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
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

describe('TravelBackupPanel', () => {
  it('renders backup panel with trip', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={defaultTrip} />)
    })

    expect(container?.textContent).toContain('同步与归档')
  })

  it('renders export button', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={defaultTrip} />)
    })

    const exportButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('导出'))
    expect(exportButton).toBeTruthy()
  })

  it('renders cloud backup panel', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={defaultTrip} />)
    })

    expect(container?.querySelector('[data-testid="cloud-backup-panel"]')).toBeTruthy()
  })

  it('renders empty state when no trip', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={null} />)
    })

    expect(container?.textContent).toContain('请先进入某个旅行')
  })

  it('renders loading state', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={null} isLoadingTrip />)
    })

    expect(container?.querySelector('.animate-pulse')).toBeTruthy()
  })

  it('exports backup on button click', async () => {
    await act(async () => {
      root?.render(<TravelBackupPanel trip={defaultTrip} />)
    })

    const exportButton = Array.from(container?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.includes('导出'))

    await act(async () => {
      exportButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(mocks.exportTripBackup).toHaveBeenCalledWith('trip_1')
  })
})
