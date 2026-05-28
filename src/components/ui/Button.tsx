import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'subtle'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  icon?: ReactNode
  variant?: ButtonVariant
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-[0_6px_16px_var(--color-primary-shadow)] dark:bg-primary dark:text-slate-950',
  secondary: 'bg-white text-slate-900 ring-1 ring-slate-200/80 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700/80',
  ghost: 'bg-transparent text-slate-600 dark:text-slate-300',
  destructive: 'bg-red-50 text-red-600 ring-1 ring-red-200/80 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25',
  subtle: 'bg-slate-100/70 text-slate-700 ring-1 ring-slate-200/60 dark:bg-slate-800/70 dark:text-slate-300 dark:ring-slate-700/60',
}

export function Button({
  children,
  icon,
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 tm-focus ${variantClasses[variant]} ${className}`}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      type="button"
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      <span>{children}</span>
    </button>
  )
}
