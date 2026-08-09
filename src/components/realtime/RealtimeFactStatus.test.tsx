// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { RealtimeFactV1 } from '../../lib/realtime'
import { RealtimeFactStatus } from './RealtimeFactStatus'

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  container?.remove()
  container = null
})

describe('RealtimeFactStatus', () => {
  it('renders a compact source and current observation age', async () => {
    await renderStatus(<RealtimeFactStatus fact={weatherFact()} now="2026-08-09T08:00:30.000Z" />)

    expect(container?.textContent).toBe('Open-Meteo · 刚刚')
    expect(container?.querySelector('[data-fact-freshness="current"]')).not.toBeNull()
    expect(container?.textContent).not.toContain('open_meteo:forecast')
    expect(container?.firstElementChild?.className).toContain('max-w-full')
  })

  it('labels expired facts as a recent update without claiming they are current', async () => {
    await renderStatus(<RealtimeFactStatus fact={weatherFact()} now="2026-08-09T12:10:00.000Z" />)

    expect(container?.textContent).toBe('最近更新 Open-Meteo · 4 小时前')
    expect(container?.querySelector('[data-fact-freshness="stale"]')).not.toBeNull()
  })

  it('uses one short unavailable row when no trustworthy fact exists', async () => {
    await renderStatus(<RealtimeFactStatus now="2026-08-09T08:00:00.000Z" />)

    expect(container?.textContent).toBe('实时信息暂不可用')
    expect(container?.querySelector('[role="status"]')).not.toBeNull()
    expect(container?.querySelector('button, a')).toBeNull()
  })
})

async function renderStatus(node: React.ReactNode) {
  container = document.createElement('div')
  container.style.width = '320px'
  document.body.append(container)
  root = createRoot(container)
  await act(async () => root?.render(node))
}

function weatherFact(): RealtimeFactV1 {
  return {
    confidence: 'high',
    expiresAt: '2026-08-09T11:00:00.000Z',
    id: 'fact_weather_forecast_item_london_1',
    kind: 'weather_forecast',
    observedAt: '2026-08-09T08:00:00.000Z',
    rawRef: 'open_meteo:forecast:item_london_1:2026-08-09',
    schemaVersion: 1,
    source: { label: 'Open-Meteo', provider: 'open_meteo', url: 'https://open-meteo.com/en/docs' },
    subject: { id: 'item_london_1', type: 'item' },
    tripId: 'trip_uk_2026',
    value: {
      condition: 'partly_cloudy',
      date: '2026-08-09',
      locationName: '伦敦',
      maxCelsius: 22,
      minCelsius: 16,
      precipitationProbability: 20,
    },
  }
}
