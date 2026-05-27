import { describe, expect, it } from 'vitest'
import { getMarkerEmoji } from './markerEmoji'

function makeItem(overrides: { title?: string; locationName?: string } = {}) {
  return { title: overrides.title ?? '', locationName: overrides.locationName ?? '' }
}

describe('getMarkerEmoji', () => {
  describe('restaurant / food', () => {
    it.each([
      ['一兰拉面', '🍽️'],
      ['寿司店', '🍽️'],
      ['居酒屋', '🍽️'],
      ['咖啡厅', '🍽️'],
      ['甜品烘焙', '🍽️'],
      ['Blue Bottle Coffee', '🍽️'],
      ['Gonpachi Restaurant', '🍽️'],
    ])('returns 🍽️ for "%s"', (title, expected) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBe(expected)
    })
  })

  describe('hotel / accommodation', () => {
    it.each([
      ['新宿酒店', '🏨'],
      ['民宿', '🏨'],
      ['Hotel Metropolitan', '🏨'],
      ['Tokyo Hostel', '🏨'],
      ['温泉旅馆', '🏨'],
    ])('returns 🏨 for "%s"', (title, expected) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBe(expected)
    })
  })

  describe('transport', () => {
    it.each([
      ['涩谷车站', '🚃'],
      ['成田机场', '🚃'],
      ['地铁站', '🚃'],
      ['Shinjuku Station', '🚃'],
      ['Narita Airport', '🚃'],
    ])('returns 🚃 for "%s"', (title, expected) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBe(expected)
    })
  })

  describe('sightseeing / temple', () => {
    it.each([
      ['明治神宫', '⛩️'],
      ['浅草寺', '⛩️'],
      ['东京塔', '⛩️'],
      ['上野公园', '⛩️'],
      ['National Museum', '⛩️'],
      ['Senso-ji Temple', '⛩️'],
      ['Tokyo Castle', '⛩️'],
    ])('returns ⛩️ for "%s"', (title, expected) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBe(expected)
    })
  })

  describe('shopping', () => {
    it.each([
      ['涩谷购物', '🛍️'],
      ['市场', '🛍️'],
      ['药妆商店', '🛍️'],
      ['Mall', '🛍️'],
      ['Department Store', '🛍️'],
    ])('returns 🛍️ for "%s"', (title, expected) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBe(expected)
    })
  })

  describe('no match — returns null', () => {
    it.each([
      ['自由活动', ''],
      ['见面集合点', ''],
      ['Unknown Place', ''],
      ['123', ''],
      ['', ''],
    ])('returns null for "%s"', (title) => {
      expect(getMarkerEmoji(makeItem({ title }))).toBeNull()
    })
  })

  describe('locationName fallback', () => {
    it('matches from locationName when title has no match', () => {
      expect(getMarkerEmoji(makeItem({ title: '集合', locationName: '新宿酒店' }))).toBe('🏨')
    })

    it('returns null when both title and locationName have no match', () => {
      expect(getMarkerEmoji(makeItem({ title: '集合', locationName: '某地' }))).toBeNull()
    })
  })

  describe('title takes priority over locationName', () => {
    it('uses title match when both match', () => {
      expect(getMarkerEmoji(makeItem({ title: '餐厅', locationName: '涩谷车站' }))).toBe('🍽️')
    })
  })

  describe('unmatched categories return null for number fallback', () => {
    it('returns null for generic titles', () => {
      expect(getMarkerEmoji(makeItem({ title: '自由活动' }))).toBeNull()
    })
  })
})
