import {
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  extractExistingTripImportSources,
  type ExistingTripImportOcrLanguage,
} from './ai/existingTripImportExtraction'

export type SensitiveDocumentCandidate = {
  field: 'documentNumber' | 'validFrom' | 'validUntil'
  value: string
  confidence: 'low' | 'medium'
}

export type SensitiveDocumentOcrPreview = {
  candidates: SensitiveDocumentCandidate[]
  extractedText: string
  warnings: string[]
}

export async function extractSensitiveDocumentPreview(
  file: File,
  languages: ExistingTripImportOcrLanguage[] = [...DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES],
): Promise<SensitiveDocumentOcrPreview> {
  const extraction = await extractExistingTripImportSources({ files: [file], languages })
  const extractedText = extraction.sources.map((source) => source.text).filter(Boolean).join('\n\n')
  return {
    candidates: inferCandidates(extractedText),
    extractedText,
    warnings: [
      ...extraction.warnings,
      '敏感证件仅在本机识别；识别结果可能有误，保存前请对照原件。',
    ],
  }
}

function inferCandidates(text: string): SensitiveDocumentCandidate[] {
  const candidates: SensitiveDocumentCandidate[] = []
  const dateMatches = [...text.matchAll(/\b(20\d{2})[./-](0?[1-9]|1[0-2])[./-]([0-2]?\d|3[01])\b/g)]
    .map((match) => `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`)
  if (dateMatches[0]) candidates.push({ confidence: 'low', field: 'validFrom', value: dateMatches[0] })
  if (dateMatches[1]) candidates.push({ confidence: 'low', field: 'validUntil', value: dateMatches[1] })
  const labeledNumber = /(?:passport|visa|document|证件|护照|签证)\s*(?:no\.?|number|号码)?\s*[:：]?\s*([A-Z0-9]{6,16})/i.exec(text)
  if (labeledNumber?.[1]) candidates.push({ confidence: 'medium', field: 'documentNumber', value: labeledNumber[1].toUpperCase() })
  return candidates
}
