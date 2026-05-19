import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

type BottomSheetProps = {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  maxHeight?: string
  showHandle?: boolean
  zIndex?: number
}

export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeight = 'calc(100dvh - 2rem)',
  showHandle = true,
  zIndex = 50,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  useEffect(() => {
    if (!open) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 flex items-end justify-center bg-slate-950/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:bg-slate-950/60"
      role="dialog"
      style={{ zIndex }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-3xl tm-surface"
        style={{ maxHeight }}
      >
        {showHandle ? (
          <div className="shrink-0 pt-3 pb-1 text-center">
            <div className="mx-auto h-1.5 w-11 rounded-full bg-slate-300/60 dark:bg-slate-600/60" />
          </div>
        ) : null}

        {title ? (
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900 dark:text-slate-100">
              {title}
            </h3>
            <button
              aria-label="关闭"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/80 text-slate-500 transition hover:bg-slate-200/60 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700/50 tm-focus"
              onClick={onClose}
              type="button"
            >
              <X className="size-5" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-4 pb-2 text-right">
            <button
              aria-label="关闭"
              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/80 text-slate-500 transition hover:bg-slate-200/60 dark:bg-slate-800/60 dark:text-slate-400 dark:hover:bg-slate-700/50 tm-focus"
              onClick={onClose}
              type="button"
            >
              <X className="size-5" />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}
