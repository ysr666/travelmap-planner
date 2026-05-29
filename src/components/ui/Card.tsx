import type { HTMLAttributes, ReactNode } from 'react'

type CardVariant = 'default' | 'grouped' | 'flat'
type CardPadding = 'none' | 'sm' | 'md' | 'lg'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
  variant?: CardVariant
  padding?: CardPadding
}

const variantClasses: Record<CardVariant, string> = {
  default: 'rounded-xl bg-surface-container border border-outline-variant/30 shadow-sm',
  grouped: 'rounded-xl bg-surface-container border border-outline-variant/30',
  flat: 'rounded-xl bg-surface-container border border-transparent',
}

const paddingClasses: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
}

export function Card({
  children,
  variant = 'default',
  padding = 'md',
  className = '',
  ...props
}: CardProps) {
  const hasPaddingOverride = /\b(?:p|px|py|pt|pr|pb|pl)-/.test(className)
  const paddingClass = hasPaddingOverride ? '' : paddingClasses[padding]

  return (
    <div
      className={`${variantClasses[variant]} ${paddingClass} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
