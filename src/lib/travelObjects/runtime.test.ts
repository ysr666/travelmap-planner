import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY,
  readE2eTravelObjectSupplements,
} from './e2eRuntime'

type FixtureRecords = {
  insurancePolicies: unknown[]
  lodgingReservations: unknown[]
  mediaAssets: unknown[]
  realtimeFacts: unknown[]
}

function loadFixtureRecords() {
  return (JSON.parse(readFileSync(
    new URL('../../../e2e/fixtures/product-fidelity-v1.json', import.meta.url),
    'utf8',
  )) as { records: FixtureRecords }).records
}

describe('travel object runtime supplements', () => {
  it('accepts the exact bounded E2E envelope only when fixture mode and trip match', () => {
    const storage = new MemoryStorage()
    const records = loadFixtureRecords()
    storage.setItem(E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY, JSON.stringify({
      insurancePolicies: records.insurancePolicies,
      lodgingReservations: records.lodgingReservations,
      mediaAssets: records.mediaAssets,
      realtimeFacts: records.realtimeFacts,
      schemaVersion: 1,
      tripId: 'trip_uk_product_fidelity',
    }))

    const result = readE2eTravelObjectSupplements({
      allowFixture: true,
      storage,
      tripId: 'trip_uk_product_fidelity',
    })
    expect(result.insurancePolicies).toHaveLength(1)
    expect(result.lodgingReservations).toHaveLength(1)
    expect(result.mediaAssets).toHaveLength(records.mediaAssets.length)
    expect(result.realtimeFacts).toHaveLength(records.realtimeFacts.length)
    expect(readE2eTravelObjectSupplements({
      allowFixture: false,
      storage,
      tripId: 'trip_uk_product_fidelity',
    }).mediaAssets).toEqual([])
  })

  it('rejects unknown fields, cross-trip values, and sensitive extras as one envelope', () => {
    const storage = new MemoryStorage()
    const records = loadFixtureRecords()
    for (const context of [
      {
        insurancePolicies: records.insurancePolicies,
        lodgingReservations: records.lodgingReservations,
        mediaAssets: records.mediaAssets,
        realtimeFacts: records.realtimeFacts,
        schemaVersion: 1,
        token: 'must-not-pass',
        tripId: 'trip_uk_product_fidelity',
      },
      {
        insurancePolicies: records.insurancePolicies,
        lodgingReservations: records.lodgingReservations,
        mediaAssets: records.mediaAssets,
        realtimeFacts: records.realtimeFacts,
        schemaVersion: 1,
        tripId: 'another_trip',
      },
    ]) {
      storage.setItem(E2E_TRAVEL_OBJECT_CONTEXT_STORAGE_KEY, JSON.stringify(context))
      expect(readE2eTravelObjectSupplements({
        allowFixture: true,
        storage,
        tripId: 'trip_uk_product_fidelity',
      })).toEqual({
        insurancePolicies: [],
        lodgingReservations: [],
        mediaAssets: [],
        realtimeFacts: [],
      })
    }
  })
})

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}
