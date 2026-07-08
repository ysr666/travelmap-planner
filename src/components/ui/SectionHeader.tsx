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
          <p className="text-xs font-semibold text-on-surface-variant">
            {eyebrow}
          </p>
        ) : null}
        <h2 className={`text-sm font-semibold text-on-surface ${eyebrow ? 'mt-0.5' : ''}`}>
          {title}
        </h2>
      </div>
      {action ? (
        <button
          className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-primary transition hover:bg-primary-fixed active:bg-primary-fixed-dim dark:text-primary-fixed-dim dark:hover:bg-primary/10 dark:active:bg-primary/15 tm-focus"
          onClick={onAction}
          type="button"
        >
          {action}
        </button>
      ) : null}
    </div>
  )
}
