import { type ReactNode, useRef } from 'react'
import { ChevronRight } from 'lucide-react'

type CollapsibleProps = {
  title: string
  subtitle?: string
  defaultOpen?: boolean
  children: ReactNode
}

export function Collapsible({ title, subtitle, defaultOpen = false, children }: CollapsibleProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null)

  return (
    <details
      className="group rounded-2xl tm-group"
      open={defaultOpen}
      ref={detailsRef}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 select-none marker:hidden [&::-webkit-details-marker]:hidden tm-focus">
        <ChevronRight className="size-4 shrink-0 text-outline transition-transform group-open:rotate-90 dark:text-on-surface-variant" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-on-surface dark:text-on-surface">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs tm-muted">{subtitle}</p>
          ) : null}
        </div>
      </summary>
      <div className="border-t tm-row px-4 pb-4 pt-3">
        {children}
      </div>
    </details>
  )
}
