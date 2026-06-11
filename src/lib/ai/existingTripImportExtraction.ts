import { parseTripPlanFile } from '../tripPlanImport'
import type { ExistingTripImportApplyFile, ExistingTripImportSourceKind, ExistingTripImportSourceSummary } from './existingTripImport'

export type ExistingTripImportOcrLanguage =
  | 'chi_sim'
  | 'chi_tra'
  | 'eng'
  | 'jpn'
  | 'kor'
  | 'tha'
  | 'spa'
  | 'por'
  | 'rus'
  | 'fra'
  | 'ara'

export type ExistingTripImportExtractionProgress = {
  fileName?: string
  message: string
  sourceId?: string
  stage: 'text' | 'pdf' | 'ocr' | 'trip_plan' | 'warning'
}

export type ExistingTripImportOcrAdapter = (input: {
  file?: File
  image?: Blob
  languages: ExistingTripImportOcrLanguage[]
  sourceId: string
}) => Promise<string>

export type ExistingTripImportPdfAdapter = (input: {
  file: File
  languages: ExistingTripImportOcrLanguage[]
  maxPages: number
  minTextCharsPerPage: number
  ocr: ExistingTripImportOcrAdapter
  onProgress?: (progress: ExistingTripImportExtractionProgress) => void
  sourceId: string
}) => Promise<{ pageCount?: number; text: string; warnings: string[] }>

export type ExistingTripImportExtractionOptions = {
  files?: File[]
  languages?: ExistingTripImportOcrLanguage[]
  maxFileCount?: number
  maxFileSizeBytes?: number
  maxPdfPages?: number
  minPdfTextCharsPerPage?: number
  ocrAdapter?: ExistingTripImportOcrAdapter
  onProgress?: (progress: ExistingTripImportExtractionProgress) => void
  pastedText?: string
  pdfAdapter?: ExistingTripImportPdfAdapter
}

export type ExistingTripImportExtractionResult = {
  filesBySourceId: Map<string, ExistingTripImportApplyFile>
  sources: ExistingTripImportSourceSummary[]
  warnings: string[]
}

export const DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES: ExistingTripImportOcrLanguage[] = ['chi_sim', 'chi_tra', 'eng']
export const OPTIONAL_EXISTING_TRIP_IMPORT_OCR_LANGUAGES: ExistingTripImportOcrLanguage[] = ['jpn', 'kor', 'tha', 'spa', 'por', 'rus', 'fra', 'ara']
export const EXISTING_TRIP_IMPORT_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const EXISTING_TRIP_IMPORT_MAX_FILE_COUNT = 8
export const EXISTING_TRIP_IMPORT_MAX_PDF_PAGES = 8
const MIN_PDF_TEXT_CHARS_PER_PAGE = 40
const MAX_SOURCE_TEXT_LENGTH = 12_000

const SUPPORTED_TEXT_EXTENSIONS = /\.(txt|eml|html?|json)$/i

export async function extractExistingTripImportSources({
  files = [],
  languages = DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  maxFileCount = EXISTING_TRIP_IMPORT_MAX_FILE_COUNT,
  maxFileSizeBytes = EXISTING_TRIP_IMPORT_MAX_FILE_SIZE_BYTES,
  maxPdfPages = EXISTING_TRIP_IMPORT_MAX_PDF_PAGES,
  minPdfTextCharsPerPage = MIN_PDF_TEXT_CHARS_PER_PAGE,
  ocrAdapter = defaultOcrAdapter,
  onProgress,
  pastedText,
  pdfAdapter = defaultPdfAdapter,
}: ExistingTripImportExtractionOptions): Promise<ExistingTripImportExtractionResult> {
  const sources: ExistingTripImportSourceSummary[] = []
  const warnings: string[] = []
  const filesBySourceId = new Map<string, ExistingTripImportApplyFile>()

  const pasted = normalizeExtractedText(pastedText)
  if (pasted) {
    sources.push({
      id: 'source:pasted-text',
      kind: 'pasted_text',
      label: '粘贴文本',
      text: clampSourceText(pasted),
    })
  }

  const selectedFiles = files.slice(0, maxFileCount)
  if (files.length > maxFileCount) {
    warnings.push(`最多处理 ${maxFileCount} 个文件，已跳过 ${files.length - maxFileCount} 个文件。`)
  }

  for (const [index, file] of selectedFiles.entries()) {
    const sourceId = `source:file:${index + 1}`
    if (file.size > maxFileSizeBytes) {
      warnings.push(`${file.name} 超过 20MB，已跳过。`)
      continue
    }
    const baseSource = {
      fileName: file.name,
      label: file.name,
      mimeType: file.type || inferMimeType(file.name),
      size: file.size,
    }
    try {
      const kind = inferSourceKind(file)
      let text = ''
      let sourceWarnings: string[] = []
      if (kind === 'text_file' || kind === 'email' || kind === 'html') {
        onProgress?.({ fileName: file.name, message: '读取文本内容', sourceId, stage: 'text' })
        text = await file.text()
        if (kind === 'html') text = extractHtmlText(text)
      } else if (kind === 'trip_plan') {
        onProgress?.({ fileName: file.name, message: '解析行程包摘要', sourceId, stage: 'trip_plan' })
        const parsed = await parseTripPlanFile(file)
        text = summarizeTripPlanPackage(parsed.package)
        for (const attachment of parsed.attachments.values()) {
          filesBySourceId.set(`${sourceId}:${attachment.path}`, {
            blob: attachment.blob,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })
        }
        sourceWarnings = [...parsed.validation.warnings]
      } else if (kind === 'pdf') {
        onProgress?.({ fileName: file.name, message: '读取 PDF 文本层', sourceId, stage: 'pdf' })
        const pdfResult = await pdfAdapter({
          file,
          languages,
          maxPages: maxPdfPages,
          minTextCharsPerPage: minPdfTextCharsPerPage,
          ocr: ocrAdapter,
          onProgress,
          sourceId,
        })
        text = pdfResult.text
        sourceWarnings = pdfResult.warnings
      } else if (kind === 'image') {
        onProgress?.({ fileName: file.name, message: '本地 OCR 识别图片', sourceId, stage: 'ocr' })
        text = await ocrAdapter({ file, languages, sourceId })
      } else {
        text = await file.text().catch(() => '')
        sourceWarnings.push('文件类型无法完全识别，已按文本尝试读取。')
      }

      const normalized = normalizeExtractedText(text)
      if (!normalized) {
        warnings.push(`${file.name} 未提取到可识别文本。`)
      } else {
        sources.push({
          ...baseSource,
          id: sourceId,
          kind,
          text: clampSourceText(normalized),
          warnings: sourceWarnings.length ? sourceWarnings : undefined,
        })
      }
      filesBySourceId.set(sourceId, {
        blob: file,
        fileName: file.name,
        mimeType: file.type || inferMimeType(file.name),
        size: file.size,
      })
    } catch (caught) {
      warnings.push(`${file.name} 提取失败：${caught instanceof Error ? caught.message : '未知错误'}`)
    }
  }

  if (!sources.length) {
    warnings.push('没有可发送给 AI 识别的文本。')
  }

  return { filesBySourceId, sources, warnings }
}

export async function defaultPdfAdapter({
  file,
  languages,
  maxPages,
  minTextCharsPerPage,
  ocr,
  onProgress,
  sourceId,
}: Parameters<ExistingTripImportPdfAdapter>[0]): Promise<{ pageCount?: number; text: string; warnings: string[] }> {
  const pdfjs = await import('pdfjs-dist')
  const workerModule = await import('pdfjs-dist/build/pdf.worker.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const processedPages = Math.min(pageCount, maxPages)
  const warnings: string[] = []
  if (pageCount > maxPages) {
    warnings.push(`PDF 共 ${pageCount} 页，本次默认只处理前 ${maxPages} 页。`)
  }
  const pageTexts: string[] = []
  for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const textLayer = content.items
      .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
      .join(' ')
      .trim()
    if (textLayer.length >= minTextCharsPerPage) {
      pageTexts.push(textLayer)
      continue
    }
    onProgress?.({ fileName: file.name, message: `第 ${pageNumber} 页文本不足，使用本地 OCR`, sourceId, stage: 'ocr' })
    const viewport = page.getViewport({ scale: 1.6 })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d')
    if (!context) {
      warnings.push(`第 ${pageNumber} 页无法创建 OCR 画布，已跳过。`)
      continue
    }
    await page.render({ canvas, viewport }).promise
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) {
      warnings.push(`第 ${pageNumber} 页无法生成 OCR 图片，已跳过。`)
      continue
    }
    pageTexts.push(await ocr({ image: blob, languages, sourceId }))
  }
  return { pageCount, text: normalizeExtractedText(pageTexts.join('\n\n')), warnings }
}

export async function defaultOcrAdapter({
  file,
  image,
  languages,
}: Parameters<ExistingTripImportOcrAdapter>[0]): Promise<string> {
  const tesseract = await import('tesseract.js')
  const workerModule = await import('tesseract.js/dist/worker.min.js?url')
  const selectedLanguages = normalizeOcrLanguages(languages)
  const langSpecs = await Promise.all(selectedLanguages.map(loadOcrLanguage))
  const worker = await tesseract.createWorker(langSpecs, undefined, {
    cacheMethod: 'write',
    gzip: true,
    workerPath: workerModule.default,
    workerBlobURL: true,
  })
  try {
    const result = await worker.recognize(image ?? file!)
    return normalizeExtractedText(result.data.text)
  } finally {
    await worker.terminate()
  }
}

async function loadOcrLanguage(language: ExistingTripImportOcrLanguage): Promise<{ code: string; data: Uint8Array }> {
  const url = await resolveDefaultOcrLanguageUrl(language)
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`OCR 语言资源 ${language} 下载失败。`)
  }
  return { code: language, data: new Uint8Array(await response.arrayBuffer()) }
}

async function resolveDefaultOcrLanguageUrl(language: ExistingTripImportOcrLanguage) {
  if (language === 'eng') {
    return (await import('@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz?url')).default
  }
  if (language === 'chi_sim') {
    return (await import('@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz?url')).default
  }
  if (language === 'chi_tra') {
    return (await import('@tesseract.js-data/chi_tra/4.0.0_best_int/chi_tra.traineddata.gz?url')).default
  }
  return `https://tessdata.projectnaptha.com/4.0.0_fast/${language}.traineddata.gz`
}

export function buildExistingTripImportRequestSources(sources: ExistingTripImportSourceSummary[]) {
  return sources.slice(0, 12).map((source) => ({
    fileName: source.fileName,
    id: source.id,
    kind: source.kind,
    label: source.label,
    mimeType: source.mimeType,
    size: source.size,
    text: clampSourceText(source.text, 4_000),
    warnings: source.warnings?.slice(0, 5),
  }))
}

function inferSourceKind(file: File): ExistingTripImportSourceKind {
  const name = file.name.toLowerCase()
  const mime = file.type.toLowerCase()
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (name.endsWith('.zip')) return 'trip_plan'
  if (name.endsWith('.json')) return 'trip_plan'
  if (mime.includes('html') || /\.html?$/i.test(name)) return 'html'
  if (/\.eml$/i.test(name) || mime.includes('message/rfc822')) return 'email'
  if (SUPPORTED_TEXT_EXTENSIONS.test(name) || mime.startsWith('text/')) return 'text_file'
  return 'ticket_file'
}

function inferMimeType(fileName: string) {
  const lowerName = fileName.toLowerCase()
  if (lowerName.endsWith('.pdf')) return 'application/pdf'
  if (lowerName.endsWith('.json')) return 'application/json'
  if (lowerName.endsWith('.zip')) return 'application/zip'
  if (lowerName.endsWith('.html') || lowerName.endsWith('.htm')) return 'text/html'
  if (lowerName.endsWith('.eml')) return 'message/rfc822'
  if (lowerName.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}

function extractHtmlText(html: string) {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    return doc.body.textContent ?? ''
  }
  return html.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
}

function summarizeTripPlanPackage(pkg: Awaited<ReturnType<typeof parseTripPlanFile>>['package']) {
  const lines = [
    `旅行：${pkg.trip.title}`,
    `目的地：${pkg.trip.destination ?? ''}`,
    `日期：${pkg.trip.startDate} 至 ${pkg.trip.endDate}`,
    pkg.trip.notes ? `备注：${pkg.trip.notes}` : '',
  ]
  for (const day of pkg.days.slice(0, 30)) {
    lines.push(`日期 ${day.date} ${day.title ?? ''}`)
    for (const item of day.items.slice(0, 50)) {
      lines.push([
        item.startTime,
        item.endTime ? `-${item.endTime}` : '',
        item.title,
        item.locationName,
        item.address,
        item.transportMode ? `交通 ${item.transportMode}` : '',
        item.notes ? `备注 ${item.notes}` : '',
      ].filter(Boolean).join(' '))
    }
  }
  for (const ticket of (pkg.tickets ?? []).slice(0, 50)) {
    lines.push(`票据：${ticket.title} ${ticket.fileName ?? ticket.referenceLocation ?? ticket.externalUrl ?? ''} ${ticket.note ?? ''}`)
  }
  return lines.filter(Boolean).join('\n')
}

function normalizeExtractedText(value: string | undefined) {
  return (value ?? '')
    .split(String.fromCharCode(0)).join(' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
}

function clampSourceText(value: string, maxLength = MAX_SOURCE_TEXT_LENGTH) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1).trim()}…` : value
}

function normalizeOcrLanguages(languages: ExistingTripImportOcrLanguage[]) {
  const allowed = new Set<ExistingTripImportOcrLanguage>([
    ...DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
    ...OPTIONAL_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  ])
  const unique = Array.from(new Set(languages.filter((language) => allowed.has(language))))
  return unique.length ? unique : DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES
}
