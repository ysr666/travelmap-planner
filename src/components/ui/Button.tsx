import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive' | 'subtle'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  icon?: ReactNode
  variant?: ButtonVariant
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary shadow-[0_8px_18px_var(--color-primary-shadow)]',
  secondary: 'border border-outline-variant/70 bg-surface-container text-on-surface shadow-[0_1px_2px_rgba(20,37,32,0.04)]',
  ghost: 'bg-transparent text-on-surface-variant',
  destructive: 'border border-error/20 bg-error-container text-on-error-container',
  subtle: 'border border-outline-variant/60 bg-surface-container-high text-on-surface',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  children,
  icon,
  variant = 'primary',
  loading = false,
  className = '',
  disabled,
  ...props
}: ButtonProps, ref) {
  return (
    <button
      className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-lg px-4 text-[15px] font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 tm-focus ${variantClasses[variant]} ${className}`}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      ref={ref}
      type="button"
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      <span>{children}</span>
    </button>
  )
})
