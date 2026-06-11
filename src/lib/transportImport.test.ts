import { describe, expect, it, vi } from 'vitest'
import { buildTransportImportPreview, extractTransportImportPreview } from './transportImport'

describe('transport import preview', () => {
  it('extracts a flight without making a network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const preview = await extractTransportImportPreview({
      pastedText: 'Flight BA39\nLondon Heathrow → Beijing Capital\n2026-07-01 16:20\n2026-07-02 09:30',
    })

    expect(preview).toMatchObject({
      arrivalDate: '2026-07-02',
      arrivalTime: '09:30',
      departureDate: '2026-07-01',
      departureTime: '16:20',
      kind: 'flight',
      serviceNumber: 'BA39',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('recognizes common Chinese train numbers', () => {
    const preview = buildTransportImportPreview('火车票 车次 G1234\n上海虹桥 至 北京南\n2026/08/03 08:05')
    expect(preview.kind).toBe('train')
    expect(preview.serviceNumber).toBe('G1234')
    expect(preview.departureDate).toBe('2026-08-03')
  })
})
