import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon: ReactNode
  title: string
  body: string
}

export function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200/80 bg-slate-50/50 px-5 py-8 text-center dark:border-slate-700/50 dark:bg-slate-900/40">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-sky-50/80 text-sky-500 dark:bg-sky-500/10 dark:text-sky-400">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
        {title}
      </h3>
      <p className="mt-1 text-sm leading-6 tm-muted">{body}</p>
    </div>
  )
}
