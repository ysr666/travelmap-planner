import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  icon?: ReactNode
  variant?: ButtonVariant
  loading?: boolean
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-[#1677ff] text-white shadow-[0_10px_24px_rgba(22,119,255,0.24)]',
  secondary: 'bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm',
  ghost: 'bg-transparent text-slate-600',
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`}
      disabled={disabled || loading}
      type="button"
      {...props}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      <span>{children}</span>
    </button>
  )
}
