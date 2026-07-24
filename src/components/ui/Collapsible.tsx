import { type ReactNode, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

type CollapsibleProps = {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
  className?: string
  testId?: string
}

export function Collapsible({
  title,
  subtitle,
  defaultOpen = false,
  children,
  className = '',
  testId,
}: CollapsibleProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)

  return (
    <details
      className={`group rounded-lg tm-group ${className}`}
      data-testid={testId}
      open={defaultOpen}
      ref={detailsRef}
    >
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-3 select-none marker:hidden [&::-webkit-details-marker]:hidden tm-focus">
        <ChevronRight className="size-4 shrink-0 text-outline transition-transform group-open:rotate-90 dark:text-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-on-surface dark:text-on-surface">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 line-clamp-2 text-xs leading-5 tm-muted">{subtitle}</p>
          ) : null}
        </div>
      </summary>
      <div className="border-t tm-row px-4 pb-4 pt-3">
        {children}
      </div>
    </details>
  )
}
