import { readFile } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import path from 'node:path'

const KIB = 1024
const DIST_DIR = path.resolve(process.argv[2] ?? 'dist')
const MANIFEST_PATH = path.join(DIST_DIR, '.vite', 'manifest.json')
const BUDGETS = {
  entryRaw: 500 * KIB,
  initialRaw: 900 * KIB,
  initialGzip: 260 * KIB,
  precacheRaw: 2500 * KIB,
}
const FORBIDDEN_INITIAL_CHUNKS = [
  ['global AI', /GlobalAiCommandBar/i],
  ['provider proxy', /providerProxy/i],
  ['map renderer', /maplibre/i],
  ['PDF parser', /(?:^|[-_.])pdf(?:[-_.]|$)/i],
  ['OCR runtime', /(?:^|[-_.])ocr(?:[-_.]|$)|tesseract/i],
  ['archive parser', /jszip/i],
  ['trip import commit runtime', /tripPlanImportRepository/i],
  ['ledger mutation runtime', /ledgerMutationRepository/i],
  ['Account workflow runtime', /workflowMutationRuntime/i],
]
const FORBIDDEN_PRECACHE_ASSETS = [
  ['AI draft', /^assets\/AiDraftPage-.+\.js$/],
  ['global AI', /^assets\/GlobalAiCommandBar-.+\.js$/],
  ['archive parser', /^assets\/jszip-.+\.js$/],
  ['map renderer CSS', /^assets\/maplibre-.+\.css$/],
  ['map renderer JS', /^assets\/maplibre-.+\.js$/],
  ['OCR runtime', /^assets\/ocr-.+\.js$/],
  ['OCR worker', /^assets\/worker\.min-.+\.js$/],
  ['PDF parser', /^assets\/pdf.+\.js$/],
  ['Provider network client', /^assets\/providerProxyClientCore-.+\.js$/],
  ['map settings detail', /^assets\/SettingsMapsPage-.+\.js$/],
  ['privacy settings detail', /^assets\/SettingsPrivacyPage-.+\.js$/],
  ['route settings detail', /^assets\/SettingsRoutePage-.+\.js$/],
  ['trip import commit runtime', /^assets\/tripPlanImportRepository-.+\.js$/],
  ['ledger mutation runtime', /^assets\/ledgerMutationRepository-.+\.js$/],
  ['Account workflow runtime', /^assets\/workflowMutationRuntime-.+\.js$/],
]
const REQUIRED_PRECACHE_ASSETS = [
  ['application entry', /^assets\/index-.+\.js$/],
  ['application styles', /^assets\/index-.+\.css$/],
  ['React runtime', /^assets\/react-vendor-.+\.js$/],
  ['Supabase runtime', /^assets\/supabase-vendor-.+\.js$/],
  ['trip workspace', /^assets\/TripWorkspacePage-.+\.js$/],
  ['day view', /^assets\/DayViewPage-.+\.js$/],
  ['item detail', /^assets\/ItemDetailPage-.+\.js$/],
  ['ticket library', /^assets\/TicketLibraryPage-.+\.js$/],
]
const RUNTIME_ASSET_CACHE_NAME = 'tripmap-on-demand-assets-v1'
const PROVIDER_CLIENT_CORE_MANIFEST_KEY = 'src/lib/providerProxyClientCore.ts'
const TRIP_IMPORT_REPOSITORY_MANIFEST_KEY = 'src/db/tripPlanImportRepository.ts'
const LEDGER_MUTATION_REPOSITORY_MANIFEST_KEY = 'src/db/ledgerMutationRepository.ts'

const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'))
const entries = Object.entries(manifest).filter(([, chunk]) => chunk.isEntry)

if (entries.length !== 1) {
  throw new Error(`Expected one application entry in ${MANIFEST_PATH}, found ${entries.length}.`)
}

const [entryKey, entryChunk] = entries[0]
const initialKeys = new Set()

function visitStaticImports(key) {
  if (initialKeys.has(key)) {
    return
  }

  const chunk = manifest[key]
  if (!chunk) {
    throw new Error(`Bundle manifest references unknown chunk "${key}".`)
  }

  initialKeys.add(key)
  for (const importedKey of chunk.imports ?? []) {
    visitStaticImports(importedKey)
  }
}

visitStaticImports(entryKey)

const initialChunks = []
for (const key of initialKeys) {
  const chunk = manifest[key]
  if (!chunk.file.endsWith('.js')) {
    continue
  }

  const contents = await readFile(path.join(DIST_DIR, chunk.file))
  initialChunks.push({
    file: chunk.file,
    gzipBytes: gzipSync(contents).byteLength,
    rawBytes: contents.byteLength,
  })
}

const entryFile = path.join(DIST_DIR, entryChunk.file)
const entryBytes = (await readFile(entryFile)).byteLength
const initialRawBytes = initialChunks.reduce((total, chunk) => total + chunk.rawBytes, 0)
const initialGzipBytes = initialChunks.reduce((total, chunk) => total + chunk.gzipBytes, 0)
const failures = []

const applicationStyles = entryChunk.css ?? []
if (applicationStyles.length !== 1) {
  failures.push(`expected one application stylesheet, found ${applicationStyles.length}`)
} else {
  const applicationCss = await readFile(path.join(DIST_DIR, applicationStyles[0]), 'utf8')
  for (const [selector, declaration] of [
    ['body', 'min-height:100vh'],
    ['#root', 'min-height:100vh'],
    ['.app-viewport', 'height:100vh'],
    ['.app-viewport', 'min-height:100vh'],
  ]) {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const rulePattern = new RegExp(`(?:^|})[^{}]*${escapedSelector}[^{}]*\\{[^{}]*${declaration}`)
    if (!rulePattern.test(applicationCss)) {
      failures.push(`application CSS lost the legacy viewport fallback (${selector} ${declaration})`)
    }
  }
}

if (entryBytes > BUDGETS.entryRaw) {
  failures.push(`entry JS is ${formatKib(entryBytes)} (limit ${formatKib(BUDGETS.entryRaw)})`)
}
if (initialRawBytes > BUDGETS.initialRaw) {
  failures.push(`initial JS is ${formatKib(initialRawBytes)} (limit ${formatKib(BUDGETS.initialRaw)})`)
}
if (initialGzipBytes > BUDGETS.initialGzip) {
  failures.push(
    `initial gzip JS is ${formatKib(initialGzipBytes)} (limit ${formatKib(BUDGETS.initialGzip)})`,
  )
}

for (const [label, pattern] of FORBIDDEN_INITIAL_CHUNKS) {
  const match = initialChunks.find((chunk) => pattern.test(path.basename(chunk.file)))
  if (match) {
    failures.push(`${label} chunk is loaded on startup (${match.file})`)
  }
}

const providerClientCoreChunk = manifest[PROVIDER_CLIENT_CORE_MANIFEST_KEY]
if (!providerClientCoreChunk) {
  failures.push('Provider network client is not emitted as its own on-demand chunk')
} else if (!Object.values(manifest).some((chunk) =>
  chunk.dynamicImports?.includes(PROVIDER_CLIENT_CORE_MANIFEST_KEY),
)) {
  failures.push('Provider network client is no longer behind a dynamic import')
}

const tripImportRepositoryChunk = manifest[TRIP_IMPORT_REPOSITORY_MANIFEST_KEY]
if (!tripImportRepositoryChunk) {
  failures.push('Trip import commit runtime is not emitted as its own on-demand chunk')
} else if (!Object.values(manifest).some((chunk) =>
  chunk.dynamicImports?.includes(TRIP_IMPORT_REPOSITORY_MANIFEST_KEY),
)) {
  failures.push('Trip import commit runtime is no longer behind a dynamic import')
}

const ledgerMutationRepositoryChunk = manifest[LEDGER_MUTATION_REPOSITORY_MANIFEST_KEY]
if (!ledgerMutationRepositoryChunk) {
  failures.push('Ledger mutation runtime is not emitted as its own on-demand chunk')
} else if (!Object.values(manifest).some((chunk) =>
  chunk.dynamicImports?.includes(LEDGER_MUTATION_REPOSITORY_MANIFEST_KEY),
)) {
  failures.push('Ledger mutation runtime is no longer behind a dynamic import')
}

const serviceWorkerSource = await readFile(path.join(DIST_DIR, 'sw.js'), 'utf8')
const precacheUrls = extractPrecacheUrls(serviceWorkerSource)
const duplicatePrecacheUrls = precacheUrls.filter(
  (url, index) => precacheUrls.indexOf(url) !== index,
)
if (duplicatePrecacheUrls.length > 0) {
  failures.push(
    `precache contains duplicate URLs (${Array.from(new Set(duplicatePrecacheUrls)).join(', ')})`,
  )
}

let precacheRawBytes = 0
for (const url of new Set(precacheUrls)) {
  const relativePath = url.replace(/^\/+/, '')
  if (!relativePath || relativePath.includes('..')) {
    failures.push(`precache contains an unsafe local URL (${url})`)
    continue
  }
  const contents = await readFile(path.join(DIST_DIR, relativePath))
  precacheRawBytes += contents.byteLength
}

if (precacheRawBytes > BUDGETS.precacheRaw) {
  failures.push(
    `precache is ${formatKib(precacheRawBytes)} (limit ${formatKib(BUDGETS.precacheRaw)})`,
  )
}

for (const [label, pattern] of REQUIRED_PRECACHE_ASSETS) {
  if (!precacheUrls.some((url) => pattern.test(url))) {
    failures.push(`${label} is missing from the precache`)
  }
}

for (const [label, pattern] of FORBIDDEN_PRECACHE_ASSETS) {
  const match = precacheUrls.find((url) => pattern.test(url))
  if (match) {
    failures.push(`${label} must be cached on demand (${match})`)
  }
}

if (providerClientCoreChunk && precacheUrls.includes(providerClientCoreChunk.file)) {
  failures.push(`Provider network client must be cached on demand (${providerClientCoreChunk.file})`)
}
if (tripImportRepositoryChunk && precacheUrls.includes(tripImportRepositoryChunk.file)) {
  failures.push(`Trip import commit runtime must be cached on demand (${tripImportRepositoryChunk.file})`)
}
if (ledgerMutationRepositoryChunk && precacheUrls.includes(ledgerMutationRepositoryChunk.file)) {
  failures.push(`Ledger mutation runtime must be cached on demand (${ledgerMutationRepositoryChunk.file})`)
}

if (!serviceWorkerSource.includes(RUNTIME_ASSET_CACHE_NAME)) {
  failures.push(`Service Worker is missing runtime asset cache "${RUNTIME_ASSET_CACHE_NAME}"`)
}

const summary = [
  `entry ${formatKib(entryBytes)}`,
  `initial ${formatKib(initialRawBytes)}`,
  `initial gzip ${formatKib(initialGzipBytes)}`,
  `${initialChunks.length} startup chunks`,
  `precache ${formatKib(precacheRawBytes)}`,
  `${precacheUrls.length} precache entries`,
].join(', ')

if (failures.length > 0) {
  console.error(`Bundle budget failed: ${summary}`)
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exitCode = 1
} else {
  console.log(`Bundle budget passed: ${summary}`)
}

function formatKib(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`
}

function extractPrecacheUrls(serviceWorkerSource) {
  const marker = 'precacheAndRoute('
  const markerIndex = serviceWorkerSource.indexOf(marker)
  if (markerIndex < 0) {
    throw new Error('Generated Service Worker has no precacheAndRoute call.')
  }

  const arrayStart = serviceWorkerSource.indexOf('[', markerIndex + marker.length)
  if (arrayStart < 0) {
    throw new Error('Generated Service Worker has no precache manifest array.')
  }

  let depth = 0
  let escaped = false
  let inString = false
  for (let index = arrayStart; index < serviceWorkerSource.length; index += 1) {
    const character = serviceWorkerSource[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }

    if (character === '"') {
      inString = true
    } else if (character === '[') {
      depth += 1
    } else if (character === ']') {
      depth -= 1
      if (depth === 0) {
        const arraySource = serviceWorkerSource.slice(arrayStart, index + 1)
        const urlMatches = Array.from(
          arraySource.matchAll(/(?:\burl|"url")\s*:\s*("(?:\\.|[^"\\])*")/g),
        )
        if (urlMatches.length === 0) {
          throw new Error('Generated Service Worker precache manifest has no URLs.')
        }
        return urlMatches.map((match) => JSON.parse(match[1]))
      }
    }
  }

  throw new Error('Generated Service Worker precache manifest is incomplete.')
}
