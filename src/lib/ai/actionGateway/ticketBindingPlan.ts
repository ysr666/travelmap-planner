import { buildTravelDocumentLinks, type BuildTravelDocumentLinksInput, type TravelDocumentLinkV1 } from '../../documentLinking'
import { getTicketDisplayTitle } from '../../tickets'
import type { AiActionPlanV1 } from './types'
import { AI_ACTION_PLAN_SCHEMA_VERSION } from './types'
import { validateAiActionPlan } from './validation'

export type TicketBindingPlanPreview = {
  conflicts: TravelDocumentLinkV1[]
  links: TravelDocumentLinkV1[]
  plan: AiActionPlanV1 | null
  suggested: TravelDocumentLinkV1[]
}

export function buildSuggestedTicketBindingPlan(
  input: BuildTravelDocumentLinksInput,
): TicketBindingPlanPreview {
  const links = buildTravelDocumentLinks(input)
  const itemById = new Map(input.items.map((item) => [item.id, item]))
  const ticketById = new Map(input.tickets.map((ticket) => [ticket.id, ticket]))
  const ticketTitleCounts = countNormalized(input.tickets.map(getTicketDisplayTitle))
  const itemTitleCounts = countNormalized(input.items.map((item) => item.title))
  const plannedSubjectIds = new Set<string>()
  const suggested = links.filter((link) => {
    if (link.status !== 'suggested' || link.subjectType !== 'item') return false
    const ticket = ticketById.get(link.ticketId)
    const item = itemById.get(link.subjectId)
    if (!ticket || !item || ticket.itemId) return false
    const isUnambiguous = ticketTitleCounts.get(normalizeSemanticName(getTicketDisplayTitle(ticket))) === 1
      && itemTitleCounts.get(normalizeSemanticName(item.title)) === 1
    if (!isUnambiguous || plannedSubjectIds.has(link.subjectId)) return false
    plannedSubjectIds.add(link.subjectId)
    return true
  }).slice(0, 6)

  const validation = suggested.length > 0
    ? validateAiActionPlan({
        schemaVersion: AI_ACTION_PLAN_SCHEMA_VERSION,
        steps: suggested.map((link, index) => ({
          actionId: 'ticket.bind@1',
          args: {
            target: itemById.get(link.subjectId)!.title,
            ticket: getTicketDisplayTitle(ticketById.get(link.ticketId)!),
          },
          dependsOn: [],
          id: `bind-ticket-${index + 1}`,
        })),
        summary: `关联 ${suggested.length} 份旅行资料`,
      })
    : null

  return {
    conflicts: links.filter((link) => link.status === 'conflict'),
    links,
    plan: validation?.ok ? validation.plan : null,
    suggested,
  }
}

function countNormalized(values: string[]) {
  const counts = new Map<string, number>()
  for (const value of values) {
    const key = normalizeSemanticName(value)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function normalizeSemanticName(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '')
}
