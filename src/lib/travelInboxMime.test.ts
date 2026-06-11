import { describe, expect, it } from 'vitest'
import { extractTravelInboxBlob } from './travelInboxMime'

describe('travel inbox MIME extraction', () => {
  it('extracts email subject and body without sending the RFC822 file to AI', async () => {
    const raw = [
      'From: booking@example.com',
      'To: traveler@example.com',
      'Subject: Tokyo Hotel Booking',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Check-in 2026-07-10 in Tokyo. Booking confirmed.',
    ].join('\r\n')
    const result = await extractTravelInboxBlob({ blob: new Blob([raw], { type: 'message/rfc822' }), fileName: 'message.eml', languages: ['eng'], mimeType: 'message/rfc822' })
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].text).toContain('Tokyo Hotel Booking')
    expect(result.sources[0].text).toContain('2026-07-10')
    expect(result.filesBySourceId.size).toBe(0)
  })
})
