import { ImageOff } from 'lucide-react'

export function MediaFallback({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-full items-center justify-center bg-surface-container-low text-on-surface-variant ${className}`}
      data-testid="media-fallback"
    >
      <ImageOff className="size-5 opacity-55" />
    </span>
  )
}
