export {
  getProviderProxyConfig,
  getProviderProxySessionId,
  PROVIDER_PROXY_DEV_PROVIDER_STORAGE_KEY,
  PROVIDER_PROXY_DEV_URL_STORAGE_KEY,
  PROVIDER_PROXY_SESSION_STORAGE_KEY,
  ProviderProxyClientError,
} from './providerProxyClientShared'
export type {
  ProviderProxyClientOptions,
  ProviderProxyRuntimeConfig,
} from './providerProxyClientShared'

type ProviderProxyClientCore = typeof import('./providerProxyClientCore')

function loadProviderProxyClientCore() {
  return import('./providerProxyClientCore')
}

export const fetchProviderProxyRoutePreview: ProviderProxyClientCore['fetchProviderProxyRoutePreview'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyRoutePreview(...args)
}

export const fetchProviderProxyExchangeRate: ProviderProxyClientCore['fetchProviderProxyExchangeRate'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyExchangeRate(...args)
}

export const fetchProviderProxyAiExpenseExtract: ProviderProxyClientCore['fetchProviderProxyAiExpenseExtract'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiExpenseExtract(...args)
}

export const fetchProviderProxyAiExpenseQuery: ProviderProxyClientCore['fetchProviderProxyAiExpenseQuery'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiExpenseQuery(...args)
}

export const fetchProviderProxyRouteOrderSuggestion: ProviderProxyClientCore['fetchProviderProxyRouteOrderSuggestion'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyRouteOrderSuggestion(...args)
}

export const fetchProviderProxyAiTripDraft: ProviderProxyClientCore['fetchProviderProxyAiTripDraft'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiTripDraft(...args)
}

export const fetchProviderProxyAiTripDraftRepair: ProviderProxyClientCore['fetchProviderProxyAiTripDraftRepair'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiTripDraftRepair(...args)
}

export const fetchProviderProxyAiTripDraftRefine: ProviderProxyClientCore['fetchProviderProxyAiTripDraftRefine'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiTripDraftRefine(...args)
}

export const fetchProviderProxyAiTripEditPlan: ProviderProxyClientCore['fetchProviderProxyAiTripEditPlan'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiTripEditPlan(...args)
}

export const fetchProviderProxyTravelSearch: ProviderProxyClientCore['fetchProviderProxyTravelSearch'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyTravelSearch(...args)
}

export const fetchProviderProxyPlaceLookup: ProviderProxyClientCore['fetchProviderProxyPlaceLookup'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyPlaceLookup(...args)
}

export const fetchProviderProxyPlaceDetails: ProviderProxyClientCore['fetchProviderProxyPlaceDetails'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyPlaceDetails(...args)
}

export const fetchProviderProxyTripContentEnrichment: ProviderProxyClientCore['fetchProviderProxyTripContentEnrichment'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyTripContentEnrichment(...args)
}

export const fetchProviderProxyTripDailyTip: ProviderProxyClientCore['fetchProviderProxyTripDailyTip'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyTripDailyTip(...args)
}

export const fetchProviderProxyTripOperationsSummary: ProviderProxyClientCore['fetchProviderProxyTripOperationsSummary'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyTripOperationsSummary(...args)
}

export const fetchProviderProxyAssistantAnswer: ProviderProxyClientCore['fetchProviderProxyAssistantAnswer'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAssistantAnswer(...args)
}

export const fetchProviderProxyAiActionPlan: ProviderProxyClientCore['fetchProviderProxyAiActionPlan'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyAiActionPlan(...args)
}

export const fetchProviderProxyExistingTripImport: ProviderProxyClientCore['fetchProviderProxyExistingTripImport'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyExistingTripImport(...args)
}

export const fetchProviderProxyTravelInboxClassify: ProviderProxyClientCore['fetchProviderProxyTravelInboxClassify'] = async (...args) => {
  const core = await loadProviderProxyClientCore()
  return core.fetchProviderProxyTravelInboxClassify(...args)
}
