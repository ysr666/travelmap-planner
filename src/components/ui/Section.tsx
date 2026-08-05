import type { ReactNode } from 'react'

type SectionProps = {
  action?: ReactNode
  children: ReactNode
  className?: string
  description?: string
  title?: string
}

export function Section({ action, children, className = '', description, title }: SectionProps) {
  return (
    <section className={`v3-section ${className}`}>
      {title || action ? (
        <div className="v3-section-header">
          <div className="min-w-0">
            {title ? <h2 className="v3-section-title">{title}</h2> : null}
            {description ? <p className="v3-section-description">{description}</p> : null}
          </div>
          {action ? <div className="v3-section-action">{action}</div> : null}
        </div>
      ) : null}
      <div className="v3-section-body">{children}</div>
    </section>
  )
}
