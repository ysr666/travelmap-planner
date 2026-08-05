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

  it('normalizes codes, terminals, platforms, and private fields with evidence', () => {
    const preview = buildTransportImportPreview([
      'Flight CA849',
      '上海浦东国际机场 (PVG) → 伦敦希思罗机场 (LHR)',
      '2026-08-12 11:35',
      '2026-08-12 17:35',
      '出发航站楼: T2',
      '到达航站楼: T3',
      'PNR: CA849P',
      '订单号: ETKT-4720-CA849',
      '座位: 45A',
    ].join('\n'))

    expect(preview).toMatchObject({
      arrivalCode: 'LHR',
      arrivalTerminal: 'T3',
      departureCode: 'PVG',
      departureTerminal: 'T2',
      privateFields: { orderNumber: 'ETKT-4720-CA849', pnr: 'CA849P', seat: '45A' },
      providerCode: 'CA',
      serviceNumber: 'CA849',
    })
    expect(preview.fieldEvidence.serviceNumber).toMatchObject({ confidence: 'high', sourceType: 'local_import' })
    expect(preview.fieldEvidence.providerCode).toMatchObject({ confidence: 'medium', sourceType: 'local_import' })
    expect(JSON.stringify(preview.fieldEvidence)).not.toContain('CA849P')
    expect(JSON.stringify(preview.fieldEvidence)).not.toContain('ETKT-4720-CA849')
  })

  it('keeps train seat data private and station metadata public', () => {
    const preview = buildTransportImportPreview([
      'Train 1S23',
      "London King's Cross (KGX) → Edinburgh Waverley (EDB)",
      '2026-08-13 17:00',
      '2026-08-13 21:30',
      'Platform: 5',
      'Arrival Platform: 11',
      'Seat: 45A',
    ].join('\n'))

    expect(preview).toMatchObject({
      arrivalCode: 'EDB',
      arrivalPlatform: '11',
      departureCode: 'KGX',
      departurePlatform: '5',
      kind: 'train',
      privateFields: { seat: '45A' },
    })
  })
})
