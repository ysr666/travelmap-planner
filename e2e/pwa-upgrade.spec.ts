import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

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
    await page.reload({ waitUntil: 'networkidle' })
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
  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const pathname = decodeURIComponent(requestUrl.pathname)
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
    origin: `http://127.0.0.1:${address.port}`,
    server,
  }
}

async function ensureServiceWorkerController(page: Page) {
  const hasController = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('service worker is unavailable')
    await navigator.serviceWorker.ready
    return Boolean(navigator.serviceWorker.controller)
  })
  if (!hasController) {
    await page.reload({ waitUntil: 'networkidle' })
  }
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10_000 })
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

async function readServiceWorkerVersion(page: Page) {
  return page.evaluate(async () => {
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
