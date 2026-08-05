import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Collapsible } from './ui/Collapsible'
import { FormField, FIELD_INPUT_CLASS, FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS } from './ui/FormField'
import { AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS, type AiTripDraftQualityFinding } from '../lib/ai/aiTripDraftQuality'
import type { TransportMode } from '../types'
import type { AiDraftController } from '../hooks/useAiDraftController'
import { AiDraftImportCheckPanel, AiDraftRequestFrame } from './ai/AiDraftImportViews'
import { AiDraftMapPreviewCard } from './ai/AiDraftMapPreviewCard'
import {
  AiDraftVariantCard,
  AiDraftVariantComparisonPanel,
} from './ai/AiDraftVariantViews'
import {
  formatPlaceLookupCandidateCoordinate,
  getAiDraftVariantLabel,
} from './ai/aiDraftPresentation'

const INTEREST_TAGS = ['亲子', '美食', '历史文化', '自然风景', '购物', '博物馆', '夜景', '轻徒步', '摄影', '温泉']

export function AiDraftWorkspace({ controller }: { controller: AiDraftController }) {
  const {
    activeMapOrderAdjustment,
    activeMapPreview,
    activeMissingCoordinateLookupItems,
    addDraftDayTip,
    addDraftItem,
    applyActiveMapOrderAdjustment,
    canImportDraft,
    clearSelectedQualityFindings,
    confirmApplyDraftPlaceCandidate,
    dayRefineGuidance,
    draft,
    draftDateOptions,
    draftImportCheck,
    draftPlaceLookupApplyError,
    draftPlaceLookups,
    errors,
    generationOptionsOpen,
    handleBuildMixedVariantDraft,
    handleConfirmImport,
    handleDayRefineConfirm,
    handleGenerateMock,
    handleLoadSample,
    handleParse,
    handleProxyConfirm,
    handleRangeRefineConfirm,
    handleRepairConfirm,
    handleSelectVariantDraft,
    handleVariantConfirm,
    handleVariantRetryConfirm,
    importing,
    jsonText,
    mapOrderMessage,
    mapPreviewDays,
    moveDraftItem,
    openDayRefine,
    openDraftPlaceCandidate,
    openRangeRefineConfirm,
    pendingDayRefine,
    pendingDraftPlaceCandidate,
    pendingVariantRetry,
    proxyConfig,
    proxyError,
    proxyGenerating,
    qualityFindingGroups,
    qualityFindings,
    qualityResult,
    rangeRefineAvoid,
    rangeRefineEndDate,
    rangeRefineFreeText,
    rangeRefineGuidance,
    rangeRefineInterestTags,
    rangeRefineInterestText,
    rangeRefineMustVisit,
    rangeRefinePace,
    rangeRefinePartySize,
    rangeRefinePreferTransport,
    rangeRefineStartDate,
    refineError,
    refineGenerating,
    refineSuccessMessage,
    removeDraftDayTip,
    removeDraftItem,
    repairError,
    repairGenerating,
    repairPrivacyNotice,
    repairSuccessMessage,
    repairableQualityFindings,
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
    requestSettingsOpen,
    requestStartDate,
    searchDraftPlaceCandidates,
    selectAllRepairableQualityFindings,
    selectedQualityFindingIds,
    selectedQualityRepairCount,
    setActiveMapPreviewDate,
    setDayRefineGuidance,
    setGenerationOptionsOpen,
    setJsonText,
    setPendingDayRefine,
    setPendingDraftPlaceCandidate,
    setPendingVariantRetry,
    setRangeRefineAvoid,
    setRangeRefineEndDate,
    setRangeRefineFreeText,
    setRangeRefineGuidance,
    setRangeRefineInterestTags,
    setRangeRefineInterestText,
    setRangeRefineMustVisit,
    setRangeRefinePace,
    setRangeRefinePartySize,
    setRangeRefinePreferTransport,
    setRangeRefineStartDate,
    setRequestAvoid,
    setRequestDayCount,
    setRequestDestination,
    setRequestFreeText,
    setRequestInterestTags,
    setRequestInterestText,
    setRequestMustVisit,
    setRequestPace,
    setRequestPartySize,
    setRequestPreferTransport,
    setRequestSettingsOpen,
    setRequestStartDate,
    setShowConfirm,
    setShowProxyConfirm,
    setShowRangeRefineConfirm,
    setShowRepairConfirm,
    setShowVariantConfirm,
    showConfirm,
    showProxyConfirm,
    showRangeRefineConfirm,
    showRepairConfirm,
    showVariantConfirm,
    summary,
    toggleQualityFinding,
    updateDraftDay,
    updateDraftDayTip,
    updateDraftItem,
    updateDraftRoot,
    updateVariantMixSelection,
    variantComparisons,
    variantGenerating,
    variantMixDays,
    variantMixError,
    variantMixSelection,
    variantStates,
  } = controller
  return (
    <div className={`mx-auto w-full space-y-4 pb-4 ${draft ? 'max-w-4xl' : 'max-w-lg'}`} data-testid="ai-draft-page">
      <AiDraftRequestFrame
        collapsed={Boolean(draft)}
        onOpenChange={setRequestSettingsOpen}
        open={requestSettingsOpen}
        subtitle={`${requestDestination || draft?.destination || '当前草稿'} · ${requestStartDate || draft?.startDate || '未定日期'} · ${requestDayCount || draft?.days.length || 0} 天`}
      >
        <div className="space-y-3" data-testid="ai-draft-request-form">
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
            label="天数"
            value={requestDayCount}
            onChange={setRequestDayCount}
            type="number"
            required
          />
        </div>
        <p className="px-1 text-xs tm-muted">
          {requestEndDate ? `预计 ${requestEndDate} 结束` : '选择日期和天数后计算结束日期'}
        </p>

        <Collapsible
          subtitle="同行人数、兴趣、节奏和交通"
          testId="ai-draft-preferences"
          title="旅行偏好"
        >
          <div className="space-y-3">
            <FormField
              label="同行人数"
              value={requestPartySize}
              onChange={setRequestPartySize}
              type="number"
              required
            />
            <div className="space-y-2">
              <span className={FIELD_LABEL_CLASS}>兴趣标签</span>
              <div className="flex flex-wrap gap-2" data-testid="ai-trip-builder-interest-tags">
                {INTEREST_TAGS.map((tag) => {
                  const selected = requestInterestTags.includes(tag)
                  return (
                    <button
                      className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
                        selected
                          ? 'border-primary/40 bg-primary-container text-on-primary-container'
                          : 'border-outline-variant/30 bg-surface-container text-on-surface-variant'
                      }`}
                      key={tag}
                      onClick={() => setRequestInterestTags((current) =>
                        current.includes(tag)
                          ? current.filter((item) => item !== tag)
                          : [...current, tag],
                      )}
                      type="button"
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>兴趣偏好</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                placeholder="例如：咖啡馆、建筑、适合拍照、少排队"
                value={requestInterestText}
                onChange={(e) => setRequestInterestText(e.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
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
            </div>
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

        {requestErrors.length > 0 && (
          <div className="border-l-2 border-error px-3 py-1">
            <h3 className="mb-1 text-sm font-semibold text-error">请检查输入</h3>
            <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
              {requestErrors.map((error, i) => (
                <li key={i}>{error.message}</li>
              ))}
            </ul>
          </div>
        )}

        {proxyConfig.configured ? (
          <Button
            onClick={() => setShowProxyConfirm(true)}
            className="w-full"
            disabled={variantGenerating}
            loading={proxyGenerating}
          >
            生成完整行程
          </Button>
        ) : (
          <Button disabled className="w-full" variant="secondary">
            AI 服务暂不可用
          </Button>
        )}

        <Collapsible
          onOpenChange={setGenerationOptionsOpen}
          open={generationOptionsOpen}
          subtitle="三方案对比或示例草稿"
          testId="ai-draft-generation-options"
          title="其他生成方式"
        >
          <div className="space-y-2">
            {proxyConfig.configured ? (
              <Button
                onClick={() => setShowVariantConfirm(true)}
                className="w-full"
                data-testid="ai-draft-generate-variants-action"
                disabled={proxyGenerating}
                loading={variantGenerating}
                variant="secondary"
              >
                生成三种方案
              </Button>
            ) : null}
            <Button onClick={handleGenerateMock} className="w-full" variant="secondary">
              生成本地示例草案
            </Button>
          </div>
        </Collapsible>

        {proxyError && (
          <p className="border-l-2 border-error px-3 py-1 text-sm text-error">{proxyError}</p>
        )}

        {variantStates.length > 0 && (
          <Card className="space-y-3" data-testid="ai-draft-variant-panel">
            <div className="space-y-1">
              <h3 className="font-medium text-on-surface dark:text-on-surface">多方案草案</h3>
              <p className="text-sm tm-muted">
                选择一个方案后会进入编辑和方案质量检查，其他方案会被丢弃。
              </p>
            </div>
            <AiDraftVariantComparisonPanel
              comparisons={variantComparisons}
              disabled={variantGenerating || proxyGenerating}
              mixDays={variantMixDays}
              mixError={variantMixError}
              mixSelection={variantMixSelection}
              onBuildMix={handleBuildMixedVariantDraft}
              onMixSelectionChange={updateVariantMixSelection}
            />
            <div className="space-y-3">
              {variantStates.map((state) => (
                <AiDraftVariantCard
                  key={state.definition.kind}
                  state={state}
                  disabled={variantGenerating || proxyGenerating}
                  onRetry={() => setPendingVariantRetry(state.definition.kind)}
                  onSelect={() => handleSelectVariantDraft(state)}
                />
              ))}
            </div>
          </Card>
        )}
        </div>

        <div data-testid="ai-draft-json-section">
          <Collapsible title="导入 JSON 草稿" subtitle="用于已有的结构化行程草稿">
            <div className="space-y-4">
              <div className="space-y-2">
                <textarea
                  className="h-48 w-full rounded-xl border border-outline-variant/30 p-3 font-mono text-sm tm-surface dark:border-outline-variant/30"
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
      </AiDraftRequestFrame>

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
            <h3 className="font-medium text-on-surface dark:text-on-surface">草稿摘要</h3>
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

          <AiDraftMapPreviewCard
            activePreview={activeMapPreview}
            adjustment={activeMapOrderAdjustment}
            applyError={draftPlaceLookupApplyError}
            missingCoordinateItems={activeMissingCoordinateLookupItems}
            orderMessage={mapOrderMessage?.date === activeMapPreview?.date ? mapOrderMessage.message : null}
            onActiveDateChange={setActiveMapPreviewDate}
            onApplyMapOrder={applyActiveMapOrderAdjustment}
            onSearchMissingCoordinate={(lookupItem) => void searchDraftPlaceCandidates(lookupItem)}
            onSelectPlaceCandidate={openDraftPlaceCandidate}
            placeLookupConfigured={Boolean(proxyConfig.proxyUrl)}
            placeLookups={draftPlaceLookups}
            previews={mapPreviewDays}
          />

          <Card className="space-y-3" data-testid="ai-draft-quality-card">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-on-surface dark:text-on-surface">方案质量检查</h3>
                <p className="text-sm tm-muted">{qualityResult?.summary.message ?? '未发现明显问题。'}</p>
              </div>
              {repairableQualityFindings.length > 0 && (
                <div className="flex shrink-0 gap-2">
                  <Button
                    className="min-h-11 px-3 text-xs"
                    data-testid="ai-draft-quality-select-all"
                    onClick={selectAllRepairableQualityFindings}
                    variant="ghost"
                  >
                    全选
                  </Button>
                  <Button
                    className="min-h-11 px-3 text-xs"
                    data-testid="ai-draft-quality-clear-selection"
                    onClick={clearSelectedQualityFindings}
                    variant="ghost"
                  >
                    取消
                  </Button>
                </div>
              )}
            </div>

            {qualityFindings.length === 0 && (
              <p className="text-sm text-green-700 dark:text-green-300">未发现明显问题。</p>
            )}

            {qualityFindingGroups.length > 0 && (
              <div className="space-y-3" data-testid="ai-draft-quality-findings">
                {qualityFindingGroups.map((group) => (
                  <div className="space-y-2 rounded-xl border border-outline-variant/25 bg-surface-container-high/35 p-3" key={group.category}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-on-surface dark:text-on-surface">
                        {AI_TRIP_DRAFT_QUALITY_CATEGORY_LABELS[group.category]}
                      </p>
                      <span className="rounded-full bg-surface-container-highest px-2 py-1 text-xs tm-muted">
                        {group.findings.length} 项
                      </span>
                    </div>
                    <div className="space-y-2">
                      {group.findings.map((finding) => (
                        <label
                          className="flex items-start gap-3 rounded-lg bg-surface-container px-3 py-2 text-sm ring-1 ring-outline-variant/20"
                          data-testid="ai-draft-quality-finding"
                          key={finding.id}
                        >
                          <input
                            checked={selectedQualityFindingIds.has(finding.id)}
                            className="mt-1 size-4 shrink-0"
                            data-testid="ai-draft-quality-checkbox"
                            disabled={!finding.repairable || repairGenerating}
                            onChange={() => toggleQualityFinding(finding.id)}
                            type="checkbox"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-on-surface dark:text-on-surface">{finding.title}</span>
                              <span className={qualitySeverityPillClass(finding.severity)}>
                                {qualitySeverityLabel(finding.severity)}
                              </span>
                              {finding.dayDate && <span className="text-xs tm-muted">{finding.dayDate}</span>}
                            </span>
                            <span className="mt-1 block break-words leading-6 tm-muted [overflow-wrap:anywhere]">
                              {finding.message}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
                {qualityResult && qualityResult.status !== 'clean' && (
                  <p className="text-xs text-on-surface-variant dark:text-outline">
                    这些提示不会阻止导入，请在确认前检查。
                  </p>
                )}
              </div>
            )}

            {repairableQualityFindings.length > 0 && (
              proxyConfig.configured ? (
                <Button
                  onClick={() => setShowRepairConfirm(true)}
                  variant="secondary"
                  className="w-full"
                  data-testid="ai-draft-repair-action"
                  disabled={selectedQualityRepairCount === 0}
                  loading={repairGenerating}
                >
                  修复选中问题
                  {selectedQualityRepairCount > 0 ? `（${selectedQualityRepairCount}）` : ''}
                </Button>
              ) : (
                <Button disabled className="w-full" data-testid="ai-draft-repair-action" variant="secondary">
                  当前未配置 AI 修复服务
                </Button>
              )
            )}
          </Card>

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

          <Card className="space-y-3" data-testid="ai-draft-refine-panel">
            <div className="space-y-1">
              <h3 className="font-medium text-on-surface dark:text-on-surface">调整整体偏好后再生成</h3>
              <p className="text-sm tm-muted">
                选择草案内日期范围，确认后只替换所选日期；范围外已编辑内容会保留。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>开始日期</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  data-testid="ai-draft-refine-start-date"
                  value={rangeRefineStartDate || draftDateOptions[0] || ''}
                  onChange={(event) => setRangeRefineStartDate(event.target.value)}
                >
                  {draftDateOptions.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>结束日期</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  data-testid="ai-draft-refine-end-date"
                  value={rangeRefineEndDate || draftDateOptions[draftDateOptions.length - 1] || ''}
                  onChange={(event) => setRangeRefineEndDate(event.target.value)}
                >
                  {draftDateOptions.map((date) => (
                    <option key={date} value={date}>{date}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField
                label="同行人数"
                value={rangeRefinePartySize}
                onChange={setRangeRefinePartySize}
                type="number"
              />
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>旅行节奏</span>
                <select
                  className={FIELD_SELECT_CLASS}
                  value={rangeRefinePace}
                  onChange={(event) => setRangeRefinePace(event.target.value as typeof rangeRefinePace)}
                >
                  <option value="relaxed">轻松</option>
                  <option value="moderate">适中</option>
                  <option value="compact">紧凑</option>
                </select>
              </label>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>交通偏好</span>
              <select
                className={FIELD_SELECT_CLASS}
                value={rangeRefinePreferTransport}
                onChange={(event) => setRangeRefinePreferTransport(event.target.value as typeof rangeRefinePreferTransport)}
              >
                <option value="public_transport">公共交通</option>
                <option value="walking">步行</option>
                <option value="taxi">打车</option>
                <option value="mixed">综合</option>
              </select>
            </label>
            <div className="space-y-2">
              <span className={FIELD_LABEL_CLASS}>兴趣标签</span>
              <div className="flex flex-wrap gap-2" data-testid="ai-draft-refine-interest-tags">
                {INTEREST_TAGS.map((tag) => {
                  const selected = rangeRefineInterestTags.includes(tag)
                  return (
                    <button
                      className={`min-h-11 rounded-full border px-3 text-xs font-semibold transition active:scale-[0.98] ${
                        selected
                          ? 'border-primary/40 bg-primary-container text-on-primary-container'
                          : 'border-outline-variant/30 bg-surface-container text-on-surface-variant'
                      }`}
                      key={tag}
                      onClick={() => setRangeRefineInterestTags((current) =>
                        current.includes(tag)
                          ? current.filter((item) => item !== tag)
                          : [...current, tag],
                      )}
                      type="button"
                    >
                      {tag}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>兴趣偏好</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                data-testid="ai-draft-refine-interest-text"
                value={rangeRefineInterestText}
                onChange={(event) => setRangeRefineInterestText(event.target.value)}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>想去的地方</span>
                <textarea
                  className={`${FIELD_TEXTAREA_CLASS} h-20`}
                  value={rangeRefineMustVisit}
                  onChange={(event) => setRangeRefineMustVisit(event.target.value)}
                />
              </label>
              <label className="block">
                <span className={FIELD_LABEL_CLASS}>不想要的安排</span>
                <textarea
                  className={`${FIELD_TEXTAREA_CLASS} h-20`}
                  value={rangeRefineAvoid}
                  onChange={(event) => setRangeRefineAvoid(event.target.value)}
                />
              </label>
            </div>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>补充要求</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                value={rangeRefineFreeText}
                onChange={(event) => setRangeRefineFreeText(event.target.value)}
              />
            </label>
            <label className="block">
              <span className={FIELD_LABEL_CLASS}>本次优化说明</span>
              <textarea
                className={`${FIELD_TEXTAREA_CLASS} h-20`}
                data-testid="ai-draft-refine-guidance"
                value={rangeRefineGuidance}
                onChange={(event) => setRangeRefineGuidance(event.target.value)}
              />
            </label>
            <Button
              className="w-full"
              data-testid="ai-draft-range-refine-action"
              disabled={!proxyConfig.configured || refineGenerating}
              loading={refineGenerating && showRangeRefineConfirm}
              onClick={openRangeRefineConfirm}
              variant="secondary"
            >
              调整整体偏好后再生成
            </Button>
          </Card>

          {refineSuccessMessage && (
            <Card className="border-green-200 bg-green-50/50 dark:border-green-800 dark:bg-green-950/30" data-testid="ai-draft-refine-success">
              <p className="whitespace-pre-line text-sm text-green-700 dark:text-green-300">{refineSuccessMessage}</p>
            </Card>
          )}

          {refineError && (
            <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30" data-testid="ai-draft-refine-error">
              <p className="whitespace-pre-line text-sm text-red-700 dark:text-red-300">{refineError}</p>
            </Card>
          )}

          <Card className="space-y-4" data-testid="ai-draft-preview">
            <h3 className="font-medium text-on-surface dark:text-on-surface">行程草案编辑</h3>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="旅行标题" value={draft!.title} onChange={(value) => updateDraftRoot({ title: value })} />
              <FormField label="目的地" value={draft!.destination} onChange={(value) => updateDraftRoot({ destination: value })} />
              <FormField label="开始日期" type="date" value={draft!.startDate} onChange={(value) => updateDraftRoot({ startDate: value })} />
              <FormField label="结束日期" type="date" value={draft!.endDate} onChange={(value) => updateDraftRoot({ endDate: value })} />
            </div>
            <div className="space-y-4">
              {draft!.days.map((day, dayIndex) => (
                <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-high/35 p-3" data-testid="ai-draft-day-editor" key={`${day.date}-${dayIndex}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold text-on-surface dark:text-on-surface">
                      第 {dayIndex + 1} 天
                      <span className="ml-2 text-xs font-normal tm-muted">{day.date}</span>
                    </p>
                    <Button
                      className="min-h-11 px-3 text-xs"
                      data-testid="ai-draft-day-regenerate-button"
                      disabled={!proxyConfig.configured || refineGenerating}
                      loading={refineGenerating && pendingDayRefine?.date === day.date}
                      onClick={() => openDayRefine(day)}
                      variant="secondary"
                    >
                      重新生成本日
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField
                      label={`第 ${dayIndex + 1} 天日期`}
                      onChange={(value) => updateDraftDay(dayIndex, { date: value })}
                      type="date"
                      value={day.date}
                    />
                    <FormField
                      label="每日主题"
                      onChange={(value) => updateDraftDay(dayIndex, { title: value })}
                      value={day.title ?? ''}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-on-surface dark:text-on-surface">每日提示</p>
                      <Button className="min-h-11 px-2 text-xs" onClick={() => addDraftDayTip(dayIndex)} variant="secondary">
                        添加提示
                      </Button>
                    </div>
                    {(day.tips ?? []).map((tip, tipIndex) => (
                      <div className="flex gap-2" key={tipIndex}>
                        <input
                          className={FIELD_INPUT_CLASS}
                          onChange={(event) => updateDraftDayTip(dayIndex, tipIndex, event.target.value)}
                          placeholder="例如：提前确认预约时间"
                          value={tip}
                        />
                        <Button className="min-h-11 shrink-0 px-3 text-xs" onClick={() => removeDraftDayTip(dayIndex, tipIndex)} variant="ghost">
                          删除
                        </Button>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-on-surface dark:text-on-surface">行程点</p>
                      <Button className="min-h-11 px-2 text-xs" onClick={() => addDraftItem(dayIndex)} variant="secondary">
                        添加行程点
                      </Button>
                    </div>
                    {day.items.map((item, itemIndex) => (
                      <div className="space-y-3 rounded-xl bg-surface-container px-3 py-3 ring-1 ring-outline-variant/25" data-testid="ai-draft-item-editor" key={itemIndex}>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-on-surface-variant">#{itemIndex + 1}</p>
                          <div className="flex gap-1">
                            <Button className="min-h-11 px-2 text-xs" disabled={itemIndex === 0} onClick={() => moveDraftItem(dayIndex, itemIndex, -1)} variant="ghost">
                              上移
                            </Button>
                            <Button className="min-h-11 px-2 text-xs" disabled={itemIndex === day.items.length - 1} onClick={() => moveDraftItem(dayIndex, itemIndex, 1)} variant="ghost">
                              下移
                            </Button>
                            <Button className="min-h-11 px-2 text-xs" onClick={() => removeDraftItem(dayIndex, itemIndex)} variant="ghost">
                              删除
                            </Button>
                          </div>
                        </div>
                        <FormField label="标题" value={item.title} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { title: value })} />
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="开始" type="time" value={item.startTime ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { startTime: value || undefined })} />
                          <FormField label="结束" type="time" value={item.endTime ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { endTime: value || undefined })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="地点" value={item.locationName ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { locationName: value || undefined })} />
                          <FormField label="地址" value={item.address ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { address: value || undefined })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <FormField label="纬度" type="number" value={item.lat?.toString() ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { lat: parseOptionalNumber(value) })} />
                          <FormField label="经度" type="number" value={item.lng?.toString() ?? ''} onChange={(value) => updateDraftItem(dayIndex, itemIndex, { lng: parseOptionalNumber(value) })} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className={FIELD_LABEL_CLASS}>到达交通</span>
                            <select
                              className={FIELD_SELECT_CLASS}
                              onChange={(event) => updateDraftItem(dayIndex, itemIndex, { previousTransportMode: normalizeTransportModeInput(event.target.value) })}
                              value={item.previousTransportMode ?? ''}
                            >
                              <option value="">未指定</option>
                              <option value="walk">步行</option>
                              <option value="transit">公共交通</option>
                              <option value="bus">公交</option>
                              <option value="car">驾车/打车</option>
                              <option value="train">火车</option>
                              <option value="flight">航班</option>
                              <option value="other">其他</option>
                            </select>
                          </label>
                          <FormField
                            label="交通分钟"
                            type="number"
                            value={item.previousTransportDurationMinutes?.toString() ?? ''}
                            onChange={(value) => updateDraftItem(dayIndex, itemIndex, { previousTransportDurationMinutes: parseOptionalInteger(value) })}
                          />
                        </div>
                        <label className="block">
                          <span className={FIELD_LABEL_CLASS}>交通备注</span>
                          <textarea
                            className={`${FIELD_TEXTAREA_CLASS} h-16`}
                            onChange={(event) => updateDraftItem(dayIndex, itemIndex, { previousTransportNote: event.target.value || undefined })}
                            value={item.previousTransportNote ?? ''}
                          />
                        </label>
                        <label className="block">
                          <span className={FIELD_LABEL_CLASS}>行程备注</span>
                          <textarea
                            className={`${FIELD_TEXTAREA_CLASS} h-16`}
                            onChange={(event) => updateDraftItem(dayIndex, itemIndex, { note: event.target.value || undefined })}
                            value={item.note ?? ''}
                          />
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <p className="px-1 text-xs tm-muted" data-testid="ai-draft-privacy-note">
            确认导入后才会创建旅行。
          </p>

          <Button disabled={!canImportDraft} onClick={() => setShowConfirm(true)} className="w-full">
            确认导入
          </Button>
        </>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="最终导入检查"
        body="将创建一个新旅行。路线、票据和资料可稍后继续补充。"
        confirmLabel="确认导入"
        cancelLabel="取消"
        loading={importing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmImport}
        testId="ai-draft-import-confirm-dialog"
        tone="default"
      >
        {draftImportCheck ? <AiDraftImportCheckPanel check={draftImportCheck} /> : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={showProxyConfirm}
        title="通过旅图服务生成完整行程"
        body={`将通过旅图服务生成完整行程草案\n可能消耗服务额度\n不会自动创建旅行\n生成后仍需预览和确认\n当前不会读取票据图片/PDF`}
        confirmLabel="确认生成"
        cancelLabel="取消"
        loading={proxyGenerating}
        onCancel={() => setShowProxyConfirm(false)}
        onConfirm={handleProxyConfirm}
        testId="ai-draft-generate-confirm-dialog"
      />

      <ConfirmDialog
        open={showVariantConfirm}
        title="生成三种方案"
        body={`将通过旅图服务分别生成经典游、轻松游、深度游三份草案\n会发起 3 次 AI 草案生成请求，可能消耗 3 次服务额度\n生成结果只进入多方案预览\n选择方案前不会创建旅行\n不会调用路线、地点、搜索、票据或云端服务`}
        confirmLabel="确认生成"
        cancelLabel="取消"
        loading={variantGenerating}
        onCancel={() => setShowVariantConfirm(false)}
        onConfirm={handleVariantConfirm}
        testId="ai-draft-variants-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingVariantRetry)}
        title="重新生成方案"
        body={`将通过旅图服务重新生成 ${pendingVariantRetry ? getAiDraftVariantLabel(pendingVariantRetry) : ''} 草案\n会发起 1 次 AI 草案生成请求\n只替换这个方案卡片\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认重新生成"
        cancelLabel="取消"
        loading={variantGenerating && Boolean(pendingVariantRetry)}
        onCancel={() => setPendingVariantRetry(null)}
        onConfirm={handleVariantRetryConfirm}
        testId="ai-draft-variant-retry-confirm-dialog"
      />

      <ConfirmDialog
        open={showRepairConfirm}
        title="修复选中问题"
        body={`将通过旅图服务尝试修复 ${selectedQualityRepairCount} 个选中问题\n可能消耗服务额度\n未勾选的问题和无关内容会要求保持不变\n不会自动创建旅行\n不会直接覆盖已保存旅行\n修复后仍需预览和确认${repairPrivacyNotice ? `\n${repairPrivacyNotice}` : ''}`}
        confirmLabel="确认修复"
        cancelLabel="取消"
        loading={repairGenerating}
        onCancel={() => setShowRepairConfirm(false)}
        onConfirm={handleRepairConfirm}
        testId="ai-draft-repair-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingDayRefine)}
        title="重新生成本日"
        body={`将通过旅图服务重新生成 ${pendingDayRefine?.date ?? ''} 的草案内容\n可能消耗服务额度\n只替换这一天\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认重新生成"
        cancelLabel="取消"
        loading={refineGenerating && Boolean(pendingDayRefine)}
        onCancel={() => {
          setPendingDayRefine(null)
          setDayRefineGuidance('')
        }}
        onConfirm={handleDayRefineConfirm}
        testId="ai-draft-day-refine-confirm-dialog"
      >
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>本日调整要求</span>
          <textarea
            className={`${FIELD_TEXTAREA_CLASS} h-24`}
            data-testid="ai-draft-day-refine-guidance"
            placeholder={pendingDayRefine?.title ? `例如：让“${pendingDayRefine.title}”更轻松一些` : '例如：减少购物，增加咖啡馆和休息时间'}
            value={dayRefineGuidance}
            onChange={(event) => setDayRefineGuidance(event.target.value)}
          />
        </label>
      </ConfirmDialog>

      <ConfirmDialog
        open={showRangeRefineConfirm}
        title="调整整体偏好后再生成"
        body={`将通过旅图服务优化 ${rangeRefineStartDate} 至 ${rangeRefineEndDate}\n可能消耗服务额度\n只替换所选日期范围\n范围外草案和已编辑内容会保留\n不会创建旅行、路线、票据或云端数据`}
        confirmLabel="确认优化"
        cancelLabel="取消"
        loading={refineGenerating && showRangeRefineConfirm}
        onCancel={() => setShowRangeRefineConfirm(false)}
        onConfirm={handleRangeRefineConfirm}
        testId="ai-draft-range-refine-confirm-dialog"
      />

      <ConfirmDialog
        open={Boolean(pendingDraftPlaceCandidate)}
        title="填入候选地点"
        body={`将把候选地点写入当前草案\n只更新地点名称、地址和坐标\n不会创建本地旅行\n不会写入数据库、路线缓存、票据或云端`}
        confirmLabel="填入草案"
        cancelLabel="取消"
        onCancel={() => setPendingDraftPlaceCandidate(null)}
        onConfirm={confirmApplyDraftPlaceCandidate}
        testId="ai-draft-place-lookup-confirm-dialog"
      >
        {pendingDraftPlaceCandidate ? (
          <div className="space-y-2 rounded-xl bg-surface-container px-3 py-2 text-sm">
            <p className="break-words font-semibold text-on-surface dark:text-on-surface [overflow-wrap:anywhere]">
              {pendingDraftPlaceCandidate.candidate.displayName}
            </p>
            <p className="break-words tm-muted [overflow-wrap:anywhere]">
              {pendingDraftPlaceCandidate.candidate.formattedAddress}
            </p>
            <p className="break-words text-xs tm-muted [overflow-wrap:anywhere]">
              {formatPlaceLookupCandidateCoordinate(pendingDraftPlaceCandidate.candidate)}
            </p>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}

function qualitySeverityLabel(severity: AiTripDraftQualityFinding['severity']) {
  if (severity === 'critical') return '严重'
  if (severity === 'warning') return '提醒'
  return '信息'
}

function qualitySeverityPillClass(severity: AiTripDraftQualityFinding['severity']) {
  if (severity === 'critical') {
    return 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-200'
  }
  if (severity === 'warning') {
    return 'rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-200'
  }
  return 'rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseOptionalInteger(value: string) {
  const parsed = parseOptionalNumber(value)
  if (parsed === undefined) return undefined
  return Number.isInteger(parsed) ? parsed : undefined
}

function normalizeTransportModeInput(value: string): TransportMode | undefined {
  const validModes: TransportMode[] = ['walk', 'transit', 'bus', 'car', 'train', 'flight', 'other']
  return validModes.includes(value as TransportMode) ? value as TransportMode : undefined
}
