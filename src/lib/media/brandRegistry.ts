import airChinaLogoUrl from '../../assets/brands/air-china.svg'
import allianzLogoUrl from '../../assets/brands/allianz.svg'
import lnerLogoUrl from '../../assets/brands/lner.svg'
import nationalRailLogoUrl from '../../assets/brands/national-rail.svg'

export const BRAND_IDENTITY_SCHEMA_VERSION = 1 as const

export type BrandNamespace = 'airline' | 'rail' | 'insurance' | 'hotel_group'

export type BrandIdentityV1 = {
  schemaVersion: typeof BRAND_IDENTITY_SCHEMA_VERSION
  namespace: BrandNamespace
  canonicalCode: string
  displayName: string
  aliases: string[]
  regions?: string[]
  logoAssetRef: string
  source: string
  rightsRef: string
  version: number
  colorMode: 'original' | 'monochrome-adaptive'
}

export type BrandIdentityInput = {
  namespace: BrandNamespace
  canonicalCode?: string
  displayName?: string
}

const brandRegistry = [
  {
    aliases: ['AIR CHINA', '中国国际航空', '中国国航', '国航'],
    canonicalCode: 'CA',
    colorMode: 'original',
    displayName: '中国国际航空',
    logoAssetRef: airChinaLogoUrl,
    namespace: 'airline',
    regions: ['CN'],
    rightsRef: 'https://commons.wikimedia.org/wiki/File:Air_China_wordmark.svg',
    schemaVersion: BRAND_IDENTITY_SCHEMA_VERSION,
    source: 'Air China via Wikimedia Commons; nominative trademark use',
    version: 1,
  },
  {
    aliases: ['LNER', 'LONDON NORTH EASTERN RAILWAY'],
    canonicalCode: 'LNER',
    colorMode: 'original',
    displayName: 'LNER',
    logoAssetRef: lnerLogoUrl,
    namespace: 'rail',
    regions: ['GB'],
    rightsRef: 'https://commons.wikimedia.org/wiki/File:LNER_Logo.svg',
    schemaVersion: BRAND_IDENTITY_SCHEMA_VERSION,
    source: 'London North Eastern Railway via Wikimedia Commons; nominative trademark use',
    version: 1,
  },
  {
    aliases: ['NATIONAL RAIL', '英国国家铁路'],
    canonicalCode: 'NATIONAL_RAIL',
    colorMode: 'monochrome-adaptive',
    displayName: 'National Rail',
    logoAssetRef: nationalRailLogoUrl,
    namespace: 'rail',
    regions: ['GB'],
    rightsRef: 'https://commons.wikimedia.org/wiki/File:National_Rail_logo.svg',
    schemaVersion: BRAND_IDENTITY_SCHEMA_VERSION,
    source: 'National Rail via Wikimedia Commons; nominative trademark use',
    version: 1,
  },
  {
    aliases: ['ALLIANZ', '安联', '安联保险', '安联境外旅行保险'],
    canonicalCode: 'ALLIANZ',
    colorMode: 'original',
    displayName: 'Allianz',
    logoAssetRef: allianzLogoUrl,
    namespace: 'insurance',
    rightsRef: 'https://commons.wikimedia.org/wiki/File:Allianz.svg',
    schemaVersion: BRAND_IDENTITY_SCHEMA_VERSION,
    source: 'Allianz via Wikimedia Commons; nominative trademark use',
    version: 1,
  },
] as const satisfies readonly BrandIdentityV1[]

const brandIndex = new Map<string, BrandIdentityV1>()
for (const brand of brandRegistry) {
  brandIndex.set(buildBrandKey(brand.namespace, brand.canonicalCode), brand)
  for (const alias of brand.aliases) {
    brandIndex.set(buildBrandKey(brand.namespace, alias), brand)
  }
}

export function resolveBrandIdentity(input: BrandIdentityInput): BrandIdentityV1 | null {
  const canonicalCode = normalizeBrandLookupValue(input.canonicalCode)
  if (canonicalCode) {
    const exact = brandIndex.get(buildBrandKey(input.namespace, canonicalCode))
    if (exact) return exact
  }
  const displayName = normalizeBrandLookupValue(input.displayName)
  return displayName
    ? brandIndex.get(buildBrandKey(input.namespace, displayName)) ?? null
    : null
}

export function listBrandIdentities(): readonly BrandIdentityV1[] {
  return brandRegistry
}

function buildBrandKey(namespace: BrandNamespace, value: string) {
  return `${namespace}:${normalizeBrandLookupValue(value)}`
}

function normalizeBrandLookupValue(value: unknown) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 100 || /[:/\\?#@]/.test(trimmed)) return ''
  return trimmed.normalize('NFKC').replace(/[\s._-]+/g, ' ').toLocaleUpperCase('en-US')
}
