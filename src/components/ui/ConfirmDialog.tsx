import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'
import { useModalAccessibility } from './useModalAccessibility'

type ConfirmDialogProps = {
  open: boolean
  title: string
  body: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  icon?: ReactNode
  tone?: 'default' | 'danger'
  testId?: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  children,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  loading = false,
  icon,
  tone = 'danger',
  testId,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useModalAccessibility({
    containerRef: dialogRef,
    initialFocusRef: cancelButtonRef,
    onClose: onCancel,
    open,
  })

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-surface-dim/40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center dark:bg-surface-dim/60"
      data-testid={testId}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-lg tm-surface">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-3">
            <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tone === 'danger' ? 'bg-red-50/80 text-red-500 dark:bg-red-500/10 dark:text-red-400' : 'bg-primary-fixed text-primary dark:bg-primary/15 dark:text-primary-fixed-dim'}`}>
              {icon || <AlertTriangle className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-semibold text-on-surface [overflow-wrap:anywhere] dark:text-on-surface" id={titleId}>
                {title}
              </h2>
              <p className="mt-1 break-words whitespace-pre-line text-sm leading-6 tm-muted [overflow-wrap:anywhere]" id={bodyId}>
                {body}
              </p>
              {children && (
                <div className="mt-3">
                  {children}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t tm-row bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:bg-surface-container-highest/95">
          <Button disabled={loading} onClick={onCancel} ref={cancelButtonRef} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            className={tone === 'danger' ? 'text-error dark:text-red-300 ring-red-100' : ''}
            loading={loading}
            onClick={onConfirm}
            variant={tone === 'danger' ? 'secondary' : 'primary'}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
