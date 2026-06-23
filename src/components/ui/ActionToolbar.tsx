import type { ReactNode } from 'react'

type ActionToolbarProps = {
  align?: 'between' | 'end' | 'start'
  ariaLabel?: string
  children: ReactNode
  className?: string
}

const alignClasses: Record<NonNullable<ActionToolbarProps['align']>, string> = {
  between: 'justify-between',
  end: 'justify-end',
  start: 'justify-start',
}

export function ActionToolbar({
  align = 'start',
  ariaLabel,
  children,
  className = '',
}: ActionToolbarProps) {
  return (
    <div
      aria-label={ariaLabel}
      className={`flex flex-wrap items-center gap-2 ${alignClasses[align]} ${className}`}
      role={ariaLabel ? 'group' : undefined}
    >
      {children}
    </div>
  )
}
