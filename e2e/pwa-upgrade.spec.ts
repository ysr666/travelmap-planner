import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { clickTripCard, getHashParam } from './helpers'

const builtDistDir = join(process.cwd(), 'dist')
const markerStart = '/* tripmap e2e pwa marker:start */'
const markerEnd = '/* tripmap e2e pwa marker:end */'

test.skip(!existsSync(join(builtDistDir, 'index.html')), 'Run npm run build before PWA upgrade smoke.')
test.skip(!existsSync(join(builtDistDir, 'sw.js')), 'PWA upgrade smoke requires a generated sw.js.')
test.setTimeout(60_000)

test('真实构建 PWA 从 v1 升级到 v2 后保留 IndexedDB 数据', async ({ page }) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tripmap-pwa-upgrade-'))
  const appDir = join(tempDir, 'app')
  let server: Server | null = null

  try {
    await cp(builtDistDir, appDir, { recursive: true })
    await writeServiceWorkerVersion(appDir, 'v1')
    const staticServer = await startStaticServer(appDir)
    server = staticServer.server

    await page.goto(`${staticServer.origin}/#/home`, { waitUntil: 'networkidle' })
    await ensureServiceWorkerController(page)
    await expect.poll(() => readServiceWorkerVersion(page), { timeout: 10_000 }).toBe('v1')

    await putIndexedDbMarker(page)
    await writeServiceWorkerVersion(appDir, 'v2')
    await activateUpdatedServiceWorker(page)
    await reloadAfterServiceWorkerActivation(page)
    await ensureServiceWorkerController(page)

    await expect.poll(() => readServiceWorkerVersion(page), { timeout: 10_000 }).toBe('v2')
    await expect(await readIndexedDbMarker(page)).toBe('kept')
  } finally {
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
    await rm(tempDir, { force: true, recursive: true })
  }
})

test('PWA 更新在确认前保持等待，确认后所有标签切换到同一版本', async ({ context }) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tripmap-pwa-multi-tab-'))
  const appDir = join(tempDir, 'app')
  let server: Server | null = null

  try {
    await cp(builtDistDir, appDir, { recursive: true })
    await writeServiceWorkerVersion(appDir, 'v1')
    const staticServer = await startStaticServer(appDir)
    server = staticServer.server
    await context.addInitScript(() => {
      const key = 'tripmap-pwa-document-loads'
      const nextCount = Number(window.sessionStorage.getItem(key) ?? '0') + 1
      window.sessionStorage.setItem(key, String(nextCount))
    })

    const firstPage = await context.newPage()
    const secondPage = await context.newPage()
    await firstPage.goto(`${staticServer.origin}/#/home`, { waitUntil: 'networkidle' })
    await ensureServiceWorkerController(firstPage)
    await secondPage.goto(`${staticServer.origin}/#/home`, { waitUntil: 'networkidle' })
    await ensureServiceWorkerController(secondPage)
    await expect.poll(() => readServiceWorkerVersion(firstPage), { timeout: 10_000 }).toBe('v1')
    await expect.poll(() => readServiceWorkerVersion(secondPage), { timeout: 10_000 }).toBe('v1')

    await putIndexedDbMarker(firstPage)
    const firstLoadsBeforeUpdate = await readDocumentLoadCount(firstPage)
    const secondLoadsBeforeUpdate = await readDocumentLoadCount(secondPage)

    await writeServiceWorkerVersion(appDir, 'v2')
    await prepareUpdatedServiceWorker(firstPage)
    await expect.poll(() => hasWaitingServiceWorker(secondPage), { timeout: 10_000 }).toBe(true)
    await expect(firstPage.getByRole('button', { name: '更新并重启' })).toBeVisible()
    await expect(secondPage.getByRole('button', { name: '更新并重启' })).toBeVisible()

    await firstPage.waitForTimeout(500)
    expect(await readDocumentLoadCount(firstPage)).toBe(firstLoadsBeforeUpdate)
    expect(await readDocumentLoadCount(secondPage)).toBe(secondLoadsBeforeUpdate)
    expect(await readServiceWorkerVersion(firstPage)).toBe('v1')
    expect(await readServiceWorkerVersion(secondPage)).toBe('v1')

    await firstPage.getByRole('button', { name: '更新并重启' }).click()
    await expect.poll(() => readServiceWorkerVersion(firstPage), { timeout: 10_000 }).toBe('v2')
    await expect.poll(() => readServiceWorkerVersion(secondPage), { timeout: 10_000 }).toBe('v2')
    await expect.poll(() => readDocumentLoadCount(firstPage), { timeout: 10_000 })
      .toBeGreaterThan(firstLoadsBeforeUpdate)
    await expect.poll(() => readDocumentLoadCount(secondPage), { timeout: 10_000 })
      .toBeGreaterThan(secondLoadsBeforeUpdate)
    expect(await readIndexedDbMarker(secondPage)).toBe('kept')
  } finally {
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
    await rm(tempDir, { force: true, recursive: true })
  }
})

test('PWA 核心页面预缓存且可选重资源首次使用后缓存', async ({ page, context }) => {
  const tempDir = await mkdtemp(join(tmpdir(), 'tripmap-pwa-cache-'))
  const appDir = join(tempDir, 'app')
  let server: Server | null = null

  try {
    await cp(builtDistDir, appDir, { recursive: true })
    const buildManifest = JSON.parse(
      await readFile(join(appDir, '.vite', 'manifest.json'), 'utf8'),
    ) as Record<string, {
      file: string
      name?: string
    }>
    const mapAsset = Object.values(buildManifest).find((entry) => entry.name === 'maplibre')
    expect(mapAsset?.file).toBeTruthy()
    const mapAssetPath = `/${mapAsset?.file}`
    const mapAssetSize = (await stat(join(appDir, mapAsset?.file ?? ''))).size
    const staticServer = await startStaticServer(appDir)
    server = staticServer.server

    await page.goto(`${staticServer.origin}/#/home`, { waitUntil: 'networkidle' })
    await ensureServiceWorkerController(page)

    const precacheUrls = await readCacheUrls(page, (name) => name.includes('precache'))
    const requiredManifestKeys = [
      'src/pages/TripWorkspacePage.tsx',
      'src/pages/DayViewPage.tsx',
      'src/pages/ItemDetailPage.tsx',
      'src/pages/TicketLibraryPage.tsx',
    ]
    for (const manifestKey of requiredManifestKeys) {
      expect(precacheUrls).toContain(`${staticServer.origin}/${buildManifest[manifestKey].file}`)
    }
    expect(precacheUrls.some((url) => /\/assets\/maplibre-.+\.js$/.test(url))).toBe(false)
    expect(precacheUrls.some((url) => /\/assets\/pdf.+\.js$/.test(url))).toBe(false)
    expect(precacheUrls.some((url) => /\/assets\/jszip-.+\.js$/.test(url))).toBe(false)
    const providerClientCoreAsset = Object.entries(buildManifest).find(([key]) =>
      key.endsWith('src/lib/providerProxyClientCore.ts'),
    )?.[1]
    expect(providerClientCoreAsset?.file).toBeTruthy()
    expect(precacheUrls).not.toContain(`${staticServer.origin}/${providerClientCoreAsset?.file}`)

    const mapAssetUrl = `${staticServer.origin}${mapAssetPath}`
    expect(await readCacheUrls(
      page,
      (name) => name === 'tripmap-on-demand-assets-v1',
    )).not.toContain(mapAssetUrl)
    const requestCountBeforeInterruption = staticServer.getRequestCount(mapAssetPath)
    staticServer.interruptNextRequest(mapAssetPath)
    const interruptedFetch = await page.evaluate(async ({ expectedSize, url }) => {
      try {
        const response = await fetch(url)
        const size = (await response.arrayBuffer()).byteLength
        return {
          complete: response.ok && size === expectedSize,
          size,
        }
      } catch {
        return {
          complete: false,
          size: 0,
        }
      }
    }, { expectedSize: mapAssetSize, url: mapAssetUrl })
    expect(interruptedFetch.complete).toBe(false)
    expect(staticServer.getRequestCount(mapAssetPath)).toBe(requestCountBeforeInterruption + 1)
    await page.waitForTimeout(250)
    expect(await readCacheUrls(
      page,
      (name) => name === 'tripmap-on-demand-assets-v1',
    )).not.toContain(mapAssetUrl)

    const onlineResponse = await page.evaluate(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`failed to fetch on-demand asset: ${response.status}`)
      return {
        ok: response.ok,
        size: (await response.arrayBuffer()).byteLength,
      }
    }, mapAssetUrl)
    expect(onlineResponse.ok).toBe(true)
    expect(onlineResponse.size).toBeGreaterThan(1_000_000)
    expect(staticServer.getRequestCount(mapAssetPath)).toBe(requestCountBeforeInterruption + 2)

    await expect.poll(async () => {
      const runtimeUrls = await readCacheUrls(
        page,
        (name) => name === 'tripmap-on-demand-assets-v1',
      )
      return runtimeUrls.includes(mapAssetUrl)
    }).toBe(true)

    await page.getByRole('button', { name: '创建示例旅行' }).click()
    const tripCard = page.getByTestId('trip-card').filter({ hasText: '东京春日旅行' })
    await expect(tripCard).toBeVisible()

    await context.setOffline(true)
    const cachedResponse = await page.evaluate(async (url) => {
      const response = await fetch(url)
      return {
        ok: response.ok,
        size: (await response.arrayBuffer()).byteLength,
      }
    }, mapAssetUrl)
    expect(cachedResponse.ok).toBe(true)
    expect(cachedResponse.size).toBe(onlineResponse.size)

    await clickTripCard(tripCard)
    await expect(page.getByRole('heading', { name: '每日行程' })).toBeVisible()
    const tripId = getHashParam(page.url(), 'tripId')
    expect(tripId).toBeTruthy()

    await page.getByRole('button', { name: /抵达与涩谷/ }).click()
    await expect(page.getByTestId('day-selector')).toBeVisible()
    await page.getByRole('button', { name: /明治神宫散步/ }).click()
    await expect(page.getByTestId('item-detail-page')).toBeVisible()

    await page.evaluate((currentTripId) => {
      window.location.hash = `/documents?tripId=${currentTripId}&tab=attachments`
    }, tripId)
    await expect(page.getByRole('heading', { name: '票据和订单' })).toBeVisible()
  } finally {
    await context.setOffline(false)
    if (server) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    }
    await rm(tempDir, { force: true, recursive: true })
  }
})

async function writeServiceWorkerVersion(appDir: string, version: 'v1' | 'v2') {
  const swPath = join(appDir, 'sw.js')
  const source = await readFile(swPath, 'utf8')
  const markerPattern = new RegExp(`${escapeRegExp(markerStart)}[\\s\\S]*?${escapeRegExp(markerEnd)}\\s*`, 'g')
  const cleanSource = source.replace(markerPattern, '')
  await writeFile(
    swPath,
    `${cleanSource}
${markerStart}
self.__TRIPMAP_E2E_PWA_VERSION__ = "${version}";
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "TRIPMAP_E2E_PWA_VERSION" && event.source) {
    event.source.postMessage({ type: "TRIPMAP_E2E_PWA_VERSION", version: self.__TRIPMAP_E2E_PWA_VERSION__ });
  }
});
${markerEnd}
`,
    'utf8',
  )
}

async function startStaticServer(rootDir: string) {
  const requestCounts = new Map<string, number>()
  const interruptedRequestCounts = new Map<string, number>()
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(requestUrl.pathname)
      requestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1)
      const requestedFile = pathname === '/' || !extname(pathname)
        ? join(rootDir, 'index.html')
        : resolve(rootDir, `.${pathname}`)
      if (!requestedFile.startsWith(rootDir)) {
        response.writeHead(403)
        response.end('Forbidden')
        return
      }

      const fileStat = await stat(requestedFile)
      if (!fileStat.isFile()) throw new Error('not a file')

      const body = await readFile(requestedFile)
      if (interruptedRequestCounts.get(pathname) === requestCounts.get(pathname)) {
        interruptedRequestCounts.delete(pathname)
        response.writeHead(200, {
          'Cache-Control': 'no-store',
          'Content-Length': body.byteLength,
          'Content-Type': getContentType(requestedFile),
        })
        response.flushHeaders()
        response.write(body.subarray(0, Math.max(1, Math.floor(body.byteLength / 3))))
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25))
        response.destroy()
        return
      }
      response.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': getContentType(requestedFile),
      })
      response.end(body)
    } catch {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('Not found')
    }
  })

  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('failed to start PWA smoke server')
  return {
    getRequestCount(pathname: string) {
      return requestCounts.get(pathname) ?? 0
    },
    interruptNextRequest(pathname: string) {
      interruptedRequestCounts.set(pathname, (requestCounts.get(pathname) ?? 0) + 1)
    },
    origin: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function ensureServiceWorkerController(page: Page) {
  let hasController = false
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      hasController = await page.evaluate(async () => {
        if (!('serviceWorker' in navigator)) throw new Error('service worker is unavailable')
        await navigator.serviceWorker.ready
        return Boolean(navigator.serviceWorker.controller)
      })
      break
    } catch (caught) {
      if (!isServiceWorkerNavigationRaceError(caught) || attempt === 2) {
        throw caught
      }
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    }
  }
  if (!hasController) {
    await reloadAfterServiceWorkerActivation(page)
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10_000 })
}

async function reloadAfterServiceWorkerActivation(page: Page) {
  try {
    await page.reload({ waitUntil: 'networkidle' })
  } catch (caught) {
    if (!isServiceWorkerNavigationRaceError(caught)) {
      throw caught
    }
    await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
  }
}

function isServiceWorkerNavigationRaceError(caught: unknown) {
  const message = String(caught instanceof Error ? caught.message : caught)
  return message.includes('ERR_ABORTED')
    || message.includes('Execution context was destroyed')
    || message.includes('frame was detached')
}

async function activateUpdatedServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('missing service worker registration')

    function waitForUpdatedServiceWorker() {
      return new Promise<ServiceWorker>((resolveWorker, rejectWorker) => {
        const timeout = window.setTimeout(() => {
          registration.removeEventListener('updatefound', handleUpdateFound)
          rejectWorker(new Error('updated service worker did not finish installing'))
        }, 10_000)
        const existingWorker = registration.waiting ?? registration.installing
        if (existingWorker) {
          resolveWhenInstalled(existingWorker)
          return
        }

        function handleUpdateFound() {
          const installingWorker = registration.installing
          if (!installingWorker) return
          resolveWhenInstalled(installingWorker)
        }

        function resolveWhenInstalled(worker: ServiceWorker) {
          if (worker.state === 'installed' || worker.state === 'activated') {
            cleanup()
            resolveWorker(worker)
            return
          }

          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' || worker.state === 'activated') {
              cleanup()
              resolveWorker(worker)
            }
          })
        }

        function cleanup() {
          window.clearTimeout(timeout)
          registration.removeEventListener('updatefound', handleUpdateFound)
        }

        registration.addEventListener('updatefound', handleUpdateFound)
      })
    }

    await registration.update()
    const worker = await waitForUpdatedServiceWorker()
    await new Promise<void>((resolveActivated, rejectActivated) => {
      if (worker.state === 'activated' || registration.active === worker) {
        resolveActivated()
        return
      }

      const timeout = window.setTimeout(() => {
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        rejectActivated(new Error('service worker activation timeout'))
      }, 10_000)

      function handleControllerChange() {
        window.clearTimeout(timeout)
        navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange)
        resolveActivated()
      }

      navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange)
      worker.postMessage({ type: 'SKIP_WAITING' })
    })
  })
}

async function prepareUpdatedServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    if (!registration) throw new Error('missing service worker registration')

    await registration.update()
    await new Promise<void>((resolveWaiting, rejectWaiting) => {
      const timeout = window.setTimeout(() => {
        registration.removeEventListener('updatefound', handleUpdateFound)
        rejectWaiting(new Error('updated service worker did not enter waiting state'))
      }, 10_000)

      const resolveWhenWaiting = () => {
        if (!registration.waiting) return
        window.clearTimeout(timeout)
        registration.removeEventListener('updatefound', handleUpdateFound)
        resolveWaiting()
      }
      const handleUpdateFound = () => {
        const installingWorker = registration.installing
        if (!installingWorker) return
        installingWorker.addEventListener('statechange', resolveWhenWaiting)
        resolveWhenWaiting()
      }

      registration.addEventListener('updatefound', handleUpdateFound)
      if (registration.waiting) {
        resolveWhenWaiting()
        return
      }
      registration.installing?.addEventListener('statechange', resolveWhenWaiting)
      resolveWhenWaiting()
    })
  })
}

async function hasWaitingServiceWorker(page: Page) {
  return page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration()
    return Boolean(registration?.waiting)
  })
}

async function readDocumentLoadCount(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await page.evaluate(() =>
        Number(window.sessionStorage.getItem('tripmap-pwa-document-loads') ?? '0'))
    } catch (caught) {
      if (!isServiceWorkerNavigationRaceError(caught) || attempt === 4) throw caught
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    }
  }
  throw new Error('document load count unavailable')
}

async function readServiceWorkerVersion(page: Page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await page.evaluate(async () => {
        const controller = navigator.serviceWorker.controller
        if (!controller) throw new Error('missing service worker controller')

        return await new Promise<string>((resolveVersion, rejectVersion) => {
          const timeout = window.setTimeout(() => {
            navigator.serviceWorker.removeEventListener('message', handleMessage)
            rejectVersion(new Error('service worker version timeout'))
          }, 5000)

          function handleMessage(event: MessageEvent) {
            if (event.data?.type !== 'TRIPMAP_E2E_PWA_VERSION') return
            window.clearTimeout(timeout)
            navigator.serviceWorker.removeEventListener('message', handleMessage)
            resolveVersion(event.data.version)
          }

          navigator.serviceWorker.addEventListener('message', handleMessage)
          controller.postMessage({ type: 'TRIPMAP_E2E_PWA_VERSION' })
        })
      })
    } catch (caught) {
      if (!isServiceWorkerNavigationRaceError(caught) || attempt === 4) throw caught
      await page.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
    }
  }
  throw new Error('service worker version unavailable')
}

async function putIndexedDbMarker(page: Page) {
  await page.evaluate(async () => {
    async function openSmokeDb() {
      return await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
        const request = indexedDB.open('TripMapPwaUpgradeSmoke', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('records')) {
            request.result.createObjectStore('records')
          }
        }
        request.onsuccess = () => resolveOpen(request.result)
        request.onerror = () => rejectOpen(request.error ?? new Error('failed to open smoke database'))
      })
    }

    const db = await openSmokeDb()
    await new Promise<void>((resolvePut, rejectPut) => {
      const transaction = db.transaction('records', 'readwrite')
      transaction.objectStore('records').put('kept', 'marker')
      transaction.oncomplete = () => {
        db.close()
        resolvePut()
      }
      transaction.onerror = () => rejectPut(transaction.error ?? new Error('failed to write smoke marker'))
    })
  })
}

async function readIndexedDbMarker(page: Page) {
  return page.evaluate(async () => {
    async function openSmokeDb() {
      return await new Promise<IDBDatabase>((resolveOpen, rejectOpen) => {
        const request = indexedDB.open('TripMapPwaUpgradeSmoke', 1)
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('records')) {
            request.result.createObjectStore('records')
          }
        }
        request.onsuccess = () => resolveOpen(request.result)
        request.onerror = () => rejectOpen(request.error ?? new Error('failed to open smoke database'))
      })
    }

    const db = await openSmokeDb()
    return await new Promise<string | undefined>((resolveRead, rejectRead) => {
      const transaction = db.transaction('records', 'readonly')
      const request = transaction.objectStore('records').get('marker')
      request.onsuccess = () => resolveRead(request.result)
      request.onerror = () => rejectRead(request.error ?? new Error('failed to read smoke marker'))
      transaction.oncomplete = () => db.close()
    })
  })
}

async function readCacheUrls(page: Page, cacheNameFilter: (name: string) => boolean) {
  const cacheNames = await page.evaluate(async () => await caches.keys())
  const matchingCacheNames = cacheNames.filter(cacheNameFilter)
  const urlGroups = await Promise.all(
    matchingCacheNames.map((cacheName) =>
      page.evaluate(async (name) => {
        const cache = await caches.open(name)
        const requests = await cache.keys()
        return requests.map((request) => request.url)
      }, cacheName),
    ),
  )
  return urlGroups.flat()
}

function getContentType(filePath: string) {
  const extension = extname(filePath)
  if (extension === '.html') return 'text/html; charset=utf-8'
  if (extension === '.js') return 'text/javascript; charset=utf-8'
  if (extension === '.css') return 'text/css; charset=utf-8'
  if (extension === '.json' || extension === '.webmanifest') return 'application/json; charset=utf-8'
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.png') return 'image/png'
  if (extension === '.ico') return 'image/x-icon'
  return 'application/octet-stream'
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
