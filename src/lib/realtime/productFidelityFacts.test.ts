import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateRealtimeFactV1 } from './realtimeFact'

describe('product fidelity realtime facts', () => {
  it('validates every canonical fixture fact through the production contract', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('../../../e2e/fixtures/product-fidelity-v1.json', import.meta.url),
      'utf8',
    )) as { records: { realtimeFacts: unknown[] } }
    const validations = fixture.records.realtimeFacts.map(validateRealtimeFactV1)
    expect(validations).toHaveLength(4)
    expect(validations.every((result) => result.ok)).toBe(true)
    expect(validations.flatMap((result) => result.ok ? [result.value.kind] : [])).toEqual([
      'weather_forecast',
      'weather_current',
      'place_opening_status',
      'route_eta',
    ])
  })
})
