// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getRouteParams, navigateTo, routeFromHash } from './routes'

afterEach(() => {
  window.location.hash = ''
})

describe('routeFromHash', () => {
  it('returns home for empty hash', () => {
    window.location.hash = ''
    expect(routeFromHash()).toBe('home')
  })

  it('parses known route', () => {
    window.location.hash = '#/trip?tripId=abc'
    expect(routeFromHash()).toBe('trip')
  })

  it('parses map route', () => {
    window.location.hash = '#/map?tripId=abc&dayId=def'
    expect(routeFromHash()).toBe('map')
  })

  it('returns home for unknown route', () => {
    window.location.hash = '#/unknown'
    expect(routeFromHash()).toBe('home')
  })

  it('handles hash without leading slash', () => {
    window.location.hash = '#settings'
    expect(routeFromHash()).toBe('settings')
  })
})

describe('getRouteParams', () => {
  it('extracts params from hash', () => {
    const params = getRouteParams('#/trip?tripId=abc&dayId=def')
    expect(params.get('tripId')).toBe('abc')
    expect(params.get('dayId')).toBe('def')
  })

  it('returns empty params when no query', () => {
    const params = getRouteParams('#/home')
    expect(params.get('tripId')).toBeNull()
  })

  it('handles empty hash', () => {
    const params = getRouteParams('')
    expect(params.toString()).toBe('')
  })
})

describe('navigateTo', () => {
  it('sets hash with route', () => {
    navigateTo('home')
    expect(window.location.hash).toBe('#/home')
  })

  it('sets hash with params', () => {
    navigateTo('trip', { tripId: 'abc', dayId: 'def' })
    const hash = window.location.hash
    expect(hash).toContain('#/trip?')
    expect(hash).toContain('tripId=abc')
    expect(hash).toContain('dayId=def')
  })

  it('sets hash without params', () => {
    navigateTo('settings')
    expect(window.location.hash).toBe('#/settings')
  })
})
