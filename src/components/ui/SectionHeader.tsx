type SectionHeaderProps = {
  eyebrow?: string
  title: string
  action?: string
  onAction?: () => void
}

export function SectionHeader({ eyebrow, title, action, onAction }: SectionHeaderProps) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.12em] tm-muted">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">
          {title}
        </h2>
      </div>
      {action ? (
        <button
          className="rounded-xl px-3 py-1.5 text-sm font-semibold text-sky-600 transition hover:bg-sky-50/80 active:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10 dark:active:bg-sky-500/10 tm-focus"
          onClick={onAction}
          type="button"
        >
          {action}
        </button>
      ) : null}
    </div>
  )
}
