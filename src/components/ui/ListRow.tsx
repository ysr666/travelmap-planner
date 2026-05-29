import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export type IconTone = 'sky' | 'emerald' | 'amber' | 'violet' | 'rose'

const iconToneClasses: Record<IconTone, string> = {
  sky: 'bg-sky-100/80 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400',
  emerald: 'bg-emerald-100/80 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400',
  amber: 'bg-amber-100/80 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
  violet: 'bg-violet-100/80 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400',
  rose: 'bg-rose-100/80 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400',
}

type ListRowProps = {
  icon?: ReactNode
  title: string
  detail?: string
  meta?: string
  onClick?: () => void
  separator?: boolean
  iconTone?: IconTone
}

export function ListRow({ icon, title, detail, meta, onClick, separator = false, iconTone }: ListRowProps) {
  const iconClasses = iconTone
    ? iconToneClasses[iconTone]
    : 'bg-surface-container/80 text-on-surface-variant dark:bg-surface-container-highest/60 dark:text-outline'

  const content = (
    <>
      {icon ? (
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-full ${iconClasses}`}>
          {icon}
        </div>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold text-on-surface">
          {title}
        </span>
        {detail ? (
          <span className="block truncate text-[12px] tm-muted">{detail}</span>
        ) : null}
      </span>
      {meta ? <span className="text-xs font-medium tm-muted">{meta}</span> : null}
      {onClick ? (
        <ChevronRight className="size-4 shrink-0 text-outline-variant" />
      ) : null}
    </>
  )

  if (onClick) {
    return (
      <button
        className={`relative flex min-h-[56px] w-full items-center gap-3 px-2 py-3 text-left transition active:bg-surface-variant/50 tm-focus ${separator ? '' : ''}`}
        onClick={onClick}
        type="button"
      >
        {content}
        {separator ? <div className="absolute bottom-0 left-[60px] right-0 h-[0.5px] bg-outline-variant/30" /> : null}
      </button>
    )
  }

  return (
    <div className={`relative flex min-h-[56px] w-full items-center gap-3 px-2 py-3`}>
      {content}
      {separator ? <div className="absolute bottom-0 left-[60px] right-0 h-[0.5px] bg-outline-variant/30" /> : null}
    </div>
  )
}
