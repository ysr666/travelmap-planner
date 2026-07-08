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
  const shouldLoadPreview = (ticket.fileType === 'image' || ticket.fileType === 'pdf') && storageMode === 'copy'

  const [preview, setPreview] = useState<{ ticketId: string; url: string } | null>(null)
  const [previewErrorTicketId, setPreviewErrorTicketId] = useState<string | null>(null)

  useEffect(() => {
    if (!shouldLoadPreview) {
      return
    }

    let cancelled = false
    let currentUrl: string | null = null

    void getTicketBlob(ticket.id).then(async (record) => {
      if (cancelled || !record?.blob) return
      if (ticket.fileType === 'image') {
        const url = URL.createObjectURL(record.blob)
        currentUrl = url
        setPreview({ ticketId: ticket.id, url })
        setPreviewErrorTicketId(null)
        return
      }
      const url = await renderPdfFirstPageThumbnail(record.blob)
      if (cancelled) return
      setPreview({ ticketId: ticket.id, url })
      setPreviewErrorTicketId(null)
    }).catch(() => {
      if (!cancelled) setPreviewErrorTicketId(ticket.id)
    })

    return () => {
      cancelled = true
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl)
      }
    }
  }, [ticket.fileType, ticket.id, shouldLoadPreview])

  const showPreview = shouldLoadPreview && preview?.ticketId === ticket.id && previewErrorTicketId !== ticket.id

  return (
    <div
      className={`relative overflow-hidden rounded-xl ring-1 ring-slate-100 dark:ring-slate-800 ${className}`}
    >
      {showPreview ? (
        <>
          <img
            alt={ticket.title || ticket.fileName || '票据缩略图'}
            className="size-full object-cover"
            loading="lazy"
            onError={() => setPreviewErrorTicketId(ticket.id)}
            src={preview.url}
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

async function renderPdfFirstPageThumbnail(blob: Blob) {
  const pdfjs = await import('pdfjs-dist')
  const workerModule = await import('pdfjs-dist/build/pdf.worker.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
  const loadingTask = pdfjs.getDocument({ data: await blob.arrayBuffer() })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const baseViewport = page.getViewport({ scale: 1 })
  const largestSide = Math.max(baseViewport.width, baseViewport.height)
  const scale = largestSide > 0 ? Math.min(1.8, Math.max(0.7, 420 / largestSide)) : 1
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvas, viewport }).promise
  return canvas.toDataURL('image/png')
}
