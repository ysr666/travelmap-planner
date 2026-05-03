import type { ReactNode } from 'react'
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
  if (!open) {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] items-end justify-center bg-slate-950/24 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
      <div className="w-full rounded-2xl border border-white/80 bg-white p-4 shadow-[0_-10px_28px_rgba(38,53,76,0.14)]">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            {icon || <AlertTriangle className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
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
    </div>
  )
}
