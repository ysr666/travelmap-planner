import { useEffect, useState } from 'react'
import { ExternalLink, FileArchive, LoaderCircle, X } from 'lucide-react'
import { getTicketBlob } from '../db'
import { formatFileSize, ticketFileTypeLabels } from '../lib/tickets'
import type { TicketMeta } from '../types'
import { Button } from './ui/Button'

type TicketPreviewProps = {
  ticket: TicketMeta
  onClose: () => void
}

export function TicketPreview({ ticket, onClose }: TicketPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isActive = true
    let nextObjectUrl: string | null = null

    async function loadBlob() {
      try {
        const record = await getTicketBlob(ticket.id)
        if (!record) {
          throw new Error('文件内容缺失，可能是备份不完整。')
        }

        nextObjectUrl = URL.createObjectURL(record.blob)
        if (!isActive) {
          URL.revokeObjectURL(nextObjectUrl)
          return
        }

        setObjectUrl(nextObjectUrl)
      } catch (caught) {
        if (isActive) {
          setError(caught instanceof Error ? caught.message : '读取票据文件失败')
        }
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadBlob()

    return () => {
      isActive = false
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl)
      }
    }
  }, [ticket.id])

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px] rounded-t-[30px] border-t border-white/80 bg-white p-4 shadow-[0_-18px_48px_rgba(38,53,76,0.22)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-600">{ticketFileTypeLabels[ticket.fileType]}</p>
          <h3 className="mt-1 truncate text-lg font-bold text-slate-950">{ticket.fileName}</h3>
          <p className="mt-1 text-xs text-slate-400">
            {ticket.mimeType || '未知类型'} · {formatFileSize(ticket.size)}
          </p>
        </div>
        <button
          aria-label="关闭预览"
          className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-slate-50 text-slate-500"
          onClick={onClose}
          type="button"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="max-h-[62dvh] overflow-auto rounded-2xl bg-slate-50">
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center text-slate-400">
            <LoaderCircle className="size-5 animate-spin" />
          </div>
        ) : null}

        {error ? (
          <p className="min-h-40 px-4 py-8 text-center text-sm leading-6 text-red-500">{error}</p>
        ) : null}

        {!isLoading && !error && objectUrl ? (
          <PreviewContent objectUrl={objectUrl} ticket={ticket} />
        ) : null}
      </div>
    </div>
  )
}

function PreviewContent({ ticket, objectUrl }: { ticket: TicketMeta; objectUrl: string }) {
  if (ticket.fileType === 'image') {
    return (
      <img
        alt={ticket.fileName}
        className="max-h-[62dvh] w-full object-contain"
        src={objectUrl}
      />
    )
  }

  if (ticket.fileType === 'pdf') {
    return (
      <div className="space-y-3 p-3">
        <iframe className="h-[54dvh] w-full rounded-xl bg-white" src={objectUrl} title={ticket.fileName} />
        <a
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#1677ff] px-3 text-sm font-semibold text-white"
          href={objectUrl}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-4" />
          新标签打开 PDF
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4 text-center">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-white text-slate-500">
        <FileArchive className="size-7" />
      </div>
      <p className="text-sm leading-6 text-slate-500">此文件类型暂不支持内嵌预览。</p>
      <Button onClick={() => window.open(objectUrl, '_blank', 'noopener,noreferrer')}>
        打开/下载文件
      </Button>
    </div>
  )
}
