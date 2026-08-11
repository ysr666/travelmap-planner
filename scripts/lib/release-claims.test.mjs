import { describe, expect, it } from 'vitest'
import { validateReleaseClaimDocuments } from './release-claims.mjs'

const validDocuments = {
  'design-qa.md': 'Visual Current\n产品级交付：not complete\ndocs/PRODUCT_GRADE_DELIVERY_PLAN.md',
  'docs/PROJECT_STATUS.md': 'Limited Beta Current\nPRODUCT_GRADE_DELIVERY_PLAN.md',
  'docs/ROADMAP_V5.md': 'Visual Current / Product Partial\nPRODUCT_GRADE_DELIVERY_PLAN.md',
  'docs/UI_V3_PRODUCT_FIDELITY_BASELINE.md': 'Visual Current\n产品内容接入仍为 Partial\nPRODUCT_GRADE_DELIVERY_PLAN.md',
  'docs/UI_V3_PRODUCT_FIDELITY_PLAN.md': 'Visual Current\n生产内容接入仍为 Partial\nPRODUCT_GRADE_DELIVERY_PLAN.md',
}

describe('release claim boundaries', () => {
  it('accepts aligned Limited Beta and visual-current claims', () => {
    expect(validateReleaseClaimDocuments({
      documents: validDocuments,
      productStatus: 'limited_beta',
    })).toEqual({ documentCount: 5 })
  })

  it('rejects a missing product-grade source of truth', () => {
    const documents = { ...validDocuments, 'docs/PROJECT_STATUS.md': 'Limited Beta Current' }

    expect(() => validateReleaseClaimDocuments({ documents, productStatus: 'limited_beta' }))
      .toThrow('missing required claim boundary')
  })

  it('rejects obsolete visual receipts that claim whole-product completion', () => {
    const documents = {
      ...validDocuments,
      'design-qa.md': `${validDocuments['design-qa.md']}\n状态：**Production Current; passed**`,
    }

    expect(() => validateReleaseClaimDocuments({ documents, productStatus: 'limited_beta' }))
      .toThrow('obsolete full-completion claim')
  })
})
