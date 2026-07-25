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
}
const FORBIDDEN_INITIAL_CHUNKS = [
  ['global AI', /GlobalAiCommandBar/i],
  ['provider proxy', /providerProxy/i],
  ['map renderer', /maplibre/i],
  ['PDF parser', /(?:^|[-_.])pdf(?:[-_.]|$)/i],
  ['OCR runtime', /(?:^|[-_.])ocr(?:[-_.]|$)|tesseract/i],
  ['archive parser', /jszip/i],
]

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

const summary = [
  `entry ${formatKib(entryBytes)}`,
  `initial ${formatKib(initialRawBytes)}`,
  `initial gzip ${formatKib(initialGzipBytes)}`,
  `${initialChunks.length} startup chunks`,
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
