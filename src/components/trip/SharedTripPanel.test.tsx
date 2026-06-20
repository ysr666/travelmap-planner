// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SharedTripPanel } from './SharedTripPanel'
import type { OwnerSharedTripState } from '../../lib/companion'
import type { SharedTripMutation } from '../../types'

const mocks = vi.hoisted(() => ({
  createSharedTripInvite: vi.fn(),
  loadOwnerSharedTripState: vi.fn(),
  navigateTo: vi.fn(),
  publishSharedTripFromLocal: vi.fn(),
  removeSharedTripMember: vi.fn(),
  revokeSharedTripInvite: vi.fn(),
  syncSharedTripForOwner: vi.fn(),
  updateSharedTripMemberPermission: vi.fn(),
}))

vi.mock('../../lib/companion', () => ({
  createSharedTripInvite: mocks.createSharedTripInvite,
  getCompanionPermissionLabel: vi.fn((permission: string) => permission),
  loadOwnerSharedTripState: mocks.loadOwnerSharedTripState,
  publishSharedTripFromLocal: mocks.publishSharedTripFromLocal,
  removeSharedTripMember: mocks.removeSharedTripMember,
  revokeSharedTripInvite: mocks.revokeSharedTripInvite,
  syncSharedTripForOwner: mocks.syncSharedTripForOwner,
  updateSharedTripMemberPermission: mocks.updateSharedTripMemberPermission,
}))

vi.mock('../../lib/routes', () => ({
  navigateTo: mocks.navigateTo,
}))

let container: HTMLDivElement | null = null
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.clearAllMocks()
  mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([
    mutation('pending-1', 'pending', 'update_item', {
      displayName: 'Alice PNR ABC123',
      payload: { patch: { title: 'Private dinner ORDER-7788' } },
    }),
    mutation('undo-1', 'pending', 'request_replan_undo', {
      payload: { note: 'raw undo request SECRET-7788' },
    }),
    mutation('rejected-1', 'rejected', 'update_item', {
      rejectedReason: 'raw provider payload PNR ABC123',
    }),
  ]))
  mocks.syncSharedTripForOwner.mockResolvedValue({ applied: 1, conflicts: 0 })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('SharedTripPanel unified intelligence', () => {
  it('renders redacted shared-trip suggestions and uses existing sync for pending mutations', async () => {
    await renderPanel()
    await waitForText('同行待处理')

    const panel = getByTestId('shared-trip-intelligence-panel')
    expect(panel.textContent).toContain('同行更改待确认')
    expect(panel.textContent).toContain('同行请求撤销调整')
    expect(panel.textContent).toContain('同行更改未应用需查看')
    for (const sensitive of ['Alice', 'PNR ABC123', 'ORDER-7788', 'Private dinner', 'SECRET-7788', 'provider payload']) {
      expect(panel.textContent).not.toContain(sensitive)
    }

    await clickSuggestion('同行更改待确认')
    expect(mocks.syncSharedTripForOwner).toHaveBeenCalledWith('trip-1')
  })

  it('keeps replan undo as a manual existing-flow suggestion', async () => {
    await renderPanel()
    await waitForText('同行请求撤销调整')

    await clickSuggestion('同行请求撤销调整')
    await waitForText('撤销重排请求需要在 Live Mode')

    expect(mocks.syncSharedTripForOwner).not.toHaveBeenCalled()
  })
})

async function renderPanel() {
  await act(async () => {
    root?.render(<SharedTripPanel days={[]} itemsByDay={{}} tickets={[]} trip={trip} />)
  })
}

async function clickSuggestion(text: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('[data-testid="shared-trip-intelligence-action"]')]
    .find((element) => element.textContent?.includes(text))
  if (!button) throw new Error(`Missing suggestion: ${text}`)
  await act(async () => {
    button.click()
  })
}

function getByTestId(testId: string) {
  const element = document.body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
  if (!element) throw new Error(`Missing test id: ${testId}`)
  return element
}

async function waitForText(text: string) {
  for (let index = 0; index < 20; index += 1) {
    if (document.body.textContent?.includes(text)) return
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    })
  }
  throw new Error(`Missing text: ${text}`)
}

function ownerState(mutations: SharedTripMutation[]): OwnerSharedTripState {
  return {
    activities: [],
    configured: true,
    invites: [],
    members: [],
    mutations,
    sharedTrip: {
      createdAt: '2026-06-10T00:00:00Z',
      id: 'shared-1',
      ownerId: 'owner-1',
      projection: {
        days: [],
        items: [],
        publishedAt: '2026-06-10T00:00:00Z',
        schemaVersion: 2,
        ticketSummaries: [],
        trip,
        warnings: [],
      },
      projectionUpdatedAt: '2026-06-10T00:00:00Z',
      title: '东京旅行',
      tripId: 'trip-1',
      updatedAt: '2026-06-10T00:00:00Z',
    },
    signedIn: true,
  }
}

function mutation(
  id: string,
  status: SharedTripMutation['status'],
  mutationType: SharedTripMutation['mutationType'],
  patch: Partial<SharedTripMutation> = {},
): SharedTripMutation {
  return {
    createdAt: '2026-06-10T00:00:00Z',
    displayName: '同行人',
    id,
    mutationType,
    payload: {},
    sharedTripId: 'shared-1',
    status,
    updatedAt: '2026-06-10T00:00:00Z',
    userId: 'user-1',
    ...patch,
  }
}

const trip = {
  createdAt: 1,
  destination: '东京',
  endDate: '2026-06-20',
  id: 'trip-1',
  startDate: '2026-06-10',
  title: '东京旅行',
  updatedAt: 1,
}
