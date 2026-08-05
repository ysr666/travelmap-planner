import { describe, expect, it } from 'vitest'
import {
  getPrimaryDestination,
  getRouteTitle,
  isImmersiveRoute,
  isPushRoute,
  shouldShowAiCommand,
  shouldShowPrimaryNavigation,
  shouldShowSearchCommand,
} from './routePresentation'

describe('routePresentation', () => {
  it('maps trip and document surfaces to their primary destinations', () => {
    expect(getPrimaryDestination('trip', '#/trip')).toBe('trip')
    expect(getPrimaryDestination('day', '#/day?view=map')).toBe('trip')
    expect(getPrimaryDestination('item', '#/item')).toBe('trip')
    expect(getPrimaryDestination('documents', '#/documents')).toBe('documents')
    expect(getPrimaryDestination('tickets', '#/tickets')).toBe('documents')
    expect(getPrimaryDestination('inbox', '#/inbox')).toBe('documents')
    expect(getPrimaryDestination('ledger', '#/ledger')).toBe('trip')
  })

  it('keeps contextual search attached to its source destination', () => {
    expect(getPrimaryDestination('search', '#/search?from=trip')).toBe('trip')
    expect(getPrimaryDestination('search', '#/search?from=inbox')).toBe('documents')
    expect(getPrimaryDestination('search', '#/search?from=documents')).toBe('documents')
    expect(getPrimaryDestination('search', '#/search?from=settings')).toBe('settings')
    expect(getPrimaryDestination('search', '#/search')).toBe('home')
  })

  it('uses unique task-oriented route titles', () => {
    expect(getRouteTitle('home')).toBe('今日')
    expect(getRouteTitle('day', '#/day?view=schedule')).toBe('日程')
    expect(getRouteTitle('day', '#/day?view=map')).toBe('地图')
    expect(getRouteTitle('documents')).toBe('资料')
    expect(getRouteTitle('settings')).toBe('我的')
    expect(getRouteTitle('ai-draft')).toBe('AI 生成行程')
  })

  it('keeps commands out of push and immersive routes', () => {
    expect(isPushRoute('item')).toBe(true)
    expect(isImmersiveRoute('item')).toBe(true)
    expect(shouldShowPrimaryNavigation('item')).toBe(false)
    expect(shouldShowAiCommand('item/edit')).toBe(false)
    expect(shouldShowSearchCommand('item')).toBe(false)
  })

  it('keeps Today focused on the trip and exposes search in contextual libraries', () => {
    expect(shouldShowSearchCommand('home')).toBe(false)
    expect(shouldShowSearchCommand('trip')).toBe(true)
    expect(shouldShowSearchCommand('inbox')).toBe(true)
  })
})
