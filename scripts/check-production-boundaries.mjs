import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateBuiltArtifact } from './lib/production-boundaries.mjs'

const rootDir = fileURLToPath(new URL('..', import.meta.url))
const distDir = path.resolve(rootDir, process.argv[2] ?? 'dist')
const e2eMode = process.env.VITE_E2E_AUTH_BYPASS === '1'
const expectedFixtureFiles = e2eMode ? await readExpectedFixtureFiles() : []
const result = await validateBuiltArtifact({
  distDir,
  expectedFixtureFiles,
  mode: e2eMode ? 'e2e' : 'production',
})

console.log(
  `Production boundary passed: mode=${result.mode}, files=${result.fileCount}, `
  + `fixtureFiles=${result.fixtureFileCount}.`,
)

async function readExpectedFixtureFiles() {
  const manifestPath = fileURLToPath(
    new URL('../e2e/assets/product-fidelity/assets.json', import.meta.url),
  )
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  return manifest.assets
    .filter((asset) => asset.kind !== 'brand_mark')
    .map((asset) => asset.renderRef.replace(/^\//, ''))
}
