import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

type RecordRowProps = {
  action?: ReactNode
  children?: ReactNode
  className?: string
  leading?: ReactNode
  meta?: ReactNode
  onClick?: () => void
  subtitle?: ReactNode
  title: ReactNode
}

export function RecordRow({ action, children, className = '', leading, meta, onClick, subtitle, title }: RecordRowProps) {
  const content = (
    <>
      {leading ? <span className="v3-record-leading">{leading}</span> : null}
      <span className="v3-record-content">
        <span className="v3-record-title">{title}</span>
        {subtitle ? <span className="v3-record-subtitle">{subtitle}</span> : null}
        {children}
      </span>
      {meta ? <span className="v3-record-meta">{meta}</span> : null}
      {action ?? (onClick ? <ChevronRight aria-hidden="true" className="v3-record-chevron" /> : null)}
    </>
  )

  if (onClick) {
    return (
      <button className={`v3-record-row tm-focus ${className}`} onClick={onClick} type="button">
        {content}
      </button>
    )
  }

  return <div className={`v3-record-row ${className}`}>{content}</div>
}
