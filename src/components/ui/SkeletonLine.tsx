export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-4 animate-pulse rounded-full bg-surface-container/80 dark:bg-surface-container-highest/60 ${className}`}
    />
  )
}
