import { describe, expect, it } from 'vitest'
import { listBrandIdentities, resolveBrandIdentity } from './brandRegistry'

describe('brand registry', () => {
  it('resolves canonical structured provider codes', () => {
    expect(resolveBrandIdentity({ canonicalCode: 'ca', namespace: 'airline' })?.displayName).toBe('中国国际航空')
    expect(resolveBrandIdentity({ canonicalCode: 'LNER', namespace: 'rail' })?.displayName).toBe('LNER')
    expect(resolveBrandIdentity({ canonicalCode: 'ALLIANZ', namespace: 'insurance' })?.displayName).toBe('Allianz')
  })

  it('resolves only controlled aliases within the declared namespace', () => {
    expect(resolveBrandIdentity({ displayName: '中国国航', namespace: 'airline' })?.canonicalCode).toBe('CA')
    expect(resolveBrandIdentity({ displayName: '安联境外旅行保险', namespace: 'insurance' })?.canonicalCode).toBe('ALLIANZ')
    expect(resolveBrandIdentity({ displayName: 'LNER', namespace: 'airline' })).toBeNull()
  })

  it.each([
    'https://evil.example/logo.svg',
    '../../secret.svg',
    'javascript:alert(1)',
    'CA?logo=https://evil.example',
  ])('never treats arbitrary input as a logo reference: %s', (value) => {
    expect(resolveBrandIdentity({ canonicalCode: value, displayName: value, namespace: 'airline' })).toBeNull()
  })

  it('keeps every bundled identity versioned and source-backed', () => {
    for (const brand of listBrandIdentities()) {
      expect(brand.schemaVersion).toBe(1)
      expect(brand.version).toBeGreaterThan(0)
      expect(brand.logoAssetRef).toBeTruthy()
      expect(brand.rightsRef).toMatch(/^https:\/\//)
      expect(brand.source).toBeTruthy()
    }
  })
})
