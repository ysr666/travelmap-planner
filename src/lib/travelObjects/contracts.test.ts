import { describe, expect, it } from 'vitest'
import {
  normalizeTicketStructuredFieldsV1,
  validateInsurancePolicyV1,
  validateLodgingReservationV1,
} from './contracts'

const source = { confidence: 'high', sourceId: 'ticket_source', sourceType: 'ticket' }

describe('travel object contracts', () => {
  it('accepts safe ticket display fields with per-field evidence', () => {
    expect(normalizeTicketStructuredFieldsV1({
      entryTime: '09:00',
      fieldEvidence: {
        entryTime: source,
        serviceDate: source,
      },
      previewMediaAssetId: 'media_ticket_thumb_v1',
      schemaVersion: 1,
      serviceDate: '2026-08-13',
      status: 'ready',
    })).toMatchObject({
      entryTime: '09:00',
      serviceDate: '2026-08-13',
      status: 'ready',
    })
  })

  it.each([
    { documentNumber: 'SECRET-123', schemaVersion: 1 },
    { schemaVersion: 1, seat: '45A' },
    { schemaVersion: 1, token: 'secret' },
    { schemaVersion: 1, serviceDate: '13/08/2026' },
    { entryTime: '25:00', schemaVersion: 1 },
    { previewMediaAssetId: 'https://evil.example/image.jpg', schemaVersion: 1 },
    { fieldEvidence: { serviceDate: { ...source, authorization: 'Bearer secret' } }, schemaVersion: 1 },
  ])('rejects unsafe or malformed ticket fields %#', (input) => {
    expect(normalizeTicketStructuredFieldsV1(input)).toBeUndefined()
  })

  it('validates lodging and insurance inputs while retaining private display fields', () => {
    expect(validateLodgingReservationV1({
      address: '5 Curzon Street, London W1J 5HE',
      checkInDate: '2026-08-12',
      checkInTime: '15:00',
      checkOutDate: '2026-08-15',
      checkOutTime: '11:00',
      confirmationNumber: 'WMH-0812-3N',
      id: 'lodging_london',
      mediaAssetId: 'media_hotel_room_thumb_v1',
      name: 'Washington Mayfair Hotel',
      nightCount: 3,
      schemaVersion: 1,
      source,
      status: 'confirmed',
      ticketId: 'ticket_hotel',
      tripId: 'trip_uk',
    })).toMatchObject({ confirmationNumber: 'WMH-0812-3N', nightCount: 3 })

    expect(validateInsurancePolicyV1({
      effectiveFrom: '2026-08-12T00:00:00+08:00',
      effectiveTo: '2026-08-23T23:59:59+08:00',
      id: 'insurance_allianz',
      policyNumber: 'AWTI2608123456',
      productName: '尊享计划',
      providerCode: 'ALLIANZ',
      providerName: '安联境外旅行保险',
      schemaVersion: 1,
      source,
      status: 'active',
      ticketId: 'ticket_policy',
      tripId: 'trip_uk',
    })).toMatchObject({ policyNumber: 'AWTI2608123456', providerCode: 'ALLIANZ' })
  })

  it('rejects inconsistent dates and unknown fields', () => {
    expect(validateLodgingReservationV1({
      checkInDate: '2026-08-15',
      checkOutDate: '2026-08-12',
      id: 'lodging_bad',
      name: 'Bad lodging',
      nightCount: 3,
      schemaVersion: 1,
      source,
      status: 'confirmed',
      tripId: 'trip_uk',
    })).toBeNull()
    expect(validateInsurancePolicyV1({
      databaseWrite: 'vault.put',
      effectiveFrom: '2026-08-12T00:00:00Z',
      effectiveTo: '2026-08-23T00:00:00Z',
      id: 'insurance_bad',
      providerName: 'Bad',
      schemaVersion: 1,
      source,
      status: 'active',
      tripId: 'trip_uk',
    })).toBeNull()
  })
})
