import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
])
const PRODUCTION_FORBIDDEN_MARKERS = [
  '/fixtures/product-fidelity/',
  'tripmap:e2e:',
  'tripmap-e2e-',
  'uk-family-trip-product-fidelity-v1',
  '测试云端同步 fixture',
  'VITE_E2E_AUTH_BYPASS',
  '__TRIPMAP_UNIT_TEST__',
]

export async function validateBuiltArtifact(options) {
  const distDir = path.resolve(options.distDir)
  const mode = options.mode
  const expectedFixtureFiles = new Set(options.expectedFixtureFiles ?? [])
  if (mode !== 'production' && mode !== 'e2e') {
    throw new Error('Built artifact mode must be production or e2e.')
  }

  const details = await stat(distDir)
  if (!details.isDirectory()) throw new Error(`Build output is not a directory: ${distDir}`)
  const files = await listRegularFiles(distDir)
  if (!files.includes('index.html')) throw new Error('Build output is missing index.html.')

  const fixtureFiles = files.filter((file) => file.startsWith('fixtures/'))
  const failures = []
  if (mode === 'production') {
    if (fixtureFiles.length > 0) {
      failures.push(`production artifact contains fixture files: ${fixtureFiles.join(', ')}`)
    }
    for (const file of files) {
      if (!TEXT_EXTENSIONS.has(path.extname(file))) continue
      const source = await readFile(path.join(distDir, file), 'utf8')
      for (const marker of PRODUCTION_FORBIDDEN_MARKERS) {
        if (source.includes(marker)) failures.push(`${file} contains forbidden marker ${marker}`)
      }
    }
  } else {
    const actual = new Set(fixtureFiles)
    for (const file of actual) {
      if (!expectedFixtureFiles.has(file)) failures.push(`E2E artifact contains unregistered fixture ${file}`)
    }
    for (const file of expectedFixtureFiles) {
      if (!actual.has(file)) failures.push(`E2E artifact is missing registered fixture ${file}`)
    }
  }

  if (failures.length > 0) {
    throw new Error(`Production boundary validation failed:\n- ${failures.join('\n- ')}`)
  }
  return {
    fileCount: files.length,
    fixtureFileCount: fixtureFiles.length,
    mode,
  }
}

async function listRegularFiles(rootDir) {
  const files = []

  async function visit(directory, prefix) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath)
      } else if (entry.isFile()) {
        files.push(relativePath)
      } else {
        throw new Error(`Build output contains unsupported filesystem entry: ${relativePath}`)
      }
    }
  }

  await visit(rootDir, '')
  return files.sort()
}
