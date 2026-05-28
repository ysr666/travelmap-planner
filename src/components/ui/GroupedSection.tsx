import type { ReactNode } from 'react'
import { Card } from './Card'

type GroupedSectionProps = {
  title?: string
  children: ReactNode
  className?: string
}

export function GroupedSection({ title, children, className = '' }: GroupedSectionProps) {
  return (
    <section className={`space-y-2 ${className}`}>
      {title ? (
        <h3 className="px-1 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
          {title}
        </h3>
      ) : null}
      <Card variant="grouped" padding="none">
        <div className="divide-y tm-separator">
          {children}
        </div>
      </Card>
    </section>
  )
}
