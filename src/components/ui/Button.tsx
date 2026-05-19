import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  icon?: ReactNode
  variant?: ButtonVariant
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white shadow-[0_6px_16px_var(--color-primary-shadow)]',
  secondary: 'bg-white text-slate-900 ring-1 ring-slate-200/80 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700/80',
  ghost: 'bg-transparent text-slate-600 dark:text-slate-300',
  destructive: 'bg-red-50 text-red-600 ring-1 ring-red-200/80 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25',
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 tm-focus ${variantClasses[variant]} ${className}`}
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
