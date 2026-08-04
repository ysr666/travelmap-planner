import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

type DisclosureRowProps = {
  children: ReactNode
  className?: string
  defaultOpen?: boolean
  detail?: string
  icon?: ReactNode
  title: string
}

export function DisclosureRow({ children, className = '', defaultOpen = false, detail, icon, title }: DisclosureRowProps) {
  return (
    <details className={`v3-disclosure ${className}`} open={defaultOpen || undefined}>
      <summary className="v3-disclosure-summary tm-focus">
        {icon ? <span aria-hidden="true" className="v3-disclosure-icon">{icon}</span> : null}
        <span className="v3-disclosure-copy">
          <span className="v3-disclosure-title">{title}</span>
          {detail ? <span className="v3-disclosure-detail">{detail}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className="v3-disclosure-chevron" />
      </summary>
      <div className="v3-disclosure-body">{children}</div>
    </details>
  )
}
