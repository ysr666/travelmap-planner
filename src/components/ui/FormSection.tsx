import type { ReactNode } from 'react'
import { DisclosureRow } from './DisclosureRow'

type FormSectionProps = {
  children: ReactNode
  className?: string
  collapsible?: boolean
  defaultOpen?: boolean
  description?: string
  title: string
}

export function FormSection({ children, className = '', collapsible = false, defaultOpen, description, title }: FormSectionProps) {
  if (collapsible) {
    return (
      <DisclosureRow className={className} defaultOpen={defaultOpen} detail={description} title={title}>
        <div className="v3-form-section-fields">{children}</div>
      </DisclosureRow>
    )
  }

  return (
    <fieldset className={`v3-form-section ${className}`}>
      <legend className="v3-form-section-title">{title}</legend>
      {description ? <p className="v3-form-section-description">{description}</p> : null}
      <div className="v3-form-section-fields">{children}</div>
    </fieldset>
  )
}
