export function SkeletonLine({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`h-4 animate-pulse rounded-full bg-slate-100/80 dark:bg-slate-800/60 ${className}`}
    />
  )
}
