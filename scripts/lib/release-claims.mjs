import { readFile } from 'node:fs/promises'
import path from 'node:path'

const RELEASE_DOCUMENT_REQUIREMENTS = {
  'design-qa.md': [
    'Visual Current',
    '产品级交付：not complete',
    'PRODUCT_GRADE_DELIVERY_PLAN.md',
  ],
  'docs/PROJECT_STATUS.md': [
    'Limited Beta Current',
    'PRODUCT_GRADE_DELIVERY_PLAN.md',
  ],
  'docs/ROADMAP_V5.md': [
    'Visual Current / Product Partial',
    'PRODUCT_GRADE_DELIVERY_PLAN.md',
  ],
  'docs/UI_V3_PRODUCT_FIDELITY_BASELINE.md': [
    'Visual Current',
    '产品内容接入仍为 Partial',
    'PRODUCT_GRADE_DELIVERY_PLAN.md',
  ],
  'docs/UI_V3_PRODUCT_FIDELITY_PLAN.md': [
    'Visual Current',
    '生产内容接入仍为 Partial',
    'PRODUCT_GRADE_DELIVERY_PLAN.md',
  ],
}

const LIMITED_BETA_FORBIDDEN_CLAIMS = [
  '状态：**Production Current; passed**',
  '状态：**Current；P0-P8 已完成并发布到 Production**',
]

export async function validateRepositoryReleaseClaims({ productStatus, rootDir }) {
  const documents = {}
  for (const relativePath of Object.keys(RELEASE_DOCUMENT_REQUIREMENTS)) {
    documents[relativePath] = await readFile(path.join(rootDir, relativePath), 'utf8')
  }
  return validateReleaseClaimDocuments({ documents, productStatus })
}

export function validateReleaseClaimDocuments({ documents, productStatus }) {
  const failures = []
  for (const [relativePath, requirements] of Object.entries(RELEASE_DOCUMENT_REQUIREMENTS)) {
    const source = documents[relativePath]
    if (typeof source !== 'string') {
      failures.push(`missing release document ${relativePath}`)
      continue
    }
    for (const requirement of requirements) {
      if (!source.includes(requirement)) {
        failures.push(`${relativePath} is missing required claim boundary: ${requirement}`)
      }
    }
    if (productStatus === 'limited_beta') {
      for (const forbidden of LIMITED_BETA_FORBIDDEN_CLAIMS) {
        if (source.includes(forbidden)) {
          failures.push(`${relativePath} contains obsolete full-completion claim: ${forbidden}`)
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`Release claim validation failed:\n- ${failures.join('\n- ')}`)
  }
  return { documentCount: Object.keys(RELEASE_DOCUMENT_REQUIREMENTS).length }
}
