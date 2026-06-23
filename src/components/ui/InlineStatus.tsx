import type { ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'

export type InlineStatusTone = 'error' | 'info' | 'neutral' | 'success' | 'warning'

type InlineStatusProps = {
  children: ReactNode
  className?: string
  icon?: ReactNode
  role?: 'alert' | 'note' | 'status'
  size?: 'sm' | 'md'
  tone?: InlineStatusTone
}

const toneClasses: Record<InlineStatusTone, string> = {
  error: 'border-red-100 bg-red-50 text-red-700 dark:border-red-500/25 dark:bg-red-500/10 dark:text-red-300',
  info: 'border-sky-100 bg-sky-50 text-sky-800 dark:border-sky-500/25 dark:bg-sky-500/10 dark:text-sky-200',
  neutral: 'border-slate-100 bg-slate-50 text-slate-700 dark:border-slate-700/60 dark:bg-slate-900/40 dark:text-slate-300',
  success: 'border-emerald-100 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-200',
  warning: 'border-amber-100 bg-amber-50 text-amber-900 dark:border-amber-700/35 dark:bg-amber-500/10 dark:text-amber-100',
}

const sizeClasses: Record<NonNullable<InlineStatusProps['size']>, string> = {
  sm: 'px-3 py-2 text-xs leading-5',
  md: 'px-4 py-3 text-sm leading-6',
}

export function InlineStatus({
  children,
  className = '',
  icon,
  role,
  size = 'sm',
  tone = 'neutral',
}: InlineStatusProps) {
  return (
    <div
      className={`flex items-start gap-2 rounded-xl border font-medium ${toneClasses[tone]} ${sizeClasses[size]} ${className}`}
      role={role}
    >
      <span aria-hidden="true" className="mt-0.5 shrink-0">{icon ?? getDefaultIcon(tone)}</span>
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{children}</span>
    </div>
  )
}

function getDefaultIcon(tone: InlineStatusTone) {
  if (tone === 'success') return <CheckCircle2 className="size-4" />
  if (tone === 'warning' || tone === 'error') return <AlertTriangle className="size-4" />
  return <Info className="size-4" />
}
