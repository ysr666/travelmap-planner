import { useEffect, useState } from 'react'
import { FileArchive, FileImage, FileText, Link2, MapPinned } from 'lucide-react'
import { getTicketBlob } from '../../db'
import { getTicketDisplayMeta, type TicketDisplayIconKind, type TicketDisplayToneKey } from '../../lib/ticketDisplay'
import { getTicketStorageMode } from '../../lib/tickets'
import type { TicketMeta } from '../../types'

const thumbnailToneClasses: Record<TicketDisplayToneKey, string> = {
  amber: 'bg-amber-50 text-amber-600 ring-amber-100 dark:bg-amber-950/35 dark:text-amber-300 dark:ring-amber-900/50',
  rose: 'bg-rose-50 text-rose-600 ring-rose-100 dark:bg-rose-950/35 dark:text-rose-300 dark:ring-rose-900/50',
  sky: 'bg-sky-50 text-sky-600 ring-sky-100 dark:bg-sky-950/35 dark:text-sky-300 dark:ring-sky-900/50',
  slate: 'bg-slate-50 text-slate-500 ring-slate-100 dark:bg-slate-900/60 dark:text-slate-400 dark:ring-slate-800',
  violet: 'bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-950/35 dark:text-violet-300 dark:ring-violet-900/50',
}

function renderThumbnailIcon(iconKind: TicketDisplayIconKind) {
  switch (iconKind) {
    case 'image':
      return <FileImage className="size-8" />
    case 'pdf':
      return <FileText className="size-8" />
    case 'reference':
      return <MapPinned className="size-8" />
    case 'external':
      return <Link2 className="size-8" />
    default:
      return <FileArchive className="size-8" />
  }
}

export function TicketThumbnail({
  ticket,
  className = '',
}: {
  ticket: TicketMeta
  className?: string
}) {
  const visual = getTicketDisplayMeta(ticket)
  const storageMode = getTicketStorageMode(ticket)
  const shouldLoadImage = ticket.fileType === 'image' && storageMode === 'copy'

  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)

  useEffect(() => {
    if (!shouldLoadImage) {
      return
    }

    let cancelled = false
    let currentUrl: string | null = null

    void getTicketBlob(ticket.id).then((record) => {
      if (cancelled || !record?.blob) return
      const url = URL.createObjectURL(record.blob)
      currentUrl = url
      setObjectUrl(url)
      setImageError(false)
    })

    return () => {
      cancelled = true
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [ticket.id, shouldLoadImage])

  const showImage = shouldLoadImage && objectUrl && !imageError

  return (
    <div
      className={`relative overflow-hidden rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 ${className}`}
    >
      {showImage ? (
        <>
          <img
            alt={ticket.title || ticket.fileName || '票据缩略图'}
            className="size-full object-cover"
            loading="lazy"
            onError={() => setImageError(true)}
            src={objectUrl}
          />
          <span className="absolute bottom-1 left-1 rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white backdrop-blur-sm">
            {visual.typeLabel}
          </span>
        </>
      ) : (
        <div className={`flex size-full flex-col items-center justify-center gap-1 ${thumbnailToneClasses[visual.toneKey]}`}>
          {renderThumbnailIcon(visual.iconKind)}
          <span className="text-[11px] font-bold leading-none">{visual.typeLabel}</span>
        </div>
      )}
    </div>
  )
}
