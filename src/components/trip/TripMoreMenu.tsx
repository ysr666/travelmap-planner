import { useId, useRef, useState, type ReactNode } from 'react'
import { Archive, Home, MoreHorizontal, Settings, Ticket, X } from 'lucide-react'
import { navigateTo } from '../../lib/routes'
import { useModalAccessibility } from '../ui/useModalAccessibility'

type TripMoreMenuProps = {
  tripId: string
}

export function TripMoreMenu({ tripId }: TripMoreMenuProps) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()

  useModalAccessibility({
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose: () => setOpen(false),
    open,
  })

  return (
    <>
      <button
        aria-label="更多"
        className="flex size-11 items-center justify-center rounded-xl bg-white/88 text-on-surface ring-1 ring-outline-variant/30/80 backdrop-blur active:scale-[0.98]"
        onClick={() => setOpen(true)}
        type="button"
      >
        <MoreHorizontal className="size-5" />
      </button>

      {open ? (
        <div
          aria-labelledby={titleId}
          aria-modal="true"
          className="fixed inset-0 z-50 mx-auto flex max-w-[430px] items-end bg-surface-dim/24 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <div className="w-full rounded-2xl border border-white/80 bg-white p-2 shadow-[0_-10px_28px_rgba(38,53,76,0.14)]" data-testid="trip-more-menu">
            <h2 className="sr-only" id={titleId}>更多操作</h2>
            <button
              aria-label="关闭更多操作菜单"
              className="mb-1 flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-sm font-semibold text-on-surface-variant active:bg-surface-container-low tm-focus"
              onClick={() => setOpen(false)}
              ref={closeButtonRef}
              type="button"
            >
              更多
              <X className="size-4" />
            </button>
            <MenuItem icon={<Ticket className="size-4" />} label="全部票据" onClick={() => navigateTo('tickets', { tripId })} />
            <MenuItem icon={<Archive className="size-4" />} label="同步与归档" onClick={() => navigateTo('trip', { tripId, view: 'overview' })} />
            <MenuItem icon={<Settings className="size-4" />} label="设置" onClick={() => navigateTo('settings')} />
            <MenuItem icon={<Home className="size-4" />} label="返回首页" onClick={() => navigateTo('home')} />
          </div>
        </div>
      ) : null}
    </>
  )
}

function MenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-on-surface active:bg-surface-container-low"
      onClick={onClick}
      type="button"
    >
      <span className="flex size-8 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant">
        {icon}
      </span>
      {label}
    </button>
  )
}
