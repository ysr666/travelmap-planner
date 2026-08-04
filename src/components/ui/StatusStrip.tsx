import type { ReactNode } from 'react'

type StatusStripProps = {
  action?: ReactNode
  children: ReactNode
  className?: string
  icon?: ReactNode
  tone?: 'danger' | 'neutral' | 'success' | 'warning'
}

export function StatusStrip({ action, children, className = '', icon, tone = 'neutral' }: StatusStripProps) {
  return (
    <div className={`v3-status-strip v3-status-strip-${tone} ${className}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon ? <span aria-hidden="true" className="v3-status-icon">{icon}</span> : null}
      <span className="v3-status-copy">{children}</span>
      {action ? <span className="v3-status-action">{action}</span> : null}
    </div>
  )
}
