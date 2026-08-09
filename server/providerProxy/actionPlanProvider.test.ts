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

  it('keeps mock ticket binding semantic and strips internal resources from the prompt contract', async () => {
    const request = actionPlanRequest()
    request.command = '把「爱丁堡城堡门票」绑定到「爱丁堡城堡」'
    const result = await createMockAiActionPlanProvider(request)
      .plan(buildAiActionPlanProviderInput(request))

    expect(result).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          requiresConfirmation: true,
          steps: [{
            actionId: 'ticket.bind@1',
            args: { target: '爱丁堡城堡', ticket: '爱丁堡城堡门票' },
          }],
        },
      },
    })
    const prompt = buildAiActionPlanProviderInput(request).prompt
    expect(prompt).toContain('不得输出 ticketId、itemId、文件路径、Blob 或权限字段')
    expect(prompt).not.toContain('Bearer secret')
  })

  it('keeps mock execution and preference writes inside bounded registered fields', async () => {
    const executionRequest = actionPlanRequest()
    executionRequest.command = '把「伦敦眼」标记为完成'
    const executionResult = await createMockAiActionPlanProvider(executionRequest)
      .plan(buildAiActionPlanProviderInput(executionRequest))
    expect(executionResult).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          steps: [{
            actionId: 'item.execution.update@1',
            args: { state: 'completed', target: '伦敦眼' },
          }],
        },
      },
    })

    const preferenceRequest = actionPlanRequest()
    preferenceRequest.command = '「伦敦眼」必须保留，下雨别去，预留30分钟'
    const preferenceResult = await createMockAiActionPlanProvider(preferenceRequest)
      .plan(buildAiActionPlanProviderInput(preferenceRequest))
    expect(preferenceResult).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          steps: [{
            actionId: 'item.replan.preference.update@1',
            args: {
              bufferMinutes: 30,
              priority: 'must_keep',
              target: '伦敦眼',
              weatherSuitability: 'avoid_rain',
            },
          }],
        },
      },
    })

    const prompt = buildAiActionPlanProviderInput(preferenceRequest).prompt
    expect(prompt).toContain('只能选择 completed、skipped 或 active')
    expect(prompt).toContain('不得输出 patch、内部字段或自由文本')
  })

  it('does not turn negated or interrogative execution text into a write', async () => {
    for (const command of [
      '不要把「伦敦眼」标记为完成',
      '「伦敦眼」是不是已完成？',
      '不要把「伦敦眼」固定',
      '「伦敦眼」可以跳过吗？',
    ]) {
      const request = actionPlanRequest()
      request.command = command
      const result = await createMockAiActionPlanProvider(request)
        .plan(buildAiActionPlanProviderInput(request))

      expect(result).toMatchObject({
        errorCode: 'invalid_response',
        ok: false,
      })
    }
  })

  it('keeps mock disruption replans bounded and rejects non-action wording', async () => {
    const request = actionPlanRequest()
    request.command = '“伦敦眼”闭馆了，尽量保留'
    const result = await createMockAiActionPlanProvider(request)
      .plan(buildAiActionPlanProviderInput(request))

    expect(result).toMatchObject({
      kind: 'plan',
      ok: true,
      response: {
        plan: {
          steps: [{
            actionId: 'trip.replan.apply@1',
            args: {
              kind: 'closure',
              strategy: 'preserve_most',
              target: '伦敦眼',
            },
          }],
        },
      },
    })
    const prompt = buildAiActionPlanProviderInput(request).prompt
    expect(prompt).toContain('不得输出事件 ID、记录 ID、证据、备注、时间戳、快照、patch、路线、函数或 Provider')

    for (const command of [
      '如果我晚到30分钟，帮我调整行程',
      '不要因为下雨调整行程',
      '伦敦眼闭馆了怎么办？',
      '“伦敦眼”并未闭馆，请按最少改动调整行程',
      '假设“伦敦眼”闭馆，请调整后续',
      '“伦敦眼”闭馆了吗，请帮我分析后续影响',
    ]) {
      const nonActionRequest = actionPlanRequest()
      nonActionRequest.command = command
      await expect(
        createMockAiActionPlanProvider(nonActionRequest)
          .plan(buildAiActionPlanProviderInput(nonActionRequest)),
      ).resolves.toMatchObject({
        errorCode: 'invalid_response',
        ok: false,
      })
    }
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
