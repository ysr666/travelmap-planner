import { describe, expect, it, vi } from 'vitest'
import { executeProductAccountWorkflowIfEnabled } from './workflowRuntimeLoader'

const mocks = vi.hoisted(() => ({ execute: vi.fn() }))

vi.mock('./workflowMutationRuntime', () => ({
  executeProductAccountWorkflow: mocks.execute,
}))

describe('account workflow runtime loader', () => {
  it('returns before importing or applying workflow code while the compile-time gate is closed', async () => {
    const apply = vi.fn()
    await expect(executeProductAccountWorkflowIfEnabled({
      apply,
      steps: [],
      tripId: 'trip_uk',
      workflowId: 'trip.repair.apply@1',
    })).resolves.toEqual({ handled: false })
    expect(apply).not.toHaveBeenCalled()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
