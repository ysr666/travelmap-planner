import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon: ReactNode
  title: string
  body: string
}

export function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/70 px-5 py-8 text-center">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{body}</p>
    </div>
  )
}
