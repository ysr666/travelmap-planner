import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_8px_22px_rgba(47,65,88,0.05)] ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
