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
  subscribeToSharedTripRealtime: vi.fn(),
  syncSharedTripForOwner: vi.fn(),
  updateSharedTripMemberProfile: vi.fn(),
  updateSharedTripMemberPermission: vi.fn(),
  updateTicketSharedVisibility: vi.fn(),
}))

vi.mock('../../lib/companion', () => ({
  createSharedTripInvite: mocks.createSharedTripInvite,
  getCompanionPermissionLabel: vi.fn((permission: string) => permission),
  loadOwnerSharedTripState: mocks.loadOwnerSharedTripState,
  normalizeSharedTripMemberProfile: vi.fn((profile: unknown) => profile ?? {}),
  normalizeTicketSharedVisibility: vi.fn((visibility: { mode?: string } | undefined) =>
    visibility?.mode === 'assigned' ? visibility : { mode: 'all' },
  ),
  publishSharedTripFromLocal: mocks.publishSharedTripFromLocal,
  removeSharedTripMember: mocks.removeSharedTripMember,
  revokeSharedTripInvite: mocks.revokeSharedTripInvite,
  subscribeToSharedTripRealtime: mocks.subscribeToSharedTripRealtime,
  syncSharedTripForOwner: mocks.syncSharedTripForOwner,
  updateSharedTripMemberProfile: mocks.updateSharedTripMemberProfile,
  updateSharedTripMemberPermission: mocks.updateSharedTripMemberPermission,
  updateTicketSharedVisibility: mocks.updateTicketSharedVisibility,
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
  mocks.publishSharedTripFromLocal.mockResolvedValue({
    sharedTrip: (ownerState([]) as Extract<OwnerSharedTripState, { signedIn: true }>).sharedTrip,
    warnings: [],
  })
  mocks.subscribeToSharedTripRealtime.mockReturnValue(() => undefined)
  mocks.syncSharedTripForOwner.mockResolvedValue({ applied: 1, conflicts: 0, pendingReview: 0, published: true })
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
  it('renders redacted shared-trip suggestions and automatically processes pending mutations', async () => {
    await renderPanel()
    await waitForText('同行待处理')
    await waitForText('已自动处理同行更改')

    const panel = getByTestId('shared-trip-intelligence-panel')
    expect(panel.textContent).toContain('同行更改待确认')
    expect(panel.textContent).toContain('同行请求撤销调整')
    expect(panel.textContent).toContain('同行更改未应用需查看')
    for (const sensitive of ['Alice', 'PNR ABC123', 'ORDER-7788', 'Private dinner', 'SECRET-7788', 'provider payload']) {
      expect(panel.textContent).not.toContain(sensitive)
    }

    expect(mocks.syncSharedTripForOwner).toHaveBeenCalledWith('trip-1')
  })

  it('keeps replan undo as a manual existing-flow suggestion', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([
      mutation('undo-1', 'pending', 'request_replan_undo', {
        payload: { note: 'raw undo request SECRET-7788' },
      }),
    ]))
    await renderPanel()
    await waitForText('同行请求撤销调整')

    await clickSuggestion('同行请求撤销调整')
    await waitForText('撤销重排请求需要在 Live Mode')

    expect(mocks.syncSharedTripForOwner).not.toHaveBeenCalled()
  })

  it('saves member profile and automatically publishes ticket visibility', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([], {
      members: [{
        displayName: 'JUAN',
        email: 'juan@example.com',
        joinedAt: '2026-06-10T00:00:00Z',
        ownerId: 'owner-1',
        permission: 'read',
        sharedTripId: 'shared-1',
        updatedAt: '2026-06-10T00:00:00Z',
        userId: 'member_juan',
      }],
    }))
    mocks.updateSharedTripMemberProfile.mockResolvedValue(undefined)
    mocks.updateTicketSharedVisibility.mockResolvedValue(undefined)

    await renderPanel({
      tickets: [{
        createdAt: 1,
        fileName: 'juan-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket_juan',
        mimeType: 'application/pdf',
        size: 1,
        storageMode: 'copy',
        title: 'JUAN 机票',
        tripId: trip.id,
        updatedAt: 1,
      }],
    })
    await waitForText('JUAN')

    setFieldValue('座位', '12A')
    setFieldValue('护照', '护照已核对')
    await clickButton('保存资料')
    expect(mocks.updateSharedTripMemberProfile).toHaveBeenCalledWith('shared-1', 'member_juan', expect.objectContaining({
      passport: '护照已核对',
      seat: '12A',
    }))

    setSelectValue('共享给', 'assigned')
    setCheckbox('JUAN', true)
    await clickButton('保存分配')
    expect(mocks.updateTicketSharedVisibility).toHaveBeenCalledWith('ticket_juan', {
      memberIds: ['member_juan'],
      mode: 'assigned',
    })
    expect(mocks.publishSharedTripFromLocal).toHaveBeenCalledWith('trip-1')
    expect(mocks.syncSharedTripForOwner).not.toHaveBeenCalled()
  })

  it('saves an empty assigned ticket visibility as shared with nobody', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([], {
      members: [{
        displayName: 'JUAN',
        email: 'juan@example.com',
        joinedAt: '2026-06-10T00:00:00Z',
        ownerId: 'owner-1',
        permission: 'read',
        sharedTripId: 'shared-1',
        updatedAt: '2026-06-10T00:00:00Z',
        userId: 'member_juan',
      }],
    }))
    mocks.updateTicketSharedVisibility.mockResolvedValue(undefined)

    await renderPanel({
      tickets: [{
        createdAt: 1,
        fileName: 'private-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket_private',
        mimeType: 'application/pdf',
        size: 1,
        storageMode: 'copy',
        title: '暂不共享票据',
        tripId: trip.id,
        updatedAt: 1,
      }],
    })
    await waitForText('JUAN')

    setSelectValue('共享给', 'assigned')
    await waitForText('当前不会共享给任何同行')
    await clickButton('保存分配')

    expect(mocks.updateTicketSharedVisibility).toHaveBeenCalledWith('ticket_private', {
      memberIds: [],
      mode: 'assigned',
    })
  })

  it('shows ticket original audit events to the owner', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([], {
      ticketFileEvents: [{
        actorUserId: 'member_juan',
        createdAt: '2026-06-10T01:02:00Z',
        eventType: 'file_opened',
        fileName: 'juan-ticket.pdf',
        id: 'event-1',
        mimeType: 'application/pdf',
        ownerId: 'owner-1',
        sharedTripId: 'shared-1',
        ticketId: 'ticket_juan',
        userId: 'member_juan',
      }],
    }))

    await renderPanel()
    await waitForText('票据原件审计')
    await clickSummary('票据原件审计')

    const audit = getByTestId('shared-trip-ticket-file-audit')
    expect(audit.textContent).toContain('打开了票据原件')
    expect(audit.textContent).toContain('juan-ticket.pdf')
    expect(audit.textContent).toContain('member_juan')
  })

  it('automatically republishes owner local updates after sharing is active', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([]))
    const ticket = {
      createdAt: 1,
      fileName: 'owner-ticket.pdf',
      fileType: 'pdf' as const,
      id: 'ticket_owner',
      mimeType: 'application/pdf',
      size: 1,
      storageMode: 'copy' as const,
      title: '主人票据',
      tripId: trip.id,
      updatedAt: 1,
    }

    await renderPanel({ tickets: [ticket] })
    await waitForText('同行共享')
    expect(mocks.publishSharedTripFromLocal).not.toHaveBeenCalled()

    await renderPanel({ tickets: [{ ...ticket, updatedAt: 2 }] })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850))
    })
    await waitForText('主人更新已自动同步')

    expect(mocks.publishSharedTripFromLocal).toHaveBeenCalledWith('trip-1')
  })

  it('reconciles ticket grants when a member joined after the last projection publish', async () => {
    mocks.loadOwnerSharedTripState.mockResolvedValue(ownerState([], {
      members: [{
        displayName: 'JUAN',
        email: 'juan@example.com',
        joinedAt: '2026-06-10T01:00:00Z',
        ownerId: 'owner-1',
        permission: 'read',
        sharedTripId: 'shared-1',
        updatedAt: '2026-06-10T01:00:00Z',
        userId: 'member_juan',
      }],
      sharedTrip: {
        ...(ownerState([]) as Extract<OwnerSharedTripState, { signedIn: true }>).sharedTrip!,
        projectionUpdatedAt: '2026-06-10T00:00:00Z',
      },
    }))

    await renderPanel({
      tickets: [{
        createdAt: 1,
        fileName: 'shared-ticket.pdf',
        fileType: 'pdf',
        id: 'ticket_shared',
        mimeType: 'application/pdf',
        size: 1,
        storageMode: 'copy',
        title: '共享票据',
        tripId: trip.id,
        updatedAt: 1,
      }],
    })
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 850))
    })
    await waitForText('同行成员变化已自动同步票据授权')

    expect(mocks.publishSharedTripFromLocal).toHaveBeenCalledWith('trip-1')
  })
})

async function renderPanel(overrides: { tickets?: Parameters<typeof SharedTripPanel>[0]['tickets'] } = {}) {
  await act(async () => {
    root?.render(<SharedTripPanel days={[]} itemsByDay={{}} tickets={overrides.tickets ?? []} trip={trip} />)
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

function setFieldValue(labelText: string, value: string) {
  const field = fieldByLabel<HTMLInputElement | HTMLTextAreaElement>(labelText)
  act(() => {
    setNativeValue(field, value)
    field.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

function setSelectValue(labelText: string, value: string) {
  const field = fieldByLabel<HTMLSelectElement>(labelText)
  act(() => {
    setNativeValue(field, value)
    field.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

function setCheckbox(labelText: string, checked: boolean) {
  const label = labelByText(labelText)
  const field = label.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!field) throw new Error(`Missing checkbox: ${labelText}`)
  act(() => {
    if (field.checked !== checked) {
      field.click()
    }
  })
}

async function clickButton(text: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
    .find((element) => element.textContent?.includes(text))
  if (!button) throw new Error(`Missing button: ${text}`)
  await act(async () => {
    button.click()
  })
}

async function clickSummary(text: string) {
  const summary = [...document.body.querySelectorAll<HTMLElement>('summary')]
    .find((element) => element.textContent?.includes(text))
  if (!summary) throw new Error(`Missing summary: ${text}`)
  await act(async () => {
    summary.click()
  })
}

function fieldByLabel<T extends HTMLElement>(labelText: string): T {
  const label = labelByText(labelText)
  const field = label.querySelector<T>('input, textarea, select')
  if (!field) throw new Error(`Missing field: ${labelText}`)
  return field
}

function labelByText(labelText: string) {
  const label = [...document.body.querySelectorAll<HTMLLabelElement>('label')]
    .find((element) => element.textContent?.includes(labelText))
  if (!label) throw new Error(`Missing label: ${labelText}`)
  return label
}

function setNativeValue(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : field instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
  setter?.call(field, value)
}

function ownerState(mutations: SharedTripMutation[], overrides: Partial<Extract<OwnerSharedTripState, { signedIn: true }>> = {}): OwnerSharedTripState {
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
    ticketFileEvents: [],
    ...overrides,
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
