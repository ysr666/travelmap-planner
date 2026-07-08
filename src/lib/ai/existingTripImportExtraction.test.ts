import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
  extractExistingTripImportSources,
  type ExistingTripImportOcrAdapter,
  type ExistingTripImportPdfAdapter,
} from './existingTripImportExtraction'

describe('extractExistingTripImportSources', () => {
  it('extracts pasted text and text files locally', async () => {
    const file = new File(['2026-04-01 10:00 西湖'], 'order.txt', { type: 'text/plain' })

    const result = await extractExistingTripImportSources({
      files: [file],
      pastedText: '备注：带身份证',
    })

    expect(result.sources).toHaveLength(2)
    expect(result.sources[0]).toMatchObject({ id: 'source:pasted-text', kind: 'pasted_text' })
    expect(result.sources[1]).toMatchObject({ fileName: 'order.txt', kind: 'text_file' })
    expect(result.filesBySourceId.get('source:file:1')).toMatchObject({ fileName: 'order.txt' })
  })

  it('strips HTML tags before building a source', async () => {
    const file = new File(['<html><body><h1>酒店确认</h1><script>secret()</script><p>入住 15:00</p></body></html>'], 'hotel.html', { type: 'text/html' })

    const result = await extractExistingTripImportSources({ files: [file] })

    expect(result.sources[0].text).toContain('酒店确认')
    expect(result.sources[0].text).toContain('入住 15:00')
    expect(result.sources[0].text).not.toContain('<h1>')
    expect(result.sources[0].text).not.toContain('secret')
  })

  it('extracts readable rows from xlsx files', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="汇算" sheetId="1" r:id="rId1"/></sheets></workbook>')
    zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
    zip.file('xl/sharedStrings.xml', '<sst><si><t>门票</t></si><si><t>爱丁堡城堡</t></si><si><t>£38</t></si></sst>')
    zip.file('xl/worksheets/sheet1.xml', '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c><c t="s"><v>2</v></c></row></sheetData></worksheet>')
    const blob = await zip.generateAsync({ type: 'blob' })
    const file = new File([blob], 'budget.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

    const result = await extractExistingTripImportSources({ files: [file] })

    expect(result.sources[0]).toMatchObject({ kind: 'spreadsheet', fileName: 'budget.xlsx' })
    expect(result.sources[0].text).toContain('工作表：汇算')
    expect(result.sources[0].text).toContain('门票 | 爱丁堡城堡 | £38')
  })

  it('uses the PDF adapter and preserves warnings without OCR in the test path', async () => {
    const pdfAdapter: ExistingTripImportPdfAdapter = vi.fn(async () => ({
      pageCount: 2,
      text: 'PDF 文本层内容',
      warnings: ['PDF 共 10 页，本次默认只处理前 8 页。'],
    }))
    const file = new File(['%PDF'], 'order.pdf', { type: 'application/pdf' })

    const result = await extractExistingTripImportSources({ files: [file], pdfAdapter })

    expect(pdfAdapter).toHaveBeenCalledWith(expect.objectContaining({
      file,
      languages: DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
      maxPages: 8,
    }))
    expect(result.sources[0]).toMatchObject({
      kind: 'pdf',
      text: 'PDF 文本层内容',
      warnings: ['PDF 共 10 页，本次默认只处理前 8 页。'],
    })
  })

  it('uses OCR adapter for images only after explicit extraction action', async () => {
    const ocrAdapter: ExistingTripImportOcrAdapter = vi.fn(async () => '图片 OCR 文本')
    const file = new File(['img'], 'ticket.png', { type: 'image/png' })

    const result = await extractExistingTripImportSources({ files: [file], ocrAdapter })

    expect(ocrAdapter).toHaveBeenCalledTimes(1)
    expect(ocrAdapter).toHaveBeenCalledWith(expect.objectContaining({
      file,
      languages: DEFAULT_EXISTING_TRIP_IMPORT_OCR_LANGUAGES,
      sourceId: 'source:file:1',
    }))
    expect(result.sources[0]).toMatchObject({ kind: 'image', text: '图片 OCR 文本' })
  })

  it('enforces file count and size limits', async () => {
    const files = [
      new File(['a'], 'a.txt', { type: 'text/plain' }),
      new File(['b'], 'b.txt', { type: 'text/plain' }),
    ]

    const result = await extractExistingTripImportSources({
      files,
      maxFileCount: 1,
      maxFileSizeBytes: 1,
    })

    expect(result.sources).toHaveLength(1)
    expect(result.warnings.join('\n')).toContain('最多处理 1 个文件')
  })
})
