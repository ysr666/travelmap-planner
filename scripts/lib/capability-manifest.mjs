import { stat } from 'node:fs/promises'
import path from 'node:path'

export const CAPABILITY_STATUSES = new Set([
  'current',
  'partial',
  'fixture_only',
  'target',
  'historical',
])

const PRODUCT_STATUSES = new Set(['limited_beta', 'full_product'])
const TOP_LEVEL_FIELDS = [
  'schemaVersion',
  'updatedAt',
  'productStatus',
  'sourcePlan',
  'releaseReceipt',
  'capabilities',
]
const CAPABILITY_FIELDS = [
  'id',
  'title',
  'status',
  'releaseBlocking',
  'productionEnabled',
  'owner',
  'nextPhase',
  'dependencies',
  'evidence',
  'gaps',
  'operations',
]
const EVIDENCE_FIELDS = ['implementation', 'tests', 'receipts']
const OPERATIONS_FIELDS = ['slo', 'alert', 'fallback']

export async function validateCapabilityManifest(manifest, options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd())
  const errors = []

  if (!isRecord(manifest)) {
    throw new Error('Capability manifest must be a JSON object.')
  }

  assertExactFields(manifest, TOP_LEVEL_FIELDS, 'manifest', errors)
  if (manifest.schemaVersion !== 1) errors.push('manifest.schemaVersion must equal 1')
  if (!isIsoDate(manifest.updatedAt)) errors.push('manifest.updatedAt must use YYYY-MM-DD')
  if (!PRODUCT_STATUSES.has(manifest.productStatus)) {
    errors.push('manifest.productStatus must be limited_beta or full_product')
  }

  const rootEvidencePaths = []
  for (const field of ['sourcePlan', 'releaseReceipt']) {
    if (!isNonEmptyString(manifest[field])) {
      errors.push(`manifest.${field} must be a non-empty local path`)
    } else {
      rootEvidencePaths.push({ label: `manifest.${field}`, value: manifest[field] })
    }
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    errors.push('manifest.capabilities must be a non-empty array')
  }

  const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : []
  const ids = new Set()
  const evidencePaths = [...rootEvidencePaths]

  for (const [index, capability] of capabilities.entries()) {
    const label = `manifest.capabilities[${index}]`
    if (!isRecord(capability)) {
      errors.push(`${label} must be an object`)
      continue
    }

    assertExactFields(capability, CAPABILITY_FIELDS, label, errors)
    if (!isNonEmptyString(capability.id) || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(capability.id)) {
      errors.push(`${label}.id must be a stable lowercase dotted identifier`)
    } else if (ids.has(capability.id)) {
      errors.push(`duplicate capability id: ${capability.id}`)
    } else {
      ids.add(capability.id)
    }
    if (!isNonEmptyString(capability.title) || capability.title.length > 120) {
      errors.push(`${label}.title must contain 1-120 characters`)
    }
    if (!CAPABILITY_STATUSES.has(capability.status)) {
      errors.push(`${label}.status is not supported`)
    }
    if (typeof capability.releaseBlocking !== 'boolean') {
      errors.push(`${label}.releaseBlocking must be boolean`)
    }
    if (typeof capability.productionEnabled !== 'boolean') {
      errors.push(`${label}.productionEnabled must be boolean`)
    }
    if (!isNonEmptyString(capability.owner) || !/^[a-z][a-z0-9-]+$/.test(capability.owner)) {
      errors.push(`${label}.owner must be a stable lowercase owner id`)
    }
    if (capability.nextPhase !== null && (
      !isNonEmptyString(capability.nextPhase)
      || !/^P(?:[0-9]|1[0-5])$/.test(capability.nextPhase)
    )) {
      errors.push(`${label}.nextPhase must be null or P0-P15`)
    }

    validateStringArray(capability.dependencies, `${label}.dependencies`, errors)
    validateStringArray(capability.gaps, `${label}.gaps`, errors)

    if (!isRecord(capability.evidence)) {
      errors.push(`${label}.evidence must be an object`)
    } else {
      assertExactFields(capability.evidence, EVIDENCE_FIELDS, `${label}.evidence`, errors)
      for (const field of EVIDENCE_FIELDS) {
        validateStringArray(capability.evidence[field], `${label}.evidence.${field}`, errors)
        if (Array.isArray(capability.evidence[field])) {
          for (const value of capability.evidence[field]) {
            evidencePaths.push({ label: `${label}.evidence.${field}`, value })
          }
        }
      }
    }

    if (!isRecord(capability.operations)) {
      errors.push(`${label}.operations must be an object`)
    } else {
      assertExactFields(capability.operations, OPERATIONS_FIELDS, `${label}.operations`, errors)
      for (const field of OPERATIONS_FIELDS) {
        if (!isNonEmptyString(capability.operations[field])) {
          errors.push(`${label}.operations.${field} must be a non-empty string`)
        }
      }
    }

    enforceStatusContract(capability, label, errors)
  }

  for (const capability of capabilities.filter(isRecord)) {
    for (const dependency of Array.isArray(capability.dependencies) ? capability.dependencies : []) {
      if (dependency === capability.id) errors.push(`${capability.id} cannot depend on itself`)
      if (!ids.has(dependency)) errors.push(`${capability.id} depends on unknown capability ${dependency}`)
    }
  }

  errors.push(...findDependencyCycles(capabilities))

  const releaseBlockers = capabilities.filter(
    (capability) => isRecord(capability) && capability.releaseBlocking === true,
  )
  const incompleteBlockers = releaseBlockers.filter((capability) => capability.status !== 'current')
  if (manifest.productStatus === 'full_product' && incompleteBlockers.length > 0) {
    errors.push(`full_product has incomplete release blockers: ${incompleteBlockers.map((item) => item.id).join(', ')}`)
  }
  if (manifest.productStatus === 'limited_beta' && incompleteBlockers.length === 0) {
    errors.push('limited_beta must retain at least one non-current release blocker')
  }

  await validateEvidencePaths(evidencePaths, rootDir, errors)

  if (errors.length > 0) {
    throw new Error(`Capability manifest validation failed:\n- ${Array.from(new Set(errors)).join('\n- ')}`)
  }

  const statusCounts = Object.fromEntries(
    [...CAPABILITY_STATUSES].map((status) => [
      status,
      capabilities.filter((capability) => capability.status === status).length,
    ]),
  )
  return {
    capabilityCount: capabilities.length,
    incompleteReleaseBlockers: incompleteBlockers.length,
    productStatus: manifest.productStatus,
    statusCounts,
  }
}

function enforceStatusContract(capability, label, errors) {
  const implementation = capability.evidence?.implementation
  const tests = capability.evidence?.tests
  const receipts = capability.evidence?.receipts
  const gaps = capability.gaps

  if (capability.status === 'current') {
    if (capability.productionEnabled !== true) errors.push(`${label}: current capability must be productionEnabled`)
    if (capability.nextPhase !== null) errors.push(`${label}: current capability cannot have nextPhase`)
    if (!Array.isArray(gaps) || gaps.length !== 0) errors.push(`${label}: current capability cannot retain gaps`)
    if (!Array.isArray(implementation) || implementation.length === 0) errors.push(`${label}: current capability needs implementation evidence`)
    if (!Array.isArray(tests) || tests.length === 0) errors.push(`${label}: current capability needs test evidence`)
    if (!Array.isArray(receipts) || receipts.length === 0) errors.push(`${label}: current capability needs a release receipt`)
  }

  if (capability.status === 'partial') {
    if (capability.nextPhase === null) errors.push(`${label}: partial capability needs nextPhase`)
    if (!Array.isArray(gaps) || gaps.length === 0) errors.push(`${label}: partial capability needs explicit gaps`)
    if (!Array.isArray(implementation) || implementation.length === 0) errors.push(`${label}: partial capability needs implementation evidence`)
  }

  if (capability.status === 'target') {
    if (capability.productionEnabled !== false) errors.push(`${label}: target capability cannot be productionEnabled`)
    if (capability.nextPhase === null) errors.push(`${label}: target capability needs nextPhase`)
    if (!Array.isArray(gaps) || gaps.length === 0) errors.push(`${label}: target capability needs explicit gaps`)
  }

  if (capability.status === 'fixture_only') {
    if (capability.productionEnabled !== false) errors.push(`${label}: fixture_only capability cannot be productionEnabled`)
    if (capability.releaseBlocking !== false) errors.push(`${label}: fixture_only capability cannot block release directly`)
    if (capability.nextPhase === null) errors.push(`${label}: fixture_only capability needs a replacement phase`)
    if (!Array.isArray(gaps) || gaps.length === 0) errors.push(`${label}: fixture_only capability needs an explicit boundary`)
  }

  if (capability.status === 'historical') {
    if (capability.productionEnabled !== false) errors.push(`${label}: historical capability cannot be productionEnabled`)
    if (capability.nextPhase !== null) errors.push(`${label}: historical capability cannot have nextPhase`)
  }
}

async function validateEvidencePaths(entries, rootDir, errors) {
  const seen = new Set()
  for (const entry of entries) {
    if (!isNonEmptyString(entry.value) || seen.has(entry.value)) continue
    seen.add(entry.value)
    if (path.isAbsolute(entry.value) || entry.value.split(/[\\/]/).includes('..')) {
      errors.push(`${entry.label} must stay inside the repository: ${entry.value}`)
      continue
    }
    const absolutePath = path.resolve(rootDir, entry.value)
    if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${path.sep}`)) {
      errors.push(`${entry.label} escapes the repository: ${entry.value}`)
      continue
    }
    try {
      const details = await stat(absolutePath)
      if (!details.isFile()) errors.push(`${entry.label} is not a regular file: ${entry.value}`)
    } catch {
      errors.push(`${entry.label} does not exist: ${entry.value}`)
    }
  }
}

function findDependencyCycles(capabilities) {
  const graph = new Map()
  for (const capability of capabilities.filter(isRecord)) {
    if (isNonEmptyString(capability.id)) {
      graph.set(capability.id, Array.isArray(capability.dependencies) ? capability.dependencies : [])
    }
  }
  const visiting = new Set()
  const visited = new Set()
  const errors = []

  function visit(id, trail) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id)
      errors.push(`capability dependency cycle: ${[...trail.slice(start), id].join(' -> ')}`)
      return
    }
    if (visited.has(id)) return
    visiting.add(id)
    for (const dependency of graph.get(id) ?? []) {
      if (graph.has(dependency)) visit(dependency, [...trail, id])
    }
    visiting.delete(id)
    visited.add(id)
  }

  for (const id of graph.keys()) visit(id, [])
  return errors
}

function assertExactFields(value, fields, label, errors) {
  const expected = new Set(fields)
  for (const field of fields) {
    if (!(field in value)) errors.push(`${label} is missing ${field}`)
  }
  for (const field of Object.keys(value)) {
    if (!expected.has(field)) errors.push(`${label} contains unknown field ${field}`)
  }
}

function validateStringArray(value, label, errors) {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`)
    return
  }
  const seen = new Set()
  for (const item of value) {
    if (!isNonEmptyString(item)) {
      errors.push(`${label} must contain only non-empty strings`)
      continue
    }
    if (seen.has(item)) errors.push(`${label} contains duplicate value ${item}`)
    seen.add(item)
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}
