import { describe, expect, it, vi } from 'vitest'
import { listAiActionCatalog } from '../../src/lib/ai/actionGateway/registry'
import {
  buildAiActionPlanProviderInput,
  createMockAiActionPlanProvider,
  createOpenAiCompatibleAiActionPlanProvider,
} from './actionPlanProvider'

describe('actionPlanProvider', () => {
  it('returns a deterministic registered action plan from redacted context', async () => {
    const request = actionPlanRequest()
    const provider = createMockAiActionPlanProvider(request)
    const result = await provider.plan(buildAiActionPlanProviderInput(request))

    expect(result.ok).toBe(true)
    if (result.ok && result.kind === 'plan') {
      expect(result.response.plan.steps).toMatchObject([
        { actionId: 'place.enrich@1', args: { target: 'first_item' } },
      ])
      expect(JSON.stringify(result.response)).not.toContain('Authorization')
    }
  })

  it('rejects an ambiguous mock cross-day move instead of substituting another action', async () => {
    for (const command of [
      '把伦敦眼移动到另一个日期',
      '把伦敦眼调整到另一个日期',
    ]) {
      const request = actionPlanRequest()
      request.command = command
      const provider = createMockAiActionPlanProvider(request)

      const result = await provider.plan(buildAiActionPlanProviderInput(request))

      expect(result).toMatchObject({
        errorCode: 'invalid_response',
        ok: false,
      })
    }
  })

  it('keeps mock deletion and undo inside the registered semantic contract', async () => {
    const deleteRequest = actionPlanRequest()
    deleteRequest.command = '删除「伦敦眼」'
    const deleteResult = await createMockAiActionPlanProvider(deleteRequest)
      .plan(buildAiActionPlanProviderInput(deleteRequest))
    expect(deleteResult).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          steps: [{
            actionId: 'item.delete@1',
            args: { target: '伦敦眼' },
          }],
        },
      },
    })

    const undoRequest = actionPlanRequest()
    undoRequest.command = '撤销刚才的删除'
    const undoResult = await createMockAiActionPlanProvider(undoRequest)
      .plan(buildAiActionPlanProviderInput(undoRequest))
    expect(undoResult).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          steps: [{
            actionId: 'history.undo@1',
            args: { kind: 'item_delete' },
          }],
        },
      },
    })

    const prompt = buildAiActionPlanProviderInput(deleteRequest).prompt
    expect(prompt).toContain('不得选择票据、订单、账本、旅行或任何永久删除目标')
    expect(prompt).toContain('不得输出记录 ID、快照、指纹、状态或数据库字段')
  })

  it('sends only the prompt and server-side key to an OpenAI-compatible provider', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({
        max_tokens: 700,
        model: 'deepseek-v4-flash',
        response_format: { type: 'json_object' },
      })
      expect(JSON.stringify(body)).not.toContain('server-secret')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer server-secret')
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: '{"schemaVersion":"ai_action_plan.v1","summary":"补全地点","steps":[{"id":"place","actionId":"place.enrich@1","args":{"target":"first_item"},"dependsOn":[]}]}',
          },
        }],
      }))
    }) as unknown as typeof fetch

    const provider = createOpenAiCompatibleAiActionPlanProvider({
      TRIPMAP_AI_API_KEY: 'server-secret',
      TRIPMAP_AI_BASE_URL: 'https://api.example',
      TRIPMAP_AI_MODEL: 'deepseek-v4-flash',
    }, fetcher)
    const result = await provider.plan({ maxOutputTokens: 700, prompt: 'redacted prompt' })

    expect(result).toMatchObject({ kind: 'raw', ok: true })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})

function actionPlanRequest() {
  return {
    availableActions: listAiActionCatalog(),
    command: '帮我补全第一站地点信息',
    context: {
      scopeLabel: '当前旅行',
      summaries: [{ key: 'trip', label: '旅行', value: '英国 12 天家庭旅行' }],
    },
    locale: 'zh-CN' as const,
    operation: 'ai_action_plan' as const,
    requestId: 'action-plan-1',
  }
}
