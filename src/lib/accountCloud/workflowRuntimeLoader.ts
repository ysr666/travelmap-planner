import { getActiveAccountHash } from '../accountStorageScope'
import { isAccountCloudV2AccountEnabled } from './feature'
import type {
  ProductAccountWorkflowInput,
  ProductAccountWorkflowResult,
} from './workflowMutationRuntime'

export async function executeProductAccountWorkflowIfEnabled<T>(
  input: ProductAccountWorkflowInput<T>,
): Promise<ProductAccountWorkflowResult<T>> {
  if (!isAccountCloudV2AccountEnabled(getActiveAccountHash())) return { handled: false }
  const runtime = await import('./workflowMutationRuntime')
  return runtime.executeProductAccountWorkflow(input)
}
