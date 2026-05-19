import type { ReactNode } from 'react'

type BadgeTone = 'default' | 'success' | 'warning' | 'danger'

type BadgeProps = {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}

const toneClasses: Record<BadgeTone, string> = {
  default: 'tm-chip',
  success: 'tm-chip !bg-emerald-50 !text-emerald-700 dark:!bg-emerald-500/15 dark:!text-emerald-400',
  warning: 'tm-chip !bg-amber-50 !text-amber-700 dark:!bg-amber-500/15 dark:!text-amber-400',
  danger: 'tm-chip !bg-red-50 !text-red-600 dark:!bg-red-500/15 dark:!text-red-400',
}

export function Badge({ children, tone = 'default', className = '' }: BadgeProps) {
  return <span className={`${toneClasses[tone]} ${className}`}>{children}</span>
}
