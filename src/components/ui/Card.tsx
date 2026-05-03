import type { HTMLAttributes, ReactNode } from 'react'

type CardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export function Card({ children, className = '', ...props }: CardProps) {
  return (
    <div
      className={`rounded-[24px] border border-white/80 bg-white/92 p-4 shadow-[0_16px_34px_rgba(47,65,88,0.08)] backdrop-blur ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}
