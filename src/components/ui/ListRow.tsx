import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

type ListRowProps = {
  icon?: ReactNode
  title: string
  detail?: string
  meta?: string
  onClick?: () => void
}

export function ListRow({ icon, title, detail, meta, onClick }: ListRowProps) {
  const content = (
    <>
      {icon ? (
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {icon}
        </div>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-slate-950">{title}</span>
        {detail ? <span className="block truncate text-sm text-slate-500">{detail}</span> : null}
      </span>
      {meta ? <span className="text-xs font-medium text-slate-400">{meta}</span> : null}
      {onClick ? <ChevronRight className="size-4 shrink-0 text-slate-300" /> : null}
    </>
  )

  if (onClick) {
    return (
      <button
        className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition active:bg-slate-50 dark:active:bg-slate-800/70"
        onClick={onClick}
        type="button"
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex w-full items-center gap-3 rounded-xl px-2 py-3">
      {content}
    </div>
  )
}
