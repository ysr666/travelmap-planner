import { describe, expect, it } from 'vitest'
import type { AiTripDraft } from './aiTripDraft'
import { buildAiTripDraftImportCheck } from './aiTripDraftImportCheck'
import type { RoutingConfig } from '../routing'

describe('aiTripDraftImportCheck', () => {
  it('summarizes draft import counts and route-ready days', () => {
    const check = buildAiTripDraftImportCheck({
      autoSyncEnabled: true,
      draft: buildDraft(),
      routingConfig: proxyRoutingConfig(),
    })

    expect(check).toMatchObject({
      autoSyncEnabled: true,
      dateRangeLabel: '2025-04-01 至 2025-04-02',
      dayCount: 2,
      dailyTipCount: 2,
      destination: '东京',
      invalidCoordinateCount: 1,
      itemCount: 5,
      missingCoordinateCount: 1,
      routeEligibleDayCount: 1,
      routeProviderConfigured: true,
      routeReadyDayCount: 1,
      title: '最终导入检查测试',
      validCoordinateCount: 3,
    })
    expect(check.routeSummary).toContain('可生成 1 天路线')
    expect(check.autoSyncMessage).toContain('等待同步')
  })

  it('reports route eligible days when route provider is unavailable', () => {
    const check = buildAiTripDraftImportCheck({
      autoSyncEnabled: false,
      draft: buildDraft(),
      routingConfig: {
        apiKey: null,
        configured: false,
        googleMapsKey: null,
        provider: 'none',
        source: 'none',
      },
    })

    expect(check.routeEligibleDayCount).toBe(1)
    expect(check.routeProviderConfigured).toBe(false)
    expect(check.routeReadyDayCount).toBe(0)
    expect(check.routeSummary).toContain('路线服务未配置')
    expect(check.autoSyncMessage).toContain('只会保存在当前设备')
  })

  it('handles drafts without route-ready days', () => {
    const check = buildAiTripDraftImportCheck({
      autoSyncEnabled: true,
      draft: {
        ...buildDraft(),
        days: [{
          date: '2025-04-01',
          items: [{ title: '无坐标地点' }],
        }],
      },
      routingConfig: proxyRoutingConfig(),
    })

    expect(check.routeEligibleDayCount).toBe(0)
    expect(check.routeReadyDayCount).toBe(0)
    expect(check.routeSummary).toContain('暂无可生成路线')
  })
})

function buildDraft(): AiTripDraft {
  return {
    days: [
      {
        date: '2025-04-01',
        items: [
          { title: '东京站', lat: 35.6812, lng: 139.7671, previousTransportMode: 'walk' },
          { title: '皇居外苑', lat: 35.6809, lng: 139.7571, previousTransportMode: 'walk' },
          { title: '东京塔', lat: 35.6585, lng: 139.7454, previousTransportMode: 'car' },
        ],
        tips: ['保留午餐时间。', ''],
        title: '路线可生成日',
      },
      {
        date: '2025-04-02',
        items: [
          { title: '缺坐标地点' },
          { title: '异常坐标地点', lat: 91, lng: 139 },
        ],
        tips: ['提前确认开放时间。'],
        title: '坐标待补全日',
      },
    ],
    destination: '东京',
    endDate: '2025-04-02',
    startDate: '2025-04-01',
    title: '最终导入检查测试',
  }
}

function proxyRoutingConfig(): RoutingConfig {
  return {
    apiKey: null,
    configured: true,
    googleMapsKey: null,
    provider: 'openrouteservice',
    routeProxyUrl: '/api/provider-proxy',
    source: 'proxy',
  }
}
