import type { ReactNode } from 'react'

type EmptyStateProps = {
  icon: ReactNode
  title: string
  body: string
}

export function EmptyState({ icon, title, body }: EmptyStateProps) {
  return (
    <div className="rounded-lg border border-dashed border-outline-variant/70 bg-surface-container px-5 py-8 text-center dark:border-outline-variant/50 dark:bg-surface-container-highest/40">
      <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-lg bg-primary-fixed text-primary dark:bg-primary/15 dark:text-primary-fixed-dim">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-on-surface dark:text-on-surface">
        {title}
      </h3>
      <p className="mt-1 text-sm leading-6 tm-muted">{body}</p>
    </div>
  )
}
