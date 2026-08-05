import { Bot, CheckCircle2, ChevronDown, Loader2, MessagesSquare, Send, ShieldCheck, Wand2, X } from 'lucide-react'
import { useRef } from 'react'
import { useGlobalAiCommandController } from '../../hooks/useGlobalAiCommandController'
import type { RouteId } from '../../types'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  ActionGatewayView,
  AiPreviewView,
  CommandResultView,
  ConversationPanel,
  FailureRecovery,
  StatusLine,
} from './GlobalAiCommandViews'

type GlobalAiCommandBarProps = {
  activeRoute: RouteId
  fallbackTripId?: string | null
  initialCommand?: string | null
  onOpenChange: (open: boolean) => void
  open: boolean
}

export function GlobalAiCommandBar(props: GlobalAiCommandBarProps) {
  const sheetRef = useRef<HTMLDivElement>(null)
  const commandRef = useRef<HTMLTextAreaElement>(null)
  const controller = useGlobalAiCommandController({ ...props, commandRef, sheetRef })

  if (controller.hidden || !props.open) return null

  return (
    <>
      <div
        className="ai-action-layer"
        data-testid="global-ai-command-bar"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget && !controller.loading && !controller.applying) {
            controller.dismissPanel()
          }
        }}
      >
        <div
          aria-labelledby="global-ai-sheet-title"
          aria-modal="true"
          className={`ai-action-sheet ${controller.hasOutput ? 'ai-action-sheet-expanded' : ''}`}
          ref={sheetRef}
          role="dialog"
        >
          <div className="ai-action-sheet-handle" aria-hidden="true" />
          <header className="flex min-w-0 items-center gap-2 border-b border-outline-variant px-4 pb-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[17px] font-semibold leading-6 text-on-surface" id="global-ai-sheet-title">
                AI 助手
              </h2>
              <span className="block truncate text-xs leading-5 text-on-surface-variant" data-testid="global-ai-context-label">
                {controller.contextLabel}
              </span>
            </div>
            <button
              aria-label={controller.contextMode === 'current_page' ? '切换到全部旅行' : '切换到当前页面'}
              className="flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-on-surface-variant tm-focus"
              onClick={controller.toggleContextMode}
              type="button"
            >
              <span>{controller.contextMode === 'current_page' ? '当前页面' : '全部旅行'}</span>
              <ChevronDown className="size-4" />
            </button>
            <button
              aria-label="关闭 AI 助手"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-on-surface-variant tm-focus"
              disabled={controller.loading || controller.applying}
              onClick={controller.dismissPanel}
              type="button"
            >
              <X className="size-5" />
            </button>
          </header>

          <form className="flex items-end gap-2 border-b border-outline-variant px-4 py-3" onSubmit={(event) => void controller.handleSubmit(event)}>
            <textarea
              aria-label="全局 AI 指令"
              className="max-h-28 min-h-12 min-w-0 flex-1 resize-none rounded-lg border border-outline-variant bg-surface-container px-3 py-3 text-[15px] leading-[22px] text-on-surface outline-none placeholder:text-on-surface-variant/70 focus:border-primary focus:ring-2 focus:ring-primary/20"
              disabled={controller.loading || controller.applying}
              maxLength={1000}
              onChange={(event) => controller.setCommand(event.currentTarget.value)}
              placeholder="找票据、补地点或修复行程"
              ref={commandRef}
              rows={1}
              value={controller.command}
            />
            <button
              aria-label="发送 AI 指令"
              className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-primary text-on-primary transition active:scale-95 disabled:opacity-50 tm-focus"
              disabled={!controller.trimmedCommand || controller.loading || controller.applying}
              type="submit"
            >
              {controller.loading ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            </button>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 app-scrollbar">
            <div className="space-y-3">
              {controller.conversation.length > 0 ? (
                <button
                  aria-expanded={controller.expanded}
                  className="flex min-h-11 w-full items-center justify-between gap-2 border-b border-outline-variant text-left text-xs font-semibold text-on-surface-variant tm-focus"
                  onClick={() => controller.setExpanded(!controller.expanded)}
                  type="button"
                >
                  <span className="flex items-center gap-2">
                    <MessagesSquare className="size-4" />
                    最近会话
                  </span>
                  <ChevronDown className={`size-4 transition-transform ${controller.expanded ? 'rotate-180' : ''}`} />
                </button>
              ) : null}
              {controller.expanded ? (
                <ConversationPanel
                  contextMode={controller.contextMode}
                  failureRecords={controller.failureRecords}
                  messages={controller.conversation}
                  onClear={controller.clearConversation}
                  onContextModeChange={controller.setContextMode}
                />
              ) : null}
              {controller.loading ? <StatusLine icon={<Loader2 className="size-4 animate-spin" />} text="正在处理…" /> : null}
              {controller.error ? (
                <div className="space-y-2">
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-semibold leading-5 text-red-600 dark:bg-red-500/10 dark:text-red-300">{controller.error}</p>
                  <FailureRecovery
                    canRetry={Boolean(controller.lastFailedCommand)}
                    onClear={controller.clearFailure}
                    onConsult={controller.runLastFailureAsConsultation}
                    onHome={controller.goHome}
                    onRetry={controller.retryLastFailure}
                  />
                </div>
              ) : null}
              {controller.success ? <StatusLine icon={<CheckCircle2 className="size-4" />} tone="success" text={controller.success} /> : null}
              {controller.actionGateway ? (
                <ActionGatewayView
                  actionGateway={controller.actionGateway}
                  applying={controller.applying}
                  loading={controller.loading}
                  onConfirm={() => void controller.confirmActionGateway()}
                  onManualEntry={controller.manualEntry}
                  onRetry={() => void controller.retryActionGateway()}
                />
              ) : null}
              {controller.result ? (
                <CommandResultView
                  onNavigate={controller.handleNavigation}
                  onRequestWrite={controller.requestWrite}
                  onSelectReplanOption={controller.setSelectedReplanOptionId}
                  result={controller.result}
                  selectedReplanOptionId={controller.selectedReplanOptionId}
                />
              ) : null}
              {controller.aiPreview ? (
                <AiPreviewView
                  aiPreview={controller.aiPreview}
                  onApply={controller.requestAiApply}
                  onDiscard={controller.discardAiPreview}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        body={controller.pendingAiUsesSearch
          ? '我会读取脱敏后的当前旅行，并在需要实时信息时查询来源。结果先给你确认。'
          : '我会读取脱敏后的当前旅行，生成可确认的修改方案。'}
        cancelLabel="取消"
        confirmLabel="开始处理"
        icon={<Bot className="size-5" />}
        loading={controller.loading}
        onCancel={controller.closeAiSendConfirm}
        onConfirm={() => void controller.confirmAiSend()}
        open={controller.aiSendConfirmOpen}
        testId="global-ai-send-confirm-dialog"
        title="开始处理？"
        tone="default"
      />
      <ConfirmDialog
        body="将把预览写入当前旅行。写入前会校验行程是否变化。"
        cancelLabel="取消"
        confirmLabel="写入"
        icon={<Wand2 className="size-5" />}
        loading={controller.applying}
        onCancel={controller.closeAiApplyConfirm}
        onConfirm={() => void controller.confirmAiApply()}
        open={controller.aiApplyConfirmOpen}
        testId="global-ai-apply-confirm-dialog"
        title="写入修改？"
        tone="default"
      />
      <ConfirmDialog
        body={controller.writeConfirmBody}
        cancelLabel="取消"
        confirmLabel="写入"
        icon={<ShieldCheck className="size-5" />}
        loading={controller.applying}
        onCancel={controller.closeWriteConfirm}
        onConfirm={() => void controller.confirmWrite()}
        open={controller.writeConfirmOpen}
        testId="global-ai-write-confirm-dialog"
        title="写入这次修改？"
        tone="default"
      />
    </>
  )
}
