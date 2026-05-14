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
      className="group rounded-xl bg-white ring-1 ring-slate-200/80"
      open={defaultOpen}
      ref={detailsRef}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 select-none marker:hidden [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-950">{title}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>
          ) : null}
        </div>
      </summary>
      <div className="border-t border-slate-100 px-4 pb-4 pt-3">
        {children}
      </div>
    </details>
  )
}
