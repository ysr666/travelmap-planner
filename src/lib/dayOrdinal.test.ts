import { describe, expect, it } from 'vitest'
import { formatChineseDayOrdinal } from './dayOrdinal'

describe('formatChineseDayOrdinal', () => {
  it('formats common day numbers in Chinese', () => {
    expect(formatChineseDayOrdinal(1)).toBe('第一天')
    expect(formatChineseDayOrdinal(2)).toBe('第二天')
    expect(formatChineseDayOrdinal(31)).toBe('第三十一天')
  })

  it('falls back for days beyond the built-in list', () => {
    expect(formatChineseDayOrdinal(32)).toBe('第32天')
  })
})
