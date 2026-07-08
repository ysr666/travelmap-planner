import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useModalAccessibility } from './useModalAccessibility'

type BottomSheetBaseProps = {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxHeight?: string
  showHandle?: boolean
  zIndex?: number
}

type BottomSheetProps = BottomSheetBaseProps & (
  | { title: string; ariaLabel?: string }
  | { title?: undefined; ariaLabel: string }
)

export function BottomSheet({
  ariaLabel,
  open,
  onClose,
  title,
  children,
  maxHeight = 'calc(100dvh - 2rem)',
  showHandle = true,
  zIndex = 50,
}: BottomSheetProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useModalAccessibility({
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    open,
  })

  if (!open) {
    return null
  }

  return createPortal(
    <div
      aria-label={title ? undefined : ariaLabel}
      aria-labelledby={title ? titleId : undefined}
      aria-modal="true"
      className="fixed inset-0 flex items-end justify-center bg-surface-dim/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm dark:bg-surface-dim/60"
      ref={dialogRef}
      role="dialog"
      style={{ zIndex }}
      tabIndex={-1}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex w-full flex-col overflow-hidden rounded-lg tm-surface"
        style={{ maxHeight }}
      >
        {showHandle ? (
          <div className="shrink-0 pt-3 pb-1 text-center">
            <div className="mx-auto h-1.5 w-11 rounded-full bg-slate-300/60 dark:bg-slate-600/60" />
          </div>
        ) : null}

        {title ? (
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3">
            <h3 className="min-w-0 flex-1 break-words text-base font-semibold text-on-surface dark:text-on-surface" id={titleId}>
              {title}
            </h3>
            <button
              aria-label="关闭"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-container/80 text-on-surface-variant transition hover:bg-surface-container-high/60 dark:bg-surface-container-highest/60 dark:text-outline dark:hover:bg-surface-container-high/50 tm-focus"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              <X className="size-5" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-4 pb-2 text-right">
            <button
              aria-label="关闭"
              className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-container/80 text-on-surface-variant transition hover:bg-surface-container-high/60 dark:bg-surface-container-highest/60 dark:text-outline dark:hover:bg-surface-container-high/50 tm-focus"
              onClick={onClose}
              ref={closeButtonRef}
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
