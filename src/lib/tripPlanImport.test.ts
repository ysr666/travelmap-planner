import { describe, expect, it } from 'vitest'
import {
  buildTripPlanRecords,
  inferMimeType,
  parseTripPlanFile,
  safeZipPath,
  validateTripPlanPackage,
  type TripPlanAttachment,
  type TripPlanImportPackage,
} from './tripPlanImport'

function basicPackage(): TripPlanImportPackage {
  return {
    days: [
      {
        date: '2026-04-10',
        items: [
          {
            address: '1-6-1 Nishi-Ikebukuro, Toshima City, Tokyo',
            lat: 35.72918,
            lng: 139.71092,
            startTime: '15:00',
            title: 'Hotel Metropolitan Tokyo 入住',
          },
          {
            lat: 35.65858,
            lng: 139.70204,
            previousTransportDurationMinutes: 25,
            previousTransportMode: 'train',
            title: 'Shibuya Sky',
          },
        ],
        title: '抵达与涩谷',
      },
    ],
    schemaVersion: 1,
    tickets: [
      {
        bindTo: {
          date: '2026-04-10',
          itemTitle: 'Hotel Metropolitan Tokyo 入住',
        },
        referenceLocation: 'iCloud Drive/东京旅行/酒店确认单.pdf',
        storageMode: 'reference',
        title: '酒店确认单位置',
      },
      {
        externalUrl: 'https://example.com/order/123',
        storageMode: 'external',
        title: '订单网页',
      },
    ],
    trip: {
      destination: 'Tokyo, Japan',
      endDate: '2026-04-11',
      startDate: '2026-04-10',
      title: 'AI 测试东京旅行',
    },
    type: 'trip-plan',
  }
}

function validate(pkg: TripPlanImportPackage, sourceKind: 'json' | 'zip' = 'json') {
  return validateTripPlanPackage(pkg, { sourceKind })
}

function makeFile(content: string, name = 'trip-plan.json', type = 'application/json') {
  return new File([content], name, { type })
}

async function makeZipFile(entries: Record<string, string | Blob>, name = 'trip-plan.zip') {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  for (const [path, value] of Object.entries(entries)) {
    zip.file(path, value)
  }
  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], name, { type: 'application/zip' })
}

function makeAttachment(size = 12, fileName = 'ticket.pdf'): TripPlanAttachment {
  const blob = new Blob([new Uint8Array(size)], { type: 'application/pdf' })
  return {
    blob,
    fileName,
    mimeType: 'application/pdf',
    path: `files/${fileName}`,
    size: blob.size,
  }
}

function makeIdFactory() {
  const counts = new Map<string, number>()
  return (prefix: string) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    return `${prefix}_${next}`
  }
}

describe('validateTripPlanPackage', () => {
  it('accepts a valid basic package and summarizes content', () => {
    const result = validate(basicPackage())

    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.summary).toMatchObject({
      daysCount: 1,
      externalTicketCount: 1,
      geocodedItemsCount: 2,
      itemsCount: 2,
      missingCoordinateCount: 0,
      referenceTicketCount: 1,
      ticketCount: 2,
    })
  })

  it('rejects unsupported schema, wrong type, empty title, and invalid dates', () => {
    const pkg = {
      ...basicPackage(),
      schemaVersion: 2,
      trip: { ...basicPackage().trip, endDate: 'bad-date', startDate: '2026-4-1', title: ' ' },
      type: 'wrong',
    } as unknown as TripPlanImportPackage

    const result = validate(pkg)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('不支持的行程包版本'),
        expect.stringContaining('type 必须是 "trip-plan"'),
        'trip.title 不能为空。',
        'trip.startDate 必须是 YYYY-MM-DD。',
        'trip.endDate 必须是 YYYY-MM-DD。',
      ]),
    )
  })

  it('rejects invalid item time, coordinate, transport, and previous duration values', () => {
    const pkg = basicPackage()
    pkg.days[0].items[0] = {
      lat: 91,
      lng: -181,
      previousTransportDurationMinutes: -1,
      previousTransportMode: 'boat' as never,
      startTime: '25:99',
      title: 'Bad item',
      transportMode: 'ship' as never,
    }

    const result = validate(pkg)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('startTime 应为 HH:mm'),
        expect.stringContaining('transportMode 不在允许范围内'),
        expect.stringContaining('previousTransportMode 不在允许范围内'),
        expect.stringContaining('previousTransportDurationMinutes 必须大于或等于 0'),
        expect.stringContaining('lat 必须在 -90 到 90 之间'),
        expect.stringContaining('lng 必须在 -180 到 180 之间'),
      ]),
    )
  })

  it('warns about missing coordinates without blocking import', () => {
    const pkg = basicPackage()
    delete pkg.days[0].items[0].lat
    delete pkg.days[0].items[0].lng

    const result = validate(pkg)

    expect(result.valid).toBe(true)
    expect(result.summary.missingCoordinateCount).toBe(1)
    expect(result.warnings).toEqual([expect.stringContaining('缺少经纬度')])
  })

  it('rejects invalid ticket modes and ticket-specific required fields', () => {
    const pkg = basicPackage()
    pkg.tickets = [
      { storageMode: 'copy', title: 'JSON copy', filePath: 'files/ticket.pdf' },
      { storageMode: 'reference', title: 'Reference without location' },
      { externalUrl: 'ftp://example.com/ticket', storageMode: 'external', title: 'Bad URL' },
      { storageMode: 'other' as never, title: 'Bad mode' },
    ]

    const result = validate(pkg)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining('JSON 单文件不支持 copy 模式票据'),
        expect.stringContaining('referenceLocation 不能为空'),
        expect.stringContaining('externalUrl 必须是 http:// 或 https:// 链接'),
        expect.stringContaining('storageMode 不在允许范围内'),
      ]),
    )
  })

  it('warns for date order mismatch, out-of-range days, and large attachments', () => {
    const pkg = basicPackage()
    pkg.days = [
      { date: '2026-04-12', items: [{ title: 'Out of range' }] },
      { date: '2026-04-10', items: [{ lat: 35, lng: 139, title: 'In range' }] },
    ]
    pkg.tickets = [
      {
        filePath: 'files/large.pdf',
        storageMode: 'copy',
        title: 'Large attachment',
      },
    ]
    const attachment = makeAttachment(20 * 1024 * 1024 + 1, 'large.pdf')
    const attachments = new Map([[attachment.path, attachment]])

    const result = validateTripPlanPackage(pkg, { attachments, sourceKind: 'zip' })

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('超出旅行日期范围'),
        expect.stringContaining('days 数组顺序与日期顺序不一致'),
        expect.stringContaining('附件超过 20MB'),
      ]),
    )
  })
})

describe('zip path and MIME helpers', () => {
  it('accepts only safe files/ paths', () => {
    expect(safeZipPath(' files/ticket.pdf ')).toBe('files/ticket.pdf')
    expect(safeZipPath('files\\ticket.pdf')).toBe('files/ticket.pdf')
    expect(safeZipPath('ticket.pdf')).toBeNull()
    expect(safeZipPath('/files/ticket.pdf')).toBeNull()
    expect(safeZipPath('files/../ticket.pdf')).toBeNull()
    expect(safeZipPath('files//ticket.pdf')).toBeNull()
    expect(safeZipPath('files/./ticket.pdf')).toBeNull()
    expect(safeZipPath('C:\\temp\\ticket.pdf')).toBeNull()
    expect(safeZipPath('files/bad\u0000ticket.pdf')).toBeNull()
  })

  it('infers common MIME types and falls back safely', () => {
    expect(inferMimeType('a.pdf')).toBe('application/pdf')
    expect(inferMimeType('a.png')).toBe('image/png')
    expect(inferMimeType('a.jpg')).toBe('image/jpeg')
    expect(inferMimeType('a.webp')).toBe('image/webp')
    expect(inferMimeType('a.gif')).toBe('image/gif')
    expect(inferMimeType('a.svg')).toBe('image/svg+xml')
    expect(inferMimeType('a.txt')).toBe('text/plain')
    expect(inferMimeType('a.json')).toBe('application/json')
    expect(inferMimeType('a.bin')).toBe('application/octet-stream')
  })
})

describe('parseTripPlanFile', () => {
  it('parses a valid JSON trip plan by content', async () => {
    const parsed = await parseTripPlanFile(makeFile(JSON.stringify(basicPackage()), 'anything.txt'))

    expect(parsed.sourceKind).toBe('json')
    expect(parsed.package.trip.title).toBe('AI 测试东京旅行')
    expect(parsed.validation.valid).toBe(true)
  })

  it('rejects wrong JSON type and malformed JSON', async () => {
    await expect(parseTripPlanFile(makeFile('{"type":"other"}'))).rejects.toThrow('不是旅图 AI 行程包')
    await expect(parseTripPlanFile(makeFile('{bad json'))).rejects.toThrow('无法解析')
  })

  it('parses zip trip plans and reads referenced files only', async () => {
    const pkg = basicPackage()
    pkg.tickets = [
      {
        filePath: 'files/ticket.txt',
        storageMode: 'copy',
        title: 'Copy ticket',
      },
    ]
    const file = await makeZipFile({
      'files/ignored.txt': 'ignored',
      'files/ticket.txt': 'hello',
      'trip-plan.json': JSON.stringify(pkg),
    })

    const parsed = await parseTripPlanFile(file)

    expect(parsed.sourceKind).toBe('zip')
    expect(parsed.attachments.size).toBe(1)
    expect(parsed.attachments.get('files/ticket.txt')?.size).toBe(5)
    expect(parsed.validation.valid).toBe(true)
    expect(parsed.validation.summary.attachmentCount).toBe(1)
  })

  it('rejects backup-shaped zip, mixed zip, missing trip-plan.json, and missing copy files', async () => {
    await expect(
      parseTripPlanFile(await makeZipFile({ 'data/trip.json': '{}', 'manifest.json': '{}' })),
    ).rejects.toThrow('完整备份 zip')

    await expect(
      parseTripPlanFile(await makeZipFile({
        'data/trip.json': '{}',
        'manifest.json': '{}',
        'trip-plan.json': JSON.stringify(basicPackage()),
      })),
    ).rejects.toThrow('同时包含 AI 行程包和完整备份结构')

    await expect(parseTripPlanFile(await makeZipFile({ 'files/a.txt': 'hello' }))).rejects.toThrow('缺少 trip-plan.json')

    const pkg = basicPackage()
    pkg.tickets = [{ filePath: 'files/missing.pdf', storageMode: 'copy', title: 'Missing file' }]
    const parsed = await parseTripPlanFile(await makeZipFile({ 'trip-plan.json': JSON.stringify(pkg) }))
    expect(parsed.validation.valid).toBe(false)
    expect(parsed.validation.errors).toEqual([expect.stringContaining('附件不存在')])
  })
})

describe('buildTripPlanRecords', () => {
  it('builds records with deterministic ids and resolves ticket bindings', () => {
    const pkg = basicPackage()
    pkg.days[0].items.push({
      lat: 35.67,
      lng: 139.7,
      title: 'Hotel Metropolitan Tokyo 入住',
    })
    pkg.tickets = [
      {
        bindTo: { date: '2026-04-10', itemTitle: ' Hotel Metropolitan Tokyo 入住 ' },
        referenceLocation: 'iCloud Drive/hotel.pdf',
        storageMode: 'reference',
        title: 'Hotel reference',
      },
      {
        bindTo: { date: '2026-04-10', itemTitle: 'Missing item' },
        externalUrl: 'https://example.com/order',
        storageMode: 'external',
        title: 'External order',
      },
      {
        fileName: 'bad/name\u0000.pdf',
        filePath: 'files/copy.pdf',
        mimeType: 'application/pdf',
        storageMode: 'copy',
        title: 'Copy ticket',
      },
    ]
    const attachment = makeAttachment(7, 'copy.pdf')
    const records = buildTripPlanRecords(pkg, {
      attachments: new Map([[attachment.path, attachment]]),
      createIdFn: makeIdFactory(),
      now: 12345,
      sourceKind: 'zip',
    })

    expect(records.trip).toMatchObject({ id: 'trip_1', title: 'AI 测试东京旅行' })
    expect(records.days.map((day) => day.sortOrder)).toEqual([1])
    expect(records.itineraryItems.map((item) => item.sortOrder)).toEqual([1, 2, 3])
    expect(records.ticketMetas).toHaveLength(3)
    expect(records.ticketBlobs).toHaveLength(1)
    expect(records.ticketMetas[0]).toMatchObject({
      id: 'ticket_1',
      itemId: 'item_1',
      scope: 'item',
      storageMode: 'reference',
    })
    expect(records.itineraryItems[0].ticketIds).toContain('ticket_1')
    expect(records.ticketMetas[1]).toMatchObject({ scope: 'unassigned', storageMode: 'external' })
    expect(records.ticketMetas[2]).toMatchObject({
      fileName: 'bad_name_.pdf',
      fileType: 'pdf',
      mimeType: 'application/pdf',
      storageMode: 'copy',
    })
    expect(records.ticketBlobs[0]).toMatchObject({ ticketId: 'ticket_3' })
    expect(records.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('匹配到多个同名行程点'),
        expect.stringContaining('未找到可绑定的行程点'),
      ]),
    )
  })
})
