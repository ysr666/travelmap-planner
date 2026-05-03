import type { ReactNode } from 'react'

type BottomDrawerProps = {
  children: ReactNode
  className?: string
}

export function BottomDrawer({ children, className = '' }: BottomDrawerProps) {
  return (
    <section
      className={`rounded-t-[30px] border-t border-white/80 bg-white/95 px-4 pt-3 shadow-[0_-18px_48px_rgba(38,53,76,0.14)] backdrop-blur-xl ${className}`}
    >
      <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200" />
      {children}
    </section>
  )
}
