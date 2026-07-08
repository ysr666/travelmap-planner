import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

export type IconTone = 'sky' | 'emerald' | 'amber' | 'violet' | 'rose'

const iconToneClasses: Record<IconTone, string> = {
  sky: 'bg-primary-fixed text-primary dark:bg-primary/15 dark:text-primary-fixed-dim',
  emerald: 'bg-primary-fixed text-primary dark:bg-primary/15 dark:text-primary-fixed-dim',
  amber: 'bg-tertiary-container text-tertiary dark:bg-amber-500/15 dark:text-amber-300',
  violet: 'bg-secondary-container text-secondary dark:bg-secondary/15 dark:text-secondary-fixed-dim',
  rose: 'bg-secondary-container text-secondary dark:bg-secondary/15 dark:text-secondary-fixed-dim',
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
        <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${iconClasses}`}>
          {icon}
        </div>
      ) : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold text-on-surface">
          {title}
        </span>
        {detail ? (
          <span className="mt-0.5 block line-clamp-2 text-[12px] leading-5 tm-muted">{detail}</span>
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
        className={`relative flex min-h-[56px] w-full items-center gap-3 px-2 py-3 text-left transition active:scale-[0.99] active:bg-surface-variant/50 tm-focus ${separator ? '' : ''}`}
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
