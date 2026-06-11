import PostalMime from 'postal-mime'
import { extractExistingTripImportSources, type ExistingTripImportExtractionResult, type ExistingTripImportOcrLanguage } from './ai/existingTripImportExtraction'

export async function extractTravelInboxBlob({
  blob,
  fileName,
  languages,
  mimeType,
}: {
  blob: Blob
  fileName: string
  languages: ExistingTripImportOcrLanguage[]
  mimeType: string
}): Promise<ExistingTripImportExtractionResult> {
  if (mimeType === 'message/rfc822' || fileName.toLowerCase().endsWith('.eml')) {
    const email = await PostalMime.parse(await blob.arrayBuffer())
    const bodyText = [email.subject, email.text, htmlToText(email.html)].filter(Boolean).join('\n\n')
    const files = email.attachments.slice(0, 8).map((attachment, index) => new File(
      [toAttachmentBlobPart(attachment.content)],
      attachment.filename || `attachment-${index + 1}`,
      { type: attachment.mimeType || 'application/octet-stream' },
    ))
    return extractExistingTripImportSources({ files, languages, pastedText: bodyText })
  }
  return extractExistingTripImportSources({
    files: [new File([blob], fileName, { type: mimeType || blob.type || 'application/octet-stream' })],
    languages,
  })
}

function toAttachmentBlobPart(content: string | ArrayBuffer | Uint8Array) {
  if (typeof content === 'string' || content instanceof ArrayBuffer) return content
  const copy = new Uint8Array(content.byteLength)
  copy.set(content)
  return copy.buffer
}

function htmlToText(html: string | undefined) {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return doc.body.textContent?.replace(/\s+/g, ' ').trim() ?? ''
}
