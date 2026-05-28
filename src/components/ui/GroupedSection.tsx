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
        <h3 className="px-1 text-[12px] text-outline uppercase tracking-wider">
          {title}
        </h3>
      ) : null}
      <Card variant="grouped" padding="none">
        <div className="relative">
          {children}
        </div>
      </Card>
    </section>
  )
}
