import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_WORKFLOW_IDS,
  ACCOUNT_WORKFLOW_MAX_STEPS,
  assertAccountWorkflowResultMatchesRequest,
  parseAccountWorkflowRequestV1,
  parseAccountWorkflowRunResultV1,
  type AccountWorkflowId,
  type AccountWorkflowRequestV1,
  type AccountWorkflowStepV1,
} from './workflowContract'

const BATCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const MUTATION_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const NOW = '2026-08-11T12:00:00.000Z'
const TRIP_ID = 'trip_uk'

describe('account workflow contract', () => {
  it.each(ACCOUNT_WORKFLOW_IDS)('accepts the registered %s workflow shape', (workflowId) => {
    expect(parseAccountWorkflowRequestV1(makeWorkflow(workflowId))).toMatchObject({ workflowId })
  })

  it('rejects unknown workflows, unknown fields, arbitrary functions, and server-managed objects', () => {
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      workflowId: 'database.run@1',
    })).toThrowError(expect.objectContaining({ code: 'unknown_workflow' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      functionName: 'account_apply_object_mutation_v1',
    })).toThrowError(expect.objectContaining({ code: 'unknown_field' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [{
        ...makeItemStep(),
        objectId: 'job_a',
        objectType: 'ai_job',
        payload: makeItemPayload('job_a'),
      }],
    })).toThrow()
  })

  it('rejects sensitive, owner-controlled, and unregistered Ticket payload fields', () => {
    for (const extra of [
      { ownerId: ACTOR_ID },
      { apiKey: 'secret-value' },
      { ocrText: 'passport body' },
    ]) {
      expect(() => parseAccountWorkflowRequestV1({
        ...makeWorkflow('trip.repair.apply@1'),
        steps: [{
          ...makeItemStep(),
          payload: { ...makeItemPayload('item_a'), ...extra },
        }],
      })).toThrow()
    }

    const ticketWorkflow = makeWorkflow('ticket.bind@1')
    expect(() => parseAccountWorkflowRequestV1({
      ...ticketWorkflow,
      steps: ticketWorkflow.steps.map((step) => step.objectType === 'ticket_meta'
        ? { ...step, payload: { ...step.payload, fileName: 'boarding-pass.pdf' } }
        : step),
    })).toThrow()
  })

  it('rejects duplicate step, mutation, object identities, and oversized lists', () => {
    const first = makeItemStep({ stepId: 'first' })
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [first, { ...first }],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [first, {
        ...makeItemStep({ objectId: 'item_b', stepId: 'second' }),
        mutationId: first.mutationId,
      }],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [first, {
        ...makeItemStep({ mutationId: '33333333-3333-4333-8333-333333333333', stepId: 'second' }),
      }],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.import.commit@1'),
      steps: Array.from({ length: ACCOUNT_WORKFLOW_MAX_STEPS + 1 }, (_, index) => makeItemStep({
        mutationId: deterministicUuid(index),
        objectId: `item_${index}`,
        stepId: `step_${index}`,
      })),
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
  })

  it('rejects deeply nested and aggregate-oversized workflow payloads', () => {
    let nested: Record<string, unknown> = { value: true }
    for (let depth = 0; depth < 34; depth += 1) nested = { nested }
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [makeItemStep({
        payload: makeItemPayload('item_a', { nested }),
      })],
    })).toThrow()

    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.import.commit@1'),
      steps: Array.from({ length: 10 }, (_, index) => makeItemStep({
        expectedRevision: 0,
        mutationId: deterministicUuid(index),
        objectId: `item_${index}`,
        payload: makeItemPayload(`item_${index}`, { notes: 'x'.repeat(450_000) }),
        stepId: `step_${index}`,
      })),
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
  })

  it('enforces domain-specific workflow shapes instead of accepting generic batches', () => {
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('day.items.reorder@1'),
      steps: [makeItemStep()],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('day.items.reorder@1'),
      steps: makeWorkflow('day.items.reorder@1').steps.map((step, index) => ({
        ...step,
        payload: { ...step.payload, sortOrder: index === 0 ? 1 : 3 },
      })),
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    const move = makeWorkflow('item.move@1')
    expect(() => parseAccountWorkflowRequestV1({
      ...move,
      steps: [
        { ...move.steps[0], payload: { ...move.steps[0].payload, sortOrder: 2 } },
      ],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    const reorder = makeWorkflow('day.items.reorder@1')
    expect(() => parseAccountWorkflowRequestV1({
      ...reorder,
      steps: reorder.steps.map((step, index) => index === 0
        ? { ...step, expectedRevision: 0 }
        : step),
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('day.items.reorder@1'),
      steps: [
        makeItemStep({ objectId: 'item_a', stepId: 'a' }),
        makeItemStep({
          mutationId: '33333333-3333-4333-8333-333333333333',
          objectId: 'item_b',
          payload: makeItemPayload('item_b', { dayId: 'day_other' }),
          stepId: 'b',
        }),
      ],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('ledger.batch@1'),
      steps: [{ ...makeLedgerStep(), expectedRevision: 0, operation: 'delete', payload: undefined }],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    expect(() => parseAccountWorkflowRequestV1({
      ...makeWorkflow('trip.repair.apply@1'),
      steps: [makeLedgerStep()],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))

    const tripImport = makeWorkflow('trip.import.commit@1')
    for (const steps of [
      tripImport.steps.filter((step) => step.objectType !== 'trip'),
      tripImport.steps.map((step) => step.objectType === 'trip'
        ? { ...step, expectedRevision: 1 }
        : step),
      tripImport.steps.map((step) => step.objectType === 'item'
        ? { ...step, payload: { ...step.payload, dayId: 'day_missing' } }
        : step),
    ]) {
      expect(() => parseAccountWorkflowRequestV1({ ...tripImport, steps }))
        .toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))
    }

    const binding = makeWorkflow('ticket.bind@1')
    for (const ticketIds of [['ticket_a', 'ticket_a'], ['ticket_a', 1], ['invalid id']]) {
      expect(() => parseAccountWorkflowRequestV1({
        ...binding,
        steps: binding.steps.map((step) => step.objectType === 'item'
          ? { ...step, payload: { ...step.payload, ticketIds } }
          : step),
      })).toThrow()
    }
    expect(() => parseAccountWorkflowRequestV1({
      ...binding,
      steps: binding.steps.map((step) => step.objectType === 'ticket_meta'
        ? { ...step, payload: { ...step.payload, itemId: 'item_missing' } }
        : step),
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))

    const unboundTicket = makeTicketStep()
    const unboundPayload = { ...unboundTicket.payload }
    Reflect.deleteProperty(unboundPayload, 'itemId')
    expect(parseAccountWorkflowRequestV1({
      ...binding,
      steps: [{
        ...unboundTicket,
        payload: {
          ...unboundPayload,
          scope: 'unassigned',
        },
      }],
    })).toMatchObject({
      steps: [expect.objectContaining({ objectType: 'ticket_meta' })],
      workflowId: 'ticket.bind@1',
    })
  })

  it('enforces the closed ledger batch topology before execution', () => {
    const ledger = makeWorkflow('ledger.batch@1')
    expect(() => parseAccountWorkflowRequestV1({
      ...ledger,
      steps: [{
        expectedRevision: 1,
        mutationId: '88888888-8888-4888-8888-888888888888',
        objectId: 'settings_a',
        objectSchemaVersion: 1,
        objectType: 'ledger_settings',
        operation: 'delete',
        stepId: 'settings_delete',
      }],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))

    const budget = (id: string, mutationId: string, stepId: string): AccountWorkflowStepV1 => ({
      expectedRevision: 0,
      mutationId,
      objectId: id,
      objectSchemaVersion: 1,
      objectType: 'ledger_budget',
      operation: 'upsert',
      payload: {
        amountMinor: 1_000,
        category: 'food',
        createdAt: 1,
        currency: 'GBP',
        id,
        scope: 'category',
        tripId: TRIP_ID,
        updatedAt: 1,
      },
      stepId,
    })
    expect(() => parseAccountWorkflowRequestV1({
      ...ledger,
      steps: [
        budget('budget_a', '88888888-8888-4888-8888-888888888881', 'budget_a'),
        budget('budget_b', '88888888-8888-4888-8888-888888888882', 'budget_b'),
      ],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))

    expect(() => parseAccountWorkflowRequestV1({
      ...ledger,
      steps: [
        {
          expectedRevision: 1,
          mutationId: '88888888-8888-4888-8888-888888888883',
          objectId: 'person_a',
          objectSchemaVersion: 1,
          objectType: 'ledger_participant',
          operation: 'delete',
          stepId: 'person_delete',
        },
        makeLedgerStep(),
      ],
    })).toThrowError(expect.objectContaining({ code: 'workflow_shape_invalid' }))

    expect(() => parseAccountWorkflowRequestV1({
      ...ledger,
      steps: [{
        ...makeLedgerStep(),
        payload: { ...makeLedgerStep().payload, providerKey: 'forbidden' },
      }],
    })).toThrow()
  })

  it('enforces the closed adaptive replan graph and nested payload allowlists', () => {
    const replan = makeWorkflow('trip.replan.apply@1')
    const recordIndex = replan.steps.findIndex((step) => step.objectType === 'replan_record')
    const historyIndex = replan.steps.findIndex((step) => (
      step.objectType === 'trip_intelligence_applied_change'
    ))
    const itemIndex = replan.steps.findIndex((step) => step.objectType === 'item')
    const mutateRecord = (mutator: (payload: Record<string, unknown>) => void) => {
      const steps = structuredClone(replan.steps) as AccountWorkflowStepV1[]
      const payload = steps[recordIndex].payload as Record<string, unknown>
      mutator(payload)
      return steps
    }
    const invalidCases = [
      ['missing-history', replan.steps.filter((_, index) => index !== historyIndex)],
      ['item-snapshot-mismatch', replan.steps.map((step, index) => index === itemIndex
        ? { ...step, payload: { ...step.payload, title: 'Substituted title' } }
        : step)],
      ['function-selector', mutateRecord((payload) => {
        const options = payload.options as Array<Record<string, unknown>>
        options[0].functionName = 'database.run'
      })],
      ['provider-secret', mutateRecord((payload) => {
        const options = payload.options as Array<Record<string, unknown>>
        options[0].providerKey = 'forbidden'
      })],
      ['baseline-field', mutateRecord((payload) => {
        const baseline = payload.accountObjectBaseline as Array<Record<string, unknown>>
        baseline[0].arbitraryField = true
      })],
      ['snapshot-mismatch', mutateRecord((payload) => {
        const snapshot = payload.afterSnapshot as Record<string, unknown>
        const items = snapshot.items as Array<Record<string, unknown>>
        items[0] = { ...items[0], startTime: '12:00' }
      })],
      ['forged-before-snapshot', mutateRecord((payload) => {
        const snapshot = payload.beforeSnapshot as Record<string, unknown>
        const items = snapshot.items as Array<Record<string, unknown>>
        items[0] = { ...items[0], title: 'Forged title' }
      })],
      ['selected-patch-mismatch', mutateRecord((payload) => {
        const options = payload.options as Array<Record<string, unknown>>
        const patches = options[0].itemPatches as Array<Record<string, unknown>>
        patches[0].patch = { endTime: '11:30', startTime: '09:00' }
      })],
      ['snapshot-scalar-coercion', mutateRecord((payload) => {
        const snapshot = payload.beforeSnapshot as Record<string, unknown>
        const days = snapshot.days as Array<Record<string, unknown>>
        days[0] = { ...days[0], title: 7 }
      })],
      ['history-target-missing', replan.steps.map((step, index) => index === historyIndex
        ? {
            ...step,
            payload: Object.fromEntries(
              Object.entries(step.payload ?? {}).filter(([key]) => key !== 'targetId'),
            ),
          }
        : step)],
    ] as const
    for (const [label, steps] of invalidCases) {
      expect(() => parseAccountWorkflowRequestV1({ ...replan, steps }), label).toThrow()
    }
  })

  it('parses and correlates an atomic success without accepting missing or substituted steps', () => {
    const request = parseAccountWorkflowRequestV1(makeWorkflow('trip.repair.apply@1'))
    const result = parseAccountWorkflowRunResultV1(makeSuccess(request))
    expect(assertAccountWorkflowResultMatchesRequest(result, request)).toMatchObject({ status: 'applied' })

    expect(() => assertAccountWorkflowResultMatchesRequest(
      parseAccountWorkflowRunResultV1({
        ...makeSuccess(request),
        steps: [],
      }),
      request,
    )).toThrow()
    expect(() => assertAccountWorkflowResultMatchesRequest(
      parseAccountWorkflowRunResultV1({
        ...makeSuccess(request),
        steps: makeSuccess(request).steps.map((step) => ({
          ...step,
          object: { ...step.object, objectId: 'item_substituted' },
        })),
      }),
      request,
    )).toThrow()
  })

  it('refuses to acknowledge an advanced idempotent replay as the current local revision', () => {
    const request = parseAccountWorkflowRequestV1(makeWorkflow('trip.repair.apply@1'))
    const result = parseAccountWorkflowRunResultV1({
      ...makeSuccess(request),
      status: 'idempotent',
      steps: makeSuccess(request).steps.map((step) => ({
        ...step,
        currentRevision: step.currentRevision + 1,
        object: { ...step.object, revision: step.object.revision + 1 },
      })),
    })
    expect(() => assertAccountWorkflowResultMatchesRequest(result, request))
      .toThrowError(expect.objectContaining({ code: 'invalid_response' }))
  })

  it('accepts only correlated revision and advanced-receipt conflict envelopes', () => {
    const request = parseAccountWorkflowRequestV1(makeWorkflow('trip.repair.apply@1'))
    const step = request.steps[0]
    const result = parseAccountWorkflowRunResultV1({
      batchMutationId: request.batchMutationId,
      conflicts: [{
        currentObject: makeRow(step, step.expectedRevision),
        currentRevision: step.expectedRevision,
        mutationId: step.mutationId,
        objectId: step.objectId,
        objectType: step.objectType,
        stepId: step.stepId,
      }],
      reason: 'revision_mismatch',
      schemaVersion: 1,
      status: 'conflict',
      tripId: request.tripId,
      workflowId: request.workflowId,
    })
    expect(assertAccountWorkflowResultMatchesRequest(result, request)).toMatchObject({
      reason: 'revision_mismatch',
    })
  })
})

function makeWorkflow(workflowId: AccountWorkflowId): AccountWorkflowRequestV1 {
  let steps: AccountWorkflowStepV1[]
  switch (workflowId) {
    case 'day.items.reorder@1':
      steps = [
        makeItemStep({
          objectId: 'item_a',
          payload: makeItemPayload('item_a', { sortOrder: 2 }),
          stepId: 'item_a',
        }),
        makeItemStep({
          mutationId: '33333333-3333-4333-8333-333333333333',
          objectId: 'item_b',
          payload: makeItemPayload('item_b', { sortOrder: 1 }),
          stepId: 'item_b',
        }),
      ]
      break
    case 'item.move@1':
      steps = [makeItemStep({ payload: makeItemPayload('item_a', { dayId: 'day_b', sortOrder: 1 }) })]
      break
    case 'trip.import.commit@1':
      steps = [
        makeTripImportStep(),
        makeDayImportStep(),
        makeItemStep({
          expectedRevision: 0,
          payload: makeItemPayload('item_a', { dayId: 'day_import', sortOrder: 0 }),
        }),
      ]
      break
    case 'ticket.bind@1':
      steps = [
        makeTicketStep(),
        makeItemStep({ payload: makeItemPayload('item_a', { ticketIds: ['ticket_a'] }) }),
      ]
      break
    case 'ledger.batch@1':
      steps = [makeLedgerStep()]
      break
    case 'trip.replan.apply@1':
      steps = makeAdaptiveReplanSteps()
      break
    case 'trip.repair.apply@1':
      steps = [makeItemStep()]
      break
  }
  return {
    batchMutationId: BATCH_ID,
    deviceId: 'device_primary',
    schemaVersion: 1,
    steps,
    tripId: TRIP_ID,
    workflowId,
  }
}

function makeAdaptiveReplanSteps(): AccountWorkflowStepV1[] {
  const beforeItem = makeItemPayload('item_a', {
    endTime: '11:00',
    startTime: '10:00',
    updatedAt: 1,
  })
  const afterItem = {
    ...beforeItem,
    endTime: '11:30',
    startTime: '10:30',
    updatedAt: 2,
  }
  const day = {
    date: '2026-07-10',
    id: 'day_a',
    sortOrder: 1,
    title: 'London',
    tripId: TRIP_ID,
  }
  const beforeSchedule = {
    dayId: day.id,
    endTime: '11:00',
    sortOrder: 1,
    startTime: '10:00',
  }
  const afterSchedule = {
    dayId: day.id,
    endTime: '11:30',
    sortOrder: 1,
    startTime: '10:30',
  }
  const diff = {
    companionImpacts: [],
    itemChanges: [{
      after: afterSchedule,
      before: beforeSchedule,
      changeType: 'time_changed',
      itemId: 'item_a',
      reason: 'Arrival delay',
      title: 'Museum',
    }],
    ledgerImpacts: [],
    routeImpacts: [],
    ticketImpacts: [],
    warnings: [],
  }
  const option = (strategy: 'least_change' | 'preserve_most' | 'shortest_route') => ({
    diff,
    id: `replan_${strategy}_a`,
    itemPatches: [{
      itemId: 'item_a',
      patch: { endTime: '11:30', startTime: '10:30' },
    }],
    score: 100,
    strategy,
    summary: 'Shifted one stop',
    title: strategy,
  })
  const selected = option('least_change')
  const recordPayload = {
    accountObjectBaseline: [
      { expectedRevision: 1, objectId: TRIP_ID, objectType: 'trip' },
      { expectedRevision: 1, objectId: day.id, objectType: 'day' },
      { expectedRevision: 1, objectId: 'item_a', objectType: 'item' },
    ],
    afterSnapshot: { days: [day], items: [afterItem] },
    appliedFingerprint: 'applied-fingerprint',
    baselineFingerprint: 'baseline-fingerprint',
    beforeSnapshot: { days: [day], items: [beforeItem] },
    createdAt: 2,
    eventId: 'replan_event_a',
    evidence: [{
      id: 'user-report:replan_event_a',
      kind: 'user_report',
      label: '用户报告',
      retrievedAt: '2026-08-11T12:00:00.000Z',
      snippet: 'Arrival delay',
      sourceType: 'unknown',
    }],
    id: 'replan_record_a',
    operationFingerprint: 'ai-action-replan-a',
    operationKind: 'adaptive_replan',
    options: [selected, option('preserve_most'), option('shortest_route')],
    scopeItemIds: ['item_a'],
    selectedDiff: diff,
    selectedOptionId: selected.id,
    status: 'applied',
    tripId: TRIP_ID,
    updatedAt: 2,
  }
  return [
    {
      expectedRevision: 1,
      mutationId: '88888888-8888-4888-8888-888888888888',
      objectId: TRIP_ID,
      objectSchemaVersion: 1,
      objectType: 'trip',
      operation: 'upsert',
      payload: {
        createdAt: 1,
        destination: 'United Kingdom',
        endDate: '2026-07-10',
        id: TRIP_ID,
        startDate: '2026-07-10',
        title: 'United Kingdom',
        updatedAt: 2,
      },
      stepId: 'trip',
    },
    {
      ...makeItemStep({
        mutationId: '99999999-9999-4999-8999-999999999999',
        objectId: 'item_a',
        payload: afterItem,
        stepId: 'item',
      }),
      expectedRevision: 1,
    },
    {
      expectedRevision: 0,
      mutationId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      objectId: 'replan_event_a',
      objectSchemaVersion: 1,
      objectType: 'replan_event',
      operation: 'upsert',
      payload: {
        createdAt: 2,
        dayId: day.id,
        delayMinutes: 30,
        evidence: [],
        id: 'replan_event_a',
        itemId: 'item_a',
        kind: 'late',
        notes: 'Arrival delay',
        occurredAt: '2026-08-11T12:00:00.000Z',
        reportedByRole: 'owner',
        status: 'applied',
        tripId: TRIP_ID,
        updatedAt: 2,
      },
      stepId: 'event',
    },
    {
      expectedRevision: 0,
      mutationId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',
      objectId: 'replan_record_a',
      objectSchemaVersion: 1,
      objectType: 'replan_record',
      operation: 'upsert',
      payload: recordPayload,
      stepId: 'record',
    },
    {
      expectedRevision: 0,
      mutationId: 'cccccccc-1111-4111-8111-cccccccccccc',
      objectId: 'trip_intelligence_change_a',
      objectSchemaVersion: 1,
      objectType: 'trip_intelligence_applied_change',
      operation: 'upsert',
      payload: {
        actionType: 'global_ai_adaptive_replan_applied',
        dedupeKey: `${TRIP_ID}:change-a`,
        detail: 'Shifted one stop',
        executionId: 'trip-operations-2-',
        executionSource: 'live',
        executionStatus: 'success',
        executionTitle: 'Adaptive replan',
        id: 'trip_intelligence_change_a',
        occurredAt: 2,
        privacyLevel: 'private',
        recommendationFingerprints: [],
        sourceId: recordPayload.id,
        sourceKind: 'live',
        sourceLabel: 'Adaptive replan',
        targetId: 'item_a',
        targetType: 'live',
        title: 'Replan applied',
        tripId: TRIP_ID,
        updatedAt: 2,
      },
      stepId: 'history',
    },
  ]
}

function makeTripImportStep(): AccountWorkflowStepV1 {
  return {
    expectedRevision: 0,
    mutationId: '66666666-6666-4666-8666-666666666666',
    objectId: TRIP_ID,
    objectSchemaVersion: 1,
    objectType: 'trip',
    operation: 'upsert',
    payload: { id: TRIP_ID, title: 'United Kingdom' },
    stepId: 'trip_step',
  }
}

function makeDayImportStep(): AccountWorkflowStepV1 {
  return {
    expectedRevision: 0,
    mutationId: '77777777-7777-4777-8777-777777777777',
    objectId: 'day_import',
    objectSchemaVersion: 1,
    objectType: 'day',
    operation: 'upsert',
    payload: {
      date: '2026-07-10',
      id: 'day_import',
      sortOrder: 0,
      title: 'Day 1',
      tripId: TRIP_ID,
    },
    stepId: 'day_step',
  }
}

function makeItemStep(overrides: Partial<AccountWorkflowStepV1> = {}): AccountWorkflowStepV1 {
  const objectId = overrides.objectId ?? 'item_a'
  return {
    expectedRevision: 1,
    mutationId: MUTATION_ID,
    objectId,
    objectSchemaVersion: 1,
    objectType: 'item',
    operation: 'upsert',
    payload: makeItemPayload(objectId),
    stepId: 'item_step',
    ...overrides,
  }
}

function makeTicketStep(): AccountWorkflowStepV1 {
  return {
    expectedRevision: 1,
    mutationId: '44444444-4444-4444-8444-444444444444',
    objectId: 'ticket_a',
    objectSchemaVersion: 1,
    objectType: 'ticket_meta',
    operation: 'upsert',
    payload: {
      createdAt: 1,
      fileType: 'pdf',
      id: 'ticket_a',
      itemId: 'item_a',
      mimeType: 'application/pdf',
      scope: 'item',
      sharedVisibility: { mode: 'all' },
      size: 1024,
      storageMode: 'copy',
      ticketCategory: 'admission_ticket',
      title: 'Edinburgh Castle',
      tripId: TRIP_ID,
      updatedAt: 1,
    },
    stepId: 'ticket_step',
  }
}

function makeLedgerStep(): AccountWorkflowStepV1 {
  return {
    expectedRevision: 1,
    mutationId: '55555555-5555-4555-8555-555555555555',
    objectId: 'expense_a',
    objectSchemaVersion: 1,
    objectType: 'ledger_expense',
    operation: 'upsert',
    payload: {
      amountMinor: 1200,
      category: 'food',
      createdAt: 1,
      currency: 'GBP',
      date: '2026-07-10',
      id: 'expense_a',
      payerParticipantId: 'person_a',
      source: { kind: 'manual' },
      splitMode: 'equal',
      splitShares: [{ participantId: 'person_a', weight: 1 }],
      status: 'confirmed',
      title: 'Dinner',
      tripId: TRIP_ID,
      updatedAt: 1,
    },
    stepId: 'expense_step',
  }
}

function makeItemPayload(id: string, overrides: Record<string, unknown> = {}) {
  return {
    createdAt: 1,
    dayId: 'day_a',
    id,
    sortOrder: 0,
    ticketIds: [],
    title: 'Arrival',
    tripId: TRIP_ID,
    updatedAt: 1,
    ...overrides,
  }
}

function makeSuccess(request: AccountWorkflowRequestV1) {
  return {
    batchMutationId: request.batchMutationId,
    schemaVersion: 1,
    status: 'applied',
    steps: request.steps.map((step) => ({
      appliedRevision: step.expectedRevision + 1,
      currentRevision: step.expectedRevision + 1,
      mutationId: step.mutationId,
      object: makeRow(step, step.expectedRevision + 1),
      stepId: step.stepId,
    })),
    tripId: request.tripId,
    workflowId: request.workflowId,
  } as const
}

function makeRow(step: AccountWorkflowStepV1, revision: number) {
  return {
    actorId: ACTOR_ID,
    createdAt: NOW,
    deletedAt: step.operation === 'delete' ? NOW : null,
    deviceId: 'device_primary',
    mutationId: step.mutationId,
    objectId: step.objectId,
    objectSchemaVersion: 1,
    objectType: step.objectType,
    payload: step.operation === 'delete' ? null : step.payload,
    revision,
    schemaVersion: 1,
    tombstone: step.operation === 'delete',
    tripId: TRIP_ID,
    updatedAt: NOW,
  }
}

function deterministicUuid(index: number) {
  return `10000000-0000-4000-8000-${index.toString().padStart(12, '0')}`
}
