// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { getCanonicalHashRedirect, getRouteParams, navigateTo, routeFromHash } from './routes'

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

  it('parses day route', () => {
    window.location.hash = '#/day?tripId=abc&dayId=def&view=map'
    expect(routeFromHash()).toBe('day')
  })

  it('parses legacy map route without rewriting', () => {
    window.location.hash = '#/map?tripId=abc&dayId=def'
    expect(routeFromHash()).toBe('day')
    expect(window.location.hash).toBe('#/map?tripId=abc&dayId=def')
  })

  it('parses legacy overview route without rewriting', () => {
    window.location.hash = '#/overview?tripId=abc'
    expect(routeFromHash()).toBe('trip')
    expect(window.location.hash).toBe('#/overview?tripId=abc')
  })

  it('parses legacy timeline route without rewriting', () => {
    window.location.hash = '#/timeline?tripId=abc'
    expect(routeFromHash()).toBe('day')
    expect(window.location.hash).toBe('#/timeline?tripId=abc')
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

describe('getCanonicalHashRedirect', () => {
  it('canonicalizes legacy overview route', () => {
    expect(getCanonicalHashRedirect('#/overview?tripId=abc')).toBe('#/trip?tripId=abc')
  })

  it('canonicalizes legacy map route with day id', () => {
    expect(getCanonicalHashRedirect('#/map?tripId=abc&dayId=def')).toBe('#/day?tripId=abc&dayId=def&view=map')
  })

  it('canonicalizes legacy trip day view to day route', () => {
    expect(getCanonicalHashRedirect('#/trip?tripId=abc&dayId=def&view=schedule')).toBe('#/day?tripId=abc&dayId=def&view=schedule')
  })

  it('does not canonicalize trip day view before a day id is known', () => {
    expect(getCanonicalHashRedirect('#/trip?tripId=abc&view=schedule')).toBeNull()
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
