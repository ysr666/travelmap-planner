import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

type ConfirmDialogProps = {
  open: boolean
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  icon?: ReactNode
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '确认删除',
  cancelLabel = '取消',
  loading = false,
  icon,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel()
      }
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onCancel])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:items-center"
      role="dialog"
    >
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_18px_48px_rgba(38,53,76,0.18)]">
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              {icon || <AlertTriangle className="size-5" />}
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-base font-semibold text-slate-950 [overflow-wrap:anywhere]">
                {title}
              </h2>
              <p className="mt-1 break-words text-sm leading-6 text-slate-500 [overflow-wrap:anywhere]">
                {body}
              </p>
            </div>
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-3 border-t border-slate-100 bg-white/95 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button disabled={loading} onClick={onCancel} variant="secondary">
            {cancelLabel}
          </Button>
          <Button
            className="text-red-600 ring-red-100"
            loading={loading}
            onClick={onConfirm}
            variant="secondary"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
