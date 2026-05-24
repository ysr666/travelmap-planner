import { expect, test, type Page } from '@playwright/test'
import {
  clearTravelDatabase,
  createDemoTripViaUi,
  expectNoHorizontalOverflow,
  forceRouteProxyFixture,
  forceSupabaseUnconfigured,
  getHashParam,
  mockMapStyle,
  mockProviderProxyForOrsRoute,
  seedTravelRecords,
  setRouteProxyConfig,
} from './helpers'

test('旅行工作台可以在日程和地图视图之间切换', async ({ page }) => {
  await mockMapStyle(page)
  const tripId = await createDemoTripViaUi(page)
  expect(tripId).toBeTruthy()

  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  const dayBrief = page.getByTestId('day-local-brief-card')
  await expect(dayBrief).toBeVisible()
  await expect(dayBrief).toContainText('当日简报')
  await expect(dayBrief).toContainText('本地检查')
  await expect(dayBrief).toContainText('准备提醒')
  await expect(dayBrief).toContainText(/根据已填写内容|基于当前本地行程信息/)
  await expect(dayBrief).toContainText('开放时间')
  await expect(dayBrief.getByRole('button')).toHaveCount(0)
  await expect(page).toHaveURL(/#\/day\?/)
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expect(dayBrief).toBeHidden()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-schedule').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=schedule/)
  await expect(page.getByRole('heading', { name: '当天日程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Hotel Metropolitan Tokyo 入住/ })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('view-switch-map').click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expect(page.getByRole('heading', { name: '抵达与涩谷' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await page.getByTestId('day-selector').getByRole('button', { name: /Day 2/ }).click()
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()
  await expectNoHorizontalOverflow(page)

  const currentTripId = getHashParam(page.url(), 'tripId')
  const currentDayId = getHashParam(page.url(), 'dayId')
  expect(currentTripId).toBe(tripId)
  expect(currentDayId).toBeTruthy()

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await expect(page.getByRole('heading', { name: '每日行程' })).toBeVisible()
  await expect(page.getByRole('button', { name: /抵达与涩谷/ })).toContainText('3 个行程点')
  await expect(page.getByRole('button', { name: /浅草与东京站/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /2026年4月12日/ })).toBeVisible()
  const mapOverview = page.getByTestId('trip-map-overview')
  const localCheck = page.getByTestId('local-trip-check-card')
  await expect(localCheck).toBeVisible()
  await expect(localCheck).toContainText('行程体检')
  await expect(localCheck).toContainText('本地检查')
  await expect(localCheck).toContainText('准备提醒')
  await expect(localCheck).toContainText('行程点')
  await expect(localCheck).toContainText('票据')
  await expect(localCheck).toContainText('开放时间')
  await expect(localCheck.getByRole('button')).toHaveCount(0)
  expect(await localCheck.getByTestId('local-trip-check-finding').count()).toBeLessThanOrEqual(3)
  await expectNoHorizontalOverflow(page)

  await expect(mapOverview).toBeVisible()
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview).toContainText('5 个有坐标地点')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewMapCanvasInPlot(page)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText(
    '路线仅供预览，不会自动改行程顺序。',
  )
  const noteIsOutsidePlot = await mapOverview.evaluate((overview) => {
    const plot = overview.querySelector('[data-testid="trip-map-overview-plot"]')
    const note = overview.querySelector('[data-testid="trip-map-overview-note"]')
    return Boolean(plot && note && !plot.contains(note))
  })
  expect(noteIsOutsidePlot).toBe(true)
  await expectNoHorizontalOverflow(page)
  await mapOverview.getByRole('button', { name: '查看地图' }).click()
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)
  await expect(page.getByTestId('map-sheet')).toBeVisible()

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)

  await page.getByRole('button', { name: '更多' }).click()
  const moreMenu = page.getByTestId('trip-more-menu')
  await expect(moreMenu).toBeVisible()
  await expect(moreMenu.getByRole('button', { name: '设置' })).toBeVisible()
  await expect(moreMenu.getByText('设置与存储说明')).toHaveCount(0)
  await expect(moreMenu.getByText(/Google Maps 配置|路线服务配置|路线服务|设备存储/)).toHaveCount(0)
  await moreMenu.getByRole('button', { name: '更多' }).click()
  await expectNoHorizontalOverflow(page)

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${currentDayId}&view=map`, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/#\/day\?/)
  await expect(page).toHaveURL(/view=map/)

  await page.getByRole('button', { name: '总览' }).click()
  await expect(page).toHaveURL(/#\/trip\?/)
  await page.getByRole('button', { name: '票据库' }).click()
  await expect(page).toHaveURL(/#\/tickets\?/)
  await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  await expectNoHorizontalOverflow(page)

  await forceSupabaseUnconfigured(page)
  await page.goto(`/#/settings?tripId=${tripId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await page.locator('summary').filter({ hasText: '关于' }).click()
  await expect(page.getByText(/当前版本：v\d+\.\d+\.\d+(?:\.\d+)?/)).toBeVisible()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线准备在坐标不足时保持安静不可用', async ({ page }) => {
  await clearTravelDatabase(page)
  const now = Date.now()
  await seedTravelRecords(page, {
    trips: [{
      createdAt: now,
      destination: '日本东京',
      endDate: '2026-04-12',
      id: 'trip-no-route-coords',
      startDate: '2026-04-12',
      title: '坐标待补充旅行',
      updatedAt: now,
    }],
    days: [{
      date: '2026-04-12',
      id: 'day-no-route-coords',
      sortOrder: 1,
      title: '坐标待补充',
      tripId: 'trip-no-route-coords',
    }],
    itineraryItems: [{
      createdAt: now,
      dayId: 'day-no-route-coords',
      id: 'item-no-route-coords',
      sortOrder: 1,
      ticketIds: [],
      title: '还没有坐标的地点',
      tripId: 'trip-no-route-coords',
      updatedAt: now,
    }],
  })

  await page.goto('/#/trip?tripId=trip-no-route-coords&dayId=day-no-route-coords', { waitUntil: 'domcontentloaded' })
  const panel = page.getByTestId('route-preparation-panel')

  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('route-preparation-summary')).toContainText('补充至少两个有坐标')
  await expect(panel.getByRole('button', { name: '生成路线预览' })).toBeDisabled()
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览缓存路线且路线顺序建议需要确认', async ({ page }) => {
  await mockMapStyle(page)
  await mockProviderProxyForOrsRoute(page)
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 3200,
            duration: '840s',
            optimizedIntermediateWaypointIndex: [1, 0],
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(({ currentDayId, currentTripId }) => {
    return new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction(['itineraryItems'], 'readwrite')
        tx.objectStore('itineraryItems').add({
          createdAt: Date.now(),
          dayId: currentDayId,
          id: 'item_extra_optimization',
          lat: 35.6812,
          lng: 139.7671,
          previousTransportMode: 'car',
          sortOrder: 4,
          ticketIds: [],
          title: '东京站补充点',
          tripId: currentTripId,
          updatedAt: Date.now(),
        })
        tx.onerror = () => reject(tx.error)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
      }
    })
  }, { currentDayId: dayId, currentTripId: tripId })

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  await setRouteProxyConfig(page)
  const mapOverview = page.getByTestId('trip-map-overview')
  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewMapCanvasInPlot(page)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(6)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(page.getByTestId('route-preparation-panel')).toContainText('路线准备')
  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为 2 天生成路线预览')
  expect(await readRouteCacheEntryCount(page)).toBe(0)
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)

  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  const routeDialog = page.getByTestId('route-generation-confirm-dialog')
  await expect(routeDialog).toContainText('将调用路线服务')
  await expect(routeDialog).toContainText('不会自动调整')
  await expect(routeDialog).toContainText('不会生成公交')
  expect(await readRouteCacheEntryCount(page)).toBe(0)

  await page.getByRole('button', { name: '确认生成' }).click()
  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成 1 天路线预览')
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await mockProviderProxyForOrsRoute(page)
  await expect(page.getByTestId('trip-map-overview').getByTestId('trip-map-overview-note')).toContainText('已缓存的 ORS 路线几何')
  await expect(page.getByTestId('trip-map-overview').getByText(/加载地图预览/)).toHaveCount(0)

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
    window.dispatchEvent(new Event('tripmap:google-maps-config-changed'))
  })
  await expect(page.getByTestId('trip-map-optimization-panel')).toBeVisible()
  await page.getByTestId('trip-map-optimization-check').click()
  await expect(page.getByTestId('trip-map-optimization-suggestion')).toContainText('东京站补充点')

  const originalOrder = await readDayItemOrder(page, dayId as string)
  await page.getByTestId('trip-map-optimization-apply').click()
  await expect(page.getByTestId('trip-map-optimization-confirm')).toBeVisible()
  await page.getByTestId('trip-map-optimization-cancel').click()
  expect(await readDayItemOrder(page, dayId as string)).toEqual(originalOrder)

  await page.getByTestId('trip-map-optimization-apply').click()
  await page.getByTestId('trip-map-optimization-confirm-apply').click()
  await expect.poll(() => readDayItemOrder(page, dayId as string)).not.toEqual(originalOrder)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 路线生成可在确认后使用 mock provider proxy', async ({ page }) => {
  await mockMapStyle(page)
  let proxyCalls = 0
  await page.route('**/api/provider-proxy', async (route) => {
    proxyCalls += 1
    const body = route.request().postDataJSON() as {
      coordinates: number[][]
      operation: string
      provider: string
      quotaSessionId?: string
      segments: Array<{
        fromCoordinateIndex: number
        fromItemId?: string
        segmentIndex: number
        toCoordinateIndex: number
        toItemId?: string
      }>
    }
    expect(body.operation).toBe('route_preview')
    expect(body.provider).toBe('openrouteservice')
    expect(body.quotaSessionId).toBeTruthy()
    expect(JSON.stringify(body)).not.toContain('OPENROUTESERVICE_API_KEY')
    expect(JSON.stringify(body)).not.toContain('GOOGLE_ROUTES_API_KEY')
    await route.fulfill({
      body: JSON.stringify({
        ok: true,
        operation: 'route_preview',
        provider: 'openrouteservice',
        route: {
          lineStrings: body.segments.map((segment) => [
            body.coordinates[segment.fromCoordinateIndex],
            body.coordinates[segment.toCoordinateIndex],
          ]),
          segments: body.segments.map((segment) => ({
            coordinates: [
              body.coordinates[segment.fromCoordinateIndex],
              body.coordinates[segment.toCoordinateIndex],
            ],
            distanceMeters: 1200,
            durationSeconds: 600,
            fromItemId: segment.fromItemId,
            kind: 'road',
            segmentIndex: segment.segmentIndex,
            toItemId: segment.toItemId,
          })),
          status: 'road',
          warnings: [],
        },
      }),
      contentType: 'application/json',
    })
  })

  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()
  await forceRouteProxyFixture(page)
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByTestId('route-preparation-summary')).toContainText('可为')
  expect(proxyCalls).toBe(0)
  await page.getByTestId('route-preparation-panel').getByRole('button', { name: '生成路线预览' }).click()
  await expect(page.getByTestId('route-generation-confirm-dialog')).toContainText('将调用路线服务')
  expect(proxyCalls).toBe(0)
  await page.getByRole('button', { name: '确认生成' }).click()

  await expect(page.getByTestId('route-preparation-result')).toContainText('已生成')
  expect(proxyCalls).toBeGreaterThan(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home 地图预览在 MapLibre 样式失败时仍显示轻量预览', async ({ page }) => {
  await page.route('https://*.basemaps.cartocdn.com/**', (route) => route.abort())
  await page.route('https://tiles.openfreemap.org/styles/**', (route) => route.abort())
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview).toContainText('行程地图预览')
  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expectTripPreviewMapCanvasInPlot(page)
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByText('地图底图暂时无法加载')).toBeVisible()
  await expect(mapOverview.getByText(/加载地图预览/)).toHaveCount(0)
  await expectNoHorizontalOverflow(page)
})

test('Trip Home Google 地图预览不依赖 AdvancedMarker', async ({ page }) => {
  await mockGoogleMapsScript(page)
  let googleRouteCalls = 0
  await page.route('https://routes.googleapis.com/directions/v2:computeRoutes', async (route) => {
    googleRouteCalls += 1
    await route.fulfill({
      body: JSON.stringify({
        routes: [
          {
            distanceMeters: 1200,
            duration: '600s',
            polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
          },
        ],
      }),
      contentType: 'application/json',
    })
  })
  const tripId = await createDemoTripViaUi(page)
  const dayId = getHashParam(page.url(), 'dayId')
  expect(dayId).toBeTruthy()

  await page.evaluate(() => {
    window.localStorage.setItem('tripmap:google-maps-api-key', 'fake-google-key')
  })
  await page.goto(`/#/trip?tripId=${tripId}&dayId=${dayId}`, { waitUntil: 'domcontentloaded' })
  const mapOverview = page.getByTestId('trip-map-overview')

  await expect(mapOverview.getByTestId('trip-map-preview-map')).toHaveAttribute('data-interactive', 'false')
  await expect(mapOverview.getByTestId('trip-map-preview-overlay')).toHaveCount(0)
  await expect(mapOverview.getByTestId('trip-map-overview-marker')).toHaveCount(5)
  await expect(mapOverview.getByTestId('trip-map-google-route-line')).toHaveCount(1)
  await expect(mapOverview.getByTestId('trip-map-overview-note')).toContainText('尚未生成路线预览')
  await expect(mapOverview.locator('.maplibregl-map')).toHaveCount(0)
  expect(googleRouteCalls).toBe(0)
  await expectNoHorizontalOverflow(page)
})

async function readDayItemOrder(page: import('@playwright/test').Page, dayId: string) {
  return page.evaluate(async (currentDayId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TravelConsoleDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const tx = db.transaction(['itineraryItems'], 'readonly')
    const index = tx.objectStore('itineraryItems').index('dayId')
    const items = await new Promise<Array<{ id: string; sortOrder: number; title: string }>>((resolve, reject) => {
      const request = index.getAll(currentDayId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return items.sort((first, second) => first.sortOrder - second.sortOrder).map((item) => item.id)
  }, dayId)
}

async function readRouteCacheEntryCount(page: import('@playwright/test').Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('TripMapRouteCacheDB')
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    if (!Array.from(db.objectStoreNames).includes('routeCaches')) {
      db.close()
      return 0
    }
    const tx = db.transaction(['routeCaches'], 'readonly')
    const count = await new Promise<number>((resolve, reject) => {
      const request = tx.objectStore('routeCaches').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return count
  })
}

async function expectTripPreviewMapCanvasInPlot(page: Page) {
  await expect.poll(async () => {
    return page.evaluate(() => {
      const plot = document.querySelector('[data-testid="trip-map-overview-plot"]')
      const map = document.querySelector('[data-testid="trip-map-preview-map"]')
      const canvas = map?.querySelector('canvas')
      if (!plot || !map || !canvas) return false

      const plotRect = plot.getBoundingClientRect()
      const mapRect = map.getBoundingClientRect()
      const canvasRect = canvas.getBoundingClientRect()
      return (
        mapRect.width > 0 &&
        mapRect.height > 0 &&
        canvasRect.width > 0 &&
        canvasRect.height > 0 &&
        Math.abs(mapRect.height - plotRect.height) <= 1 &&
        Math.abs(canvasRect.height - plotRect.height) <= 1
      )
    })
  }).toBe(true)
}

async function mockGoogleMapsScript(page: Page) {
  await page.route('https://maps.googleapis.com/maps/api/js**', async (route) => {
    await route.fulfill({
      body: `
        (() => {
          const listeners = new WeakMap();
          function getListeners(target, event) {
            let targetListeners = listeners.get(target);
            if (!targetListeners) {
              targetListeners = {};
              listeners.set(target, targetListeners);
            }
            targetListeners[event] ||= [];
            return targetListeners[event];
          }
          class LatLng {
            constructor(lat, lng) {
              this._lat = lat;
              this._lng = lng;
            }
            lat() { return this._lat; }
            lng() { return this._lng; }
          }
          class LatLngBounds {
            constructor(sw, ne) {
              this.sw = sw;
              this.ne = ne;
            }
          }
          class Map {
            constructor(container, options) {
              this.container = container;
              this.center = new LatLng(options.center.lat, options.center.lng);
              this.zoom = options.zoom;
              this.panes = { overlayMouseTarget: container };
              window.setTimeout(() => {
                google.maps.event.trigger(this, 'tilesloaded');
                google.maps.event.trigger(this, 'idle');
              }, 0);
            }
            fitBounds() { google.maps.event.trigger(this, 'idle'); }
            getCenter() { return this.center; }
            getZoom() { return this.zoom; }
            panTo(center) { this.center = new LatLng(center.lat, center.lng); google.maps.event.trigger(this, 'idle'); }
            setCenter(center) { this.center = new LatLng(center.lat, center.lng); }
            setOptions(options) {
              if (options.center) this.setCenter(options.center);
              if (options.zoom != null) this.zoom = options.zoom;
            }
            setZoom(zoom) { this.zoom = zoom; }
          }
          class OverlayView {
            setMap(map) {
              this.map = map;
              if (map) {
                this.onAdd?.();
                this.draw?.();
              } else {
                this.onRemove?.();
              }
            }
            getPanes() { return this.map?.panes; }
            getProjection() {
              return {
                fromLatLngToDivPixel: (position) => ({
                  x: (position.lng() - 139) * 1000 + 160,
                  y: (36 - position.lat()) * 1000 + 80,
                }),
              };
            }
          }
          class Polyline {
            constructor(options) {
              this.path = options.path ?? [];
              this.element = document.createElement('div');
              this.element.dataset.testid = 'trip-map-google-route-line';
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(options.map ?? null);
            }
            setMap(map) {
              this.map = map;
              this.element.remove();
              if (map && this.path.length > 0) {
                map.container.appendChild(this.element);
              }
            }
            setPath(path) {
              this.path = path;
              this.element.setAttribute('data-point-count', String(this.path.length));
              this.setMap(this.map);
            }
          }
          const event = {
            addListener(target, name, handler) {
              getListeners(target, name).push(handler);
              return { remove() {} };
            },
            addListenerOnce(target, name, handler) {
              const wrapped = () => handler();
              getListeners(target, name).push(wrapped);
              return { remove() {} };
            },
            trigger(target, name) {
              for (const handler of getListeners(target, name)) handler();
            },
          };
          window.google = { maps: { event, LatLng, LatLngBounds, Map, OverlayView, Polyline } };
          window.__googleMapsInitCallback?.();
        })();
      `,
      contentType: 'application/javascript',
    })
  })
}
