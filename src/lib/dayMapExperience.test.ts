import { describe, expect, it } from 'vitest'
import type { ItineraryItem } from '../types'
import { buildDayMapExperience, type DayMapRouteInput } from './dayMapExperience'

describe('day map experience', () => {
  it('uses real road geometry and derives a transport-aware active segment', () => {
    const items = [
      item('castle', 55.9486, -3.1999, 1),
      item('mile', 55.9501, -3.1890, 2, { previousTransportDurationMinutes: 12, previousTransportMode: 'walk' }),
      item('palace', 55.9527, -3.1723, 3, { previousTransportDurationMinutes: 18, previousTransportMode: 'bus' }),
    ]
    const route: DayMapRouteInput = {
      distanceMeters: 2250,
      durationSeconds: 1800,
      lineStrings: [
        [[-3.1999, 55.9486], [-3.1940, 55.9495], [-3.1890, 55.9501]],
        [[-3.1890, 55.9501], [-3.1810, 55.9510], [-3.1723, 55.9527]],
      ],
      provider: 'openrouteservice',
      status: 'road',
    }

    const experience = buildDayMapExperience({
      items,
      providerConfigured: true,
      route,
      selectedItemId: 'palace',
    })

    expect(experience.route).toMatchObject({
      activeLineKind: 'transit',
      activeSegmentIndex: 1,
      canRefresh: true,
      detail: '约 30 分钟 · 2.3 公里',
      geometryKind: 'road',
      label: '道路路线',
      lineKind: 'road',
      sourceLabel: '路线服务',
    })
    expect(experience.route.activeLineStrings).toEqual([route.lineStrings[1]])
    expect(experience.selectedStop).toMatchObject({
      navigationHref: expect.stringContaining('google.com/maps'),
      sequence: 3,
      ticketCount: 0,
      transportLabel: '公交 18 分钟',
    })
  })

  it('labels mixed and missing geometry as estimates instead of roads', () => {
    const items = [item('a', 35.1, 139.1, 1), item('b', 35.2, 139.2, 2)]
    const mixed = buildDayMapExperience({
      items,
      providerConfigured: true,
      route: {
        lineStrings: [[[139.1, 35.1], [139.15, 35.15], [139.2, 35.2]]],
        provider: 'google',
        status: 'mixed',
      },
    })
    const missing = buildDayMapExperience({ items, providerConfigured: false, route: null })

    expect(mixed.route).toMatchObject({
      activeLineKind: 'estimate',
      geometryKind: 'mixed',
      label: '部分路段估算',
      lineKind: 'sequence',
    })
    expect(missing.route).toMatchObject({
      activeLineKind: 'estimate',
      canRefresh: false,
      detail: '虚线仅表示地点顺序',
      geometryKind: 'estimate',
      label: '路线为估算',
      lineKind: 'sequence',
    })
    expect(missing.route.activeLineStrings).toEqual([[[139.1, 35.1], [139.2, 35.2]]])
  })

  it('reports unavailable routes when fewer than two coordinates exist', () => {
    const experience = buildDayMapExperience({
      items: [item('mapped', 35.1, 139.1, 1), { ...item('missing', 35.2, 139.2, 2), lat: undefined, lng: undefined }],
      providerConfigured: true,
      route: null,
    })

    expect(experience.route).toMatchObject({
      activeSegmentIndex: null,
      canRefresh: false,
      detail: '需要至少两个坐标',
      geometryKind: 'unavailable',
      label: '路线不可用',
    })
  })
})

function item(
  id: string,
  lat: number,
  lng: number,
  sortOrder: number,
  extra: Partial<ItineraryItem> = {},
): ItineraryItem {
  return {
    createdAt: 1,
    dayId: 'day',
    id,
    lat,
    lng,
    sortOrder,
    ticketIds: [],
    title: id,
    tripId: 'trip',
    updatedAt: 1,
    ...extra,
  }
}
