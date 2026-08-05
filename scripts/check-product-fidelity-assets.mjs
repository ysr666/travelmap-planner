import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const fixtureDirectory = fileURLToPath(new URL('../e2e/assets/product-fidelity/', import.meta.url))
const manifestPath = join(fixtureDirectory, 'assets.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.assets)) {
  throw new Error('Product fidelity media manifest must use schemaVersion 1 and an assets array.')
}

const ids = new Set()
const renderRefs = new Set()

for (const asset of manifest.assets) {
  assertManifestAsset(asset)
  if (ids.has(asset.id)) throw new Error(`Duplicate product fidelity asset id: ${asset.id}`)
  if (renderRefs.has(asset.renderRef)) throw new Error(`Duplicate product fidelity renderRef: ${asset.renderRef}`)
  ids.add(asset.id)
  renderRefs.add(asset.renderRef)

  const fileName = basename(asset.renderRef)
  if (asset.renderRef !== `/fixtures/product-fidelity/${fileName}`) {
    throw new Error(`Asset renderRef escapes the controlled fixture route: ${asset.id}`)
  }

  const filePath = join(fixtureDirectory, fileName)
  const fileStats = await stat(filePath)
  if (!fileStats.isFile()) throw new Error(`Product fidelity asset is not a regular file: ${fileName}`)
  if (fileStats.size !== asset.bytes) {
    throw new Error(`Byte size mismatch for ${fileName}: expected ${asset.bytes}, received ${fileStats.size}`)
  }

  const bytes = await readFile(filePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== asset.sha256) {
    throw new Error(`SHA-256 mismatch for ${fileName}`)
  }

  if (fileName.endsWith('.webp')) {
    const dimensions = readLossyWebpDimensions(bytes)
    if (dimensions.width !== asset.width || dimensions.height !== asset.height) {
      throw new Error(`Dimension mismatch for ${fileName}`)
    }
    const byteBudget = fileName.includes('-hero.') ? 240_000 : 80_000
    if (bytes.length > byteBudget) throw new Error(`${fileName} exceeds its ${byteBudget}-byte budget`)
  } else if (fileName.endsWith('.svg')) {
    if (bytes.length > 20_000) throw new Error(`${fileName} exceeds the 20 KB brand budget`)
    assertBundledSvgIsStatic(bytes.toString('utf8'), fileName)
  } else {
    throw new Error(`Unsupported product fidelity asset type: ${fileName}`)
  }
}

console.log(`Verified ${manifest.assets.length} product fidelity assets.`)

function assertManifestAsset(asset) {
  if (!asset || typeof asset !== 'object') throw new Error('Invalid asset manifest entry.')
  for (const field of ['id', 'kind', 'subject', 'renderRef', 'sha256', 'source', 'sourceUrl', 'license']) {
    if (typeof asset[field] !== 'string' || !asset[field]) {
      throw new Error(`Product fidelity asset is missing ${field}.`)
    }
  }
  if (!Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
    throw new Error(`Product fidelity asset has an invalid byte size: ${asset.id}`)
  }
}

function readLossyWebpDimensions(bytes) {
  if (
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF'
    || bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
    || bytes.subarray(12, 16).toString('ascii') !== 'VP8 '
    || bytes[23] !== 0x9d
    || bytes[24] !== 0x01
    || bytes[25] !== 0x2a
  ) {
    throw new Error('Fixture WebP must use the reviewed lossy VP8 encoding.')
  }
  return {
    width: bytes.readUInt16LE(26) & 0x3fff,
    height: bytes.readUInt16LE(28) & 0x3fff,
  }
}

function assertBundledSvgIsStatic(source, fileName) {
  const prohibited = /<script\b|<foreignObject\b|javascript:|xlink:href\s*=|\bhref\s*=|\bon(?:load|error|click|mouseover)\s*=|url\s*\(/i
  if (prohibited.test(source)) {
    throw new Error(`Bundled brand SVG contains an executable or external reference: ${fileName}`)
  }
}
