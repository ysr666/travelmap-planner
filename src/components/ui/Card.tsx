import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_8px_22px_rgba(47,65,88,0.05)] dark:border-slate-700/70 dark:bg-slate-900/90 dark:shadow-[0_10px_28px_rgba(0,0,0,0.22)] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
