import { useMemo, useState } from 'react'
import {
  buildAiTripDraftRequest,
  calculateEndDateFromDayCount,
  validateAiTripDraftRequest,
  type AiTripDraftRequest,
  type AiTripDraftRequestValidationError,
} from '../lib/ai/aiTripDraftRequest'
import type { TravelPace, TravelTransportPreference } from '../lib/travelProfile'

const DEFAULT_DAY_COUNT = '3'
const DEFAULT_PARTY_SIZE = '2'

type AiDraftRequestFormOptions = {
  initialPace: TravelPace
  initialTransport: TravelTransportPreference
}

export function useAiDraftRequestFormState({
  initialPace,
  initialTransport,
}: AiDraftRequestFormOptions) {
  const [requestDestination, setRequestDestination] = useState('')
  const [requestStartDate, setRequestStartDate] = useState('')
  const [requestDayCount, setRequestDayCount] = useState(DEFAULT_DAY_COUNT)
  const [requestPartySize, setRequestPartySize] = useState(DEFAULT_PARTY_SIZE)
  const [requestPace, setRequestPace] = useState(initialPace)
  const [requestPreferTransport, setRequestPreferTransport] = useState(initialTransport)
  const [requestInterestTags, setRequestInterestTags] = useState<string[]>([])
  const [requestInterestText, setRequestInterestText] = useState('')
  const [requestMustVisit, setRequestMustVisit] = useState('')
  const [requestAvoid, setRequestAvoid] = useState('')
  const [requestFreeText, setRequestFreeText] = useState('')
  const [requestErrors, setRequestErrors] = useState<AiTripDraftRequestValidationError[]>([])
  const requestEndDate = useMemo(
    () => calculateEndDateFromDayCount(requestStartDate, Number(requestDayCount)),
    [requestDayCount, requestStartDate],
  )

  function validateRequest(mealTimeProtection: boolean): AiTripDraftRequest | null {
    const built = buildAiTripDraftRequest(
      {
        avoidText: requestAvoid,
        dayCount: requestDayCount,
        destination: requestDestination,
        endDate: requestEndDate,
        freeTextRequirement: requestFreeText,
        interestTags: requestInterestTags,
        interestText: requestInterestText,
        mealTimeProtection,
        mustVisitText: requestMustVisit,
        pace: requestPace,
        partySize: requestPartySize,
        preferTransport: requestPreferTransport,
        startDate: requestStartDate,
      },
      { pace: initialPace, preferTransport: initialTransport },
    )
    const validation = validateAiTripDraftRequest(built)
    setRequestErrors(validation.errors)
    return validation.valid && validation.request ? validation.request : null
  }

  return {
    requestAvoid,
    requestDayCount,
    requestDestination,
    requestEndDate,
    requestErrors,
    requestFreeText,
    requestInterestTags,
    requestInterestText,
    requestMustVisit,
    requestPace,
    requestPartySize,
    requestPreferTransport,
    requestStartDate,
    setRequestAvoid,
    setRequestDayCount,
    setRequestDestination,
    setRequestErrors,
    setRequestFreeText,
    setRequestInterestTags,
    setRequestInterestText,
    setRequestMustVisit,
    setRequestPace,
    setRequestPartySize,
    setRequestPreferTransport,
    setRequestStartDate,
    validateRequest,
  }
}

export type AiDraftRequestFormState = ReturnType<typeof useAiDraftRequestFormState>
