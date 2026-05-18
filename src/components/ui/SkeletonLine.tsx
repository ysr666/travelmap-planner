export function SkeletonLine({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`h-4 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800 ${className}`} />
}
