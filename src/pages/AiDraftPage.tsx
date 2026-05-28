import { useMemo, useState } from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { Collapsible } from '../components/ui/Collapsible'
import { FormField, FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS } from '../components/ui/FormField'
import { navigateTo } from '../lib/routes'
import { createId } from '../db/ids'
import {
  validateAiTripDraft,
  summarizeAiTripDraft,
  type AiTripDraft,
  type AiDraftValidationError,
} from '../lib/ai/aiTripDraft'
import {
  buildAiTripDraftRequest,
  validateAiTripDraftRequest,
  type AiTripDraftRequestValidationError,
} from '../lib/ai/aiTripDraftRequest'
import { generateMockAiTripDraft } from '../lib/ai/aiTripDraftMock'
import { getStoredTravelProfile } from '../lib/travelProfile'
import { getStoredAiPrivacySettings } from '../lib/ai/aiPrivacy'
import {
  sanitizeAiDraftRepairDraftForProxy,
  sanitizeAiDraftRepairFindingsForProxy,
  summarizeAiPrivacyForAiRequest,
} from '../lib/ai/aiPrivacyGuard'
import { analyzeAiTripDraftQuality } from '../lib/ai/aiTripDraftQuality'
import { fetchProviderProxyAiTripDraft, fetchProviderProxyAiTripDraftRepair, getProviderProxyConfig, ProviderProxyClientError } from '../lib/providerProxyClient'
import { importTripPlanRecords } from '../db'
import type { Trip, Day, ItineraryItem } from '../types'

const SAMPLE_DRAFT = {
  title: '东京五日游',
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
  days: [
    {
      date: '2025-04-01',
      title: '抵达与浅草',
      items: [
        {
          title: '浅草寺',
          locationName: '浅草寺',
          address: '东京都台东区浅草2-3-1',
          lat: 35.7148,
          lng: 139.7967,
          startTime: '10:00',
          endTime: '12:00',
          note: '参观雷门和仲见世通',
        },
        {
          title: '东京晴空塔',
          locationName: '东京晴空塔',
          startTime: '14:00',
          endTime: '16:00',
          previousTransportMode: 'transit',
        },
      ],
    },
    {
      date: '2025-04-02',
      title: '涩谷与原宿',
      items: [
        {
          title: '明治神宫',
          locationName: '明治神宫',
          lat: 35.6764,
          lng: 139.6993,
          startTime: '09:00',
        },
        {
          title: '涩谷十字路口',
          startTime: '14:00',
          previousTransportMode: 'transit',
        },
      ],
    },
  ],
}

export function AiDraftPage() {
  const profile = getStoredTravelProfile()
  const privacy = getStoredAiPrivacySettings()

  const [jsonText, setJsonText] = useState('')
  const [draft, setDraft] = useState<AiTripDraft | null>(null)
  const [errors, setErrors] = useState<AiDraftValidationError[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)

  // Request form state
  const [requestDestination, setRequestDestination] = useState('')
  const [requestStartDate, setRequestStartDate] = useState('')
  const [requestEndDate, setRequestEndDate] = useState('')
  const [requestPace, setRequestPace] = useState(profile.pace)
  const [requestPreferTransport, setRequestPreferTransport] = useState(profile.preferTransport)
  const [requestMustVisit, setRequestMustVisit] = useState('')
  const [requestAvoid, setRequestAvoid] = useState('')
  const [requestFreeText, setRequestFreeText] = useState('')
  const [requestErrors, setRequestErrors] = useState<AiTripDraftRequestValidationError[]>([])

  // Proxy state
  const proxyConfig = getProviderProxyConfig()
  const [proxyGenerating, setProxyGenerating] = useState(false)
  const [proxyError, setProxyError] = useState<string | null>(null)
  const [showProxyConfirm, setShowProxyConfirm] = useState(false)

  // Quality check state
  const qualityResult = useMemo(
    () => draft ? analyzeAiTripDraftQuality(draft, { pace: profile.pace, mealTimeProtection: profile.mealTimeProtection }) : null,
    [draft, profile.pace, profile.mealTimeProtection],
  )
  const [repairGenerating, setRepairGenerating] = useState(false)
  const [repairError, setRepairError] = useState<string | null>(null)
  const [showRepairConfirm, setShowRepairConfirm] = useState(false)
  const [repairSuccessMessage, setRepairSuccessMessage] = useState<string | null>(null)

  function previewDraftObject(draftObj: unknown) {
    const text = JSON.stringify(draftObj, null, 2)
    setJsonText(text)
    try {
      const result = validateAiTripDraft(draftObj)
      if (result.valid && result.draft) {
        setDraft(result.draft)
        setErrors([])
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: '草稿校验失败。' }])
    }
  }

  function handleLoadSample() {
    setJsonText(JSON.stringify(SAMPLE_DRAFT, null, 2))
    setDraft(null)
    setErrors([])
  }

  function handleParse() {
    try {
      const input = JSON.parse(jsonText)
      const result = validateAiTripDraft(input)
      if (result.valid && result.draft) {
        setDraft(result.draft)
        setErrors([])
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: 'JSON 格式无效，请检查语法。' }])
    }
  }

  function handleGenerateMock() {
    const built = buildAiTripDraftRequest(
      {
        destination: requestDestination,
        startDate: requestStartDate,
        endDate: requestEndDate,
        pace: requestPace,
        preferTransport: requestPreferTransport,
        mustVisitText: requestMustVisit,
        avoidText: requestAvoid,
        freeTextRequirement: requestFreeText,
      },
      { pace: profile.pace, preferTransport: profile.preferTransport },
    )

    const validation = validateAiTripDraftRequest(built)
    if (!validation.valid || !validation.request) {
      setRequestErrors(validation.errors)
      setErrors([])
      setDraft(null)
      return
    }

    setRequestErrors([])
    const mockDraft = generateMockAiTripDraft(validation.request)
    previewDraftObject(mockDraft)
  }

  function handleProxyConfirm() {
    setShowProxyConfirm(false)
    handleGenerateViaProxy()
  }

  function handleRepairConfirm() {
    setShowRepairConfirm(false)
    handleRepairViaProxy()
  }

  async function handleRepairViaProxy() {
    if (!proxyConfig.proxyUrl || !draft) return

    setRepairError(null)
    setRepairSuccessMessage(null)
    setRepairGenerating(true)
    try {
      const sanitizedFindings = sanitizeAiDraftRepairFindingsForProxy(
        [
          ...(qualityResult?.warnings ?? []),
          ...(qualityResult?.criticals ?? []),
        ].map((f) => ({
          ruleId: f.ruleId,
          severity: f.severity,
          title: f.title,
          message: f.message,
          dayDate: f.dayDate,
        })),
      )

      const result = await fetchProviderProxyAiTripDraftRepair(
        {
          operation: 'ai_trip_draft_repair',
          draft: sanitizeAiDraftRepairDraftForProxy(draft, privacy),
          qualityFindings: sanitizedFindings,
        },
        proxyConfig.proxyUrl,
      )

      const revalidation = validateAiTripDraft(result.draft)
      if (!revalidation.valid || !revalidation.draft) {
        setRepairError('修复结果未通过校验，请重试。')
        return
      }

      previewDraftObject(revalidation.draft)
      setRepairSuccessMessage('已生成修复版草稿，请重新检查。')
    } catch (caught) {
      if (caught instanceof ProviderProxyClientError) {
        setRepairError(caught.message)
      } else {
        setRepairError('修复请求失败，请重试。')
      }
    } finally {
      setRepairGenerating(false)
    }
  }

  async function handleGenerateViaProxy() {
    if (!proxyConfig.proxyUrl) return

    const built = buildAiTripDraftRequest(
      {
        destination: requestDestination,
        startDate: requestStartDate,
        endDate: requestEndDate,
        pace: requestPace,
        preferTransport: requestPreferTransport,
        mustVisitText: requestMustVisit,
        avoidText: requestAvoid,
        freeTextRequirement: requestFreeText,
      },
      { pace: profile.pace, preferTransport: profile.preferTransport },
    )

    const validation = validateAiTripDraftRequest(built)
    if (!validation.valid || !validation.request) {
      setRequestErrors(validation.errors)
      setErrors([])
      setDraft(null)
      return
    }

    setRequestErrors([])
    setProxyError(null)
    setProxyGenerating(true)
    try {
      const result = await fetchProviderProxyAiTripDraft(
        {
          destination: validation.request.destination,
          endDate: validation.request.endDate,
          freeTextRequirement: validation.request.freeTextRequirement,
          mealTimeProtection: validation.request.mealTimeProtection,
          mustVisitText: validation.request.mustVisitText,
          avoidText: validation.request.avoidText,
          operation: 'ai_trip_draft',
          pace: validation.request.pace,
          preferTransport: validation.request.preferTransport,
          startDate: validation.request.startDate,
        },
        proxyConfig.proxyUrl,
      )
      previewDraftObject(result.draft)
    } catch (caught) {
      const message = caught instanceof ProviderProxyClientError
        ? caught.message
        : 'AI 草稿服务请求失败。'
      setProxyError(message)
      setDraft(null)
    } finally {
      setProxyGenerating(false)
    }
  }

  async function handleConfirmImport() {
    if (!draft) return
    setImporting(true)
    try {
      const now = Date.now()
      const tripId = createId('trip')

      const trip: Trip = {
        id: tripId,
        title: draft.title,
        destination: draft.destination,
        startDate: draft.startDate,
        endDate: draft.endDate,
        createdAt: now,
        updatedAt: now,
      }

      const days: Day[] = []
      const itineraryItems: ItineraryItem[] = []

      draft.days.forEach((day, dayIndex) => {
        const dayId = createId('day')
        days.push({
          id: dayId,
          tripId,
          date: day.date,
          title: day.title ?? `第 ${dayIndex + 1} 天`,
          sortOrder: dayIndex,
        })

        day.items.forEach((item, itemIndex) => {
          itineraryItems.push({
            id: createId('item'),
            tripId,
            dayId,
            title: item.title,
            startTime: item.startTime,
            endTime: item.endTime,
            locationName: item.locationName,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            previousTransportMode: item.previousTransportMode,
            notes: item.note,
            ticketIds: [],
            sortOrder: itemIndex,
            createdAt: now,
            updatedAt: now,
          })
        })
      })

      const result = await importTripPlanRecords({
        trip,
        days,
        itineraryItems,
        ticketMetas: [],
        ticketBlobs: [],
      })
      navigateTo('trip', { tripId: result.tripId })
    } catch (error) {
      setErrors([{ path: 'root', message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}` }])
      setShowConfirm(false)
    } finally {
      setImporting(false)
    }
  }

  const summary = draft ? summarizeAiTripDraft(draft) : null
  const repairPrivacyNotice = draft ? summarizeAiPrivacyForAiRequest(privacy, 'repair') : null

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <div className="space-y-1" data-testid="ai-draft-page-header">
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">AI 行程草稿</h1>
        <p className="text-sm leading-6 tm-muted">
          先生成或粘贴草稿，检查无误后再导入为本地旅行
        </p>
        <p className="text-xs tm-muted">
          当前为本地示例流程，不会调用外部 AI
        </p>
      </div>

      <div className="space-y-3" data-testid="ai-draft-request-form">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">填写行程信息</p>
        <p className="text-xs tm-muted">
          根据你填写的信息生成一个本地示例草稿，用于预览未来 AI 生成流程。
        </p>

        <FormField
          label="目的地"
          value={requestDestination}
          onChange={setRequestDestination}
          placeholder="例如：东京、巴黎、曼谷"
          required
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="开始日期"
            value={requestStartDate}
            onChange={setRequestStartDate}
            type="date"
            required
          />
          <FormField
            label="结束日期"
            value={requestEndDate}
            onChange={setRequestEndDate}
            type="date"
            required
          />
        </div>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>旅行节奏</span>
          <select
            className={FIELD_SELECT_CLASS}
            value={requestPace}
            onChange={(e) => setRequestPace(e.target.value as typeof requestPace)}
          >
            <option value="relaxed">轻松</option>
            <option value="moderate">适中</option>
            <option value="compact">紧凑</option>
          </select>
        </label>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>交通偏好</span>
          <select
            className={FIELD_SELECT_CLASS}
            value={requestPreferTransport}
            onChange={(e) => setRequestPreferTransport(e.target.value as typeof requestPreferTransport)}
          >
            <option value="public_transport">公共交通</option>
            <option value="walking">步行</option>
            <option value="taxi">打车</option>
            <option value="mixed">综合</option>
          </select>
        </label>

        <Collapsible title="更多偏好（可选）" subtitle="想去的地方、不想要的安排、补充要求">
          <div className="space-y-3">
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>想去的地方</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：浅草寺、秋叶原"
                value={requestMustVisit}
                onChange={(e) => setRequestMustVisit(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>不想要的安排</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：不要购物商场"
                value={requestAvoid}
                onChange={(e) => setRequestAvoid(e.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>补充要求</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：带老人出行，节奏放慢"
                value={requestFreeText}
                onChange={(e) => setRequestFreeText(e.target.value)}
              />
            </label>
          </div>
        </Collapsible>

        <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            当前为本地示例草稿，不会调用外部 AI，不会上传数据。
            <br />
            生成后仍需预览和确认，确认导入后才会创建本地旅行。
            {proxyConfig.configured && (
              <>
                <br />
                如通过旅图服务生成，请求将包含目的地和日期等基本信息，不会包含票据内容。
              </>
            )}
          </p>
        </Card>

        {requestErrors.length > 0 && (
          <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
            <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">表单错误</h3>
            <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
              {requestErrors.map((error, i) => (
                <li key={i}>{error.message}</li>
              ))}
            </ul>
          </Card>
        )}

        <Button onClick={handleGenerateMock} className="w-full">
          根据表单生成示例草稿
        </Button>

        {proxyConfig.configured ? (
          <Button
            onClick={() => setShowProxyConfirm(true)}
            variant="secondary"
            className="w-full"
            loading={proxyGenerating}
          >
            通过旅图服务生成草稿
          </Button>
        ) : (
          <Button disabled className="w-full" variant="secondary">
            当前未配置 AI 生成服务
          </Button>
        )}

        {proxyError && (
          <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
            <p className="text-sm text-red-700 dark:text-red-300">{proxyError}</p>
          </Card>
        )}
      </div>

      <div data-testid="ai-draft-json-section">
        <Collapsible title="粘贴 JSON 草稿" subtitle="如果你已经有符合格式的草稿 JSON，可以在这里粘贴。">
          <div className="space-y-4">
            <div className="space-y-2">
              <textarea
                className="h-48 w-full rounded-xl border border-slate-200 p-3 font-mono text-sm tm-surface dark:border-slate-700"
                placeholder='{"title": "...", "startDate": "YYYY-MM-DD", ...}'
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleLoadSample} variant="secondary">
                加载固定示例
              </Button>
              <Button onClick={handleParse} disabled={!jsonText.trim()}>
                解析草稿
              </Button>
            </div>
          </div>
        </Collapsible>
      </div>

      {errors.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30" data-testid="ai-draft-errors">
          <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">草稿错误</h3>
          <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
            {errors.map((error, i) => (
              <li key={i}>
                {error.path !== 'root' && <span className="font-mono text-xs">{error.path}: </span>}
                {error.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary && (
        <>
          <Card className="space-y-3" data-testid="ai-draft-summary">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">草稿摘要</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="tm-muted">旅行标题</dt>
              <dd className="font-medium">{summary.title}</dd>
              <dt className="tm-muted">目的地</dt>
              <dd>{summary.destination || '未指定'}</dd>
              <dt className="tm-muted">日期范围</dt>
              <dd>{summary.startDate} 至 {summary.endDate}</dd>
              <dt className="tm-muted">天数</dt>
              <dd>{summary.daysCount} 天</dd>
              <dt className="tm-muted">行程点</dt>
              <dd>{summary.itemsCount} 个</dd>
            </dl>
          </Card>

          <Card className="space-y-3" data-testid="ai-draft-quality-card">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">草稿检查</h3>
            {qualityResult && qualityResult.status === 'clean' && (
              <p className="text-sm text-green-700 dark:text-green-300">未发现明显问题。</p>
            )}
            {qualityResult && qualityResult.status !== 'clean' && (
              <div className="space-y-2">
                {[...qualityResult.criticals, ...qualityResult.warnings].slice(0, 5).map((f) => (
                  <div key={f.id} className="flex items-start gap-2 text-sm">
                    <span className={f.severity === 'critical' ? 'text-red-500' : 'text-amber-500'}>
                      {f.severity === 'critical' ? '!' : '!'}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      <span className="font-medium">{f.title}</span>
                      {f.dayDate && <span className="tm-muted ml-1">({f.dayDate})</span>}
                      <span className="tm-muted ml-1">{f.message}</span>
                    </span>
                  </div>
                ))}
                {(qualityResult.criticals.length + qualityResult.warnings.length) > 5 && (
                  <p className="text-xs tm-muted">
                    还有 {(qualityResult.criticals.length + qualityResult.warnings.length) - 5} 条提醒未显示。
                  </p>
                )}
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  这些提示不会阻止导入，请在确认前检查。
                </p>
              </div>
            )}
          </Card>

          {qualityResult && qualityResult.status !== 'clean' && (
            <>
              {proxyConfig.configured ? (
                <Button
                  onClick={() => setShowRepairConfirm(true)}
                  variant="secondary"
                  className="w-full"
                  data-testid="ai-draft-repair-action"
                  loading={repairGenerating}
                >
                  让 AI 修复草稿
                </Button>
              ) : (
                <Button disabled className="w-full" data-testid="ai-draft-repair-action" variant="secondary">
                  当前未配置 AI 修复服务
                </Button>
              )}
            </>
          )}

          {repairSuccessMessage && (
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30">
              <p className="text-sm text-green-700 dark:text-green-300">{repairSuccessMessage}</p>
            </Card>
          )}

          {repairError && (
            <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
              <p className="text-sm text-red-700 dark:text-red-300">{repairError}</p>
            </Card>
          )}

          <Card className="space-y-3" data-testid="ai-draft-preview">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">行程预览</h3>
            <div className="space-y-4">
              {draft!.days.map((day, dayIndex) => (
                <div key={dayIndex} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {day.date}
                    </span>
                    {day.title && (
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {day.title}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1 pl-4">
                    {day.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="text-sm">
                        <span className="font-medium">{item.title}</span>
                        {item.startTime && <span className="ml-2 tm-muted">{item.startTime}</span>}
                        {item.locationName && <span className="ml-2 tm-muted">@ {item.locationName}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30" data-testid="ai-draft-privacy-note">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              当前仅在本机解析草稿，不会调用外部 AI。
              <br />
              确认导入后才会写入本地旅行。
            </p>
          </Card>

          <Button onClick={() => setShowConfirm(true)} className="w-full">
            确认导入
          </Button>
        </>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="导入行程草稿"
        body={`将创建新的本地旅行\n不会自动生成路线\n不会创建票据\n不会上传云端\n可在创建后继续编辑`}
        confirmLabel="确认导入"
        cancelLabel="取消"
        loading={importing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmImport}
        testId="ai-draft-import-confirm-dialog"
      />

      <ConfirmDialog
        open={showProxyConfirm}
        title="通过旅图服务生成草稿"
        body={`将通过旅图服务生成行程草稿\n可能消耗服务额度\n不会自动创建旅行\n生成后仍需预览和确认\n当前不会读取票据图片/PDF`}
        confirmLabel="确认生成"
        cancelLabel="取消"
        loading={proxyGenerating}
        onCancel={() => setShowProxyConfirm(false)}
        onConfirm={handleProxyConfirm}
        testId="ai-draft-generate-confirm-dialog"
      />

      <ConfirmDialog
        open={showRepairConfirm}
        title="让 AI 修复草稿"
        body={`将通过旅图服务尝试修复当前草稿\n可能消耗服务额度\n不会自动创建旅行\n不会直接覆盖已保存旅行\n修复后仍需预览和确认${repairPrivacyNotice ? `\n${repairPrivacyNotice}` : ''}`}
        confirmLabel="确认修复"
        cancelLabel="取消"
        loading={repairGenerating}
        onCancel={() => setShowRepairConfirm(false)}
        onConfirm={handleRepairConfirm}
        testId="ai-draft-repair-confirm-dialog"
      />
    </div>
  )
}
