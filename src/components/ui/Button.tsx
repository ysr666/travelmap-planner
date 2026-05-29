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
  primary: 'bg-primary-container text-on-primary-container shadow-[0_6px_16px_var(--color-primary-shadow)]',
  secondary: 'bg-surface-container text-on-surface border border-outline-variant/30',
  ghost: 'bg-transparent text-on-surface-variant',
  destructive: 'bg-error-container text-on-error-container border border-error/20',
  subtle: 'bg-surface-container-high text-on-surface border border-outline-variant/20',
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
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 tm-focus ${variantClasses[variant]} ${className}`}
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
