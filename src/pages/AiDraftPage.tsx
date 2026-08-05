import { AiDraftWorkspace } from '../components/AiDraftWorkspace'
import { useAiDraftController } from '../hooks/useAiDraftController'

export function AiDraftPage() {
  const controller = useAiDraftController()
  return <AiDraftWorkspace controller={controller} />
}
