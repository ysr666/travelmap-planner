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
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="mt-1 text-base font-semibold text-slate-950">{title}</h2>
      </div>
      {action ? (
        <button
          className="rounded-xl px-3 py-1.5 text-sm font-semibold text-sky-600 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 active:bg-sky-50 dark:text-sky-300 dark:hover:bg-sky-500/10 dark:active:bg-sky-500/10"
          onClick={onAction}
          type="button"
        >
          {action}
        </button>
      ) : null}
    </div>
  )
}
