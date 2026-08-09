import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listFixtureMediaAssetIds } from './fixtureMediaRegistry'
import { validateTravelMediaAssetV1 } from './travelMedia'

describe('product fidelity media fixture', () => {
  it('keeps every fixture media record on the versioned controlled contract', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../../e2e/fixtures/product-fidelity-v1.json', import.meta.url),
      'utf8',
    )) as { records?: { mediaAssets?: unknown[] } }
    const mediaAssets = fixture.records?.mediaAssets
    expect(Array.isArray(mediaAssets)).toBe(true)

    const assetIds: string[] = []
    for (const input of mediaAssets ?? []) {
      const result = validateTravelMediaAssetV1(input)
      expect(result.ok).toBe(true)
      if (result.ok && result.value.renderRef.type === 'fixture_asset') {
        assetIds.push(result.value.renderRef.assetId)
      }
    }

    expect(assetIds.sort()).toEqual(listFixtureMediaAssetIds().sort())
  })
})
