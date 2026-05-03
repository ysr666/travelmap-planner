import { useEffect, useMemo, useState } from 'react'
import { Copy, ExternalLink, FileArchive, LoaderCircle, Share2, X } from 'lucide-react'
import { getTicketBlob } from '../db'
import {
  formatFileSize,
  getTicketDisplayTitle,
  getTicketStorageMode,
  isValidExternalUrl,
  ticketFileTypeLabels,
  ticketStorageModeLabels,
} from '../lib/tickets'
import type { TicketMeta } from '../types'
import { Button } from './ui/Button'

type TicketPreviewProps = {
  ticket: TicketMeta
  onClose: () => void
}

export function TicketPreview({ ticket, onClose }: TicketPreviewProps) {
  const storageMode = getTicketStorageMode(ticket)
  const displayTitle = getTicketDisplayTitle(ticket)
  const [objectUrl, setObjectUrl] = useState<string | null>(null)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(storageMode === 'copy')
  const [copyMessage, setCopyMessage] = useState<string | null>(null)
  const shareFile = useMemo(() => {
    if (!blob) {
      return null
    }

    return new File([blob], ticket.fileName || displayTitle, {
      type: ticket.mimeType || blob.type || 'application/octet-stream',
    })
  }, [blob, displayTitle, ticket.fileName, ticket.mimeType])
  const canShareFile =
    Boolean(shareFile) &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: shareFile ? [shareFile] : [] })

  useEffect(() => {
    let isActive = true
    let nextObjectUrl: string | null = null

    async function loadBlob() {
      if (storageMode !== 'copy') {
        setIsLoading(false)
        return
      }

      try {
        const record = await getTicketBlob(ticket.id)
        if (!record) {
          throw new Error('文件内容缺失，可能是备份不完整或仅记录了文件信息。')
        }

        nextObjectUrl = URL.createObjectURL(record.blob)
        if (!isActive) {
          URL.revokeObjectURL(nextObjectUrl)
          return
        }

        setBlob(record.blob)
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
  }, [storageMode, ticket.id])

  async function handleCopyReference() {
    if (!ticket.referenceLocation) {
      return
    }

    try {
      await navigator.clipboard.writeText(ticket.referenceLocation)
      setCopyMessage('已复制位置说明。')
    } catch {
      setCopyMessage('复制失败，请手动选择位置说明。')
    }
  }

  async function handleShareFile() {
    if (!shareFile || !canShareFile) {
      return
    }

    try {
      await navigator.share({ files: [shareFile], title: displayTitle })
    } catch {
      // 用户取消系统分享时不需要显示错误。
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-[430px] rounded-t-2xl border-t border-white/80 bg-white p-4 shadow-[0_-10px_28px_rgba(38,53,76,0.14)]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-sky-600">{ticketStorageModeLabels[storageMode]}</p>
          <h3 className="mt-1 truncate text-base font-semibold text-slate-950">{displayTitle}</h3>
          <p className="mt-1 truncate text-xs text-slate-400">
            {ticket.fileName} · {ticketFileTypeLabels[ticket.fileType]} · {formatFileSize(ticket.size)}
          </p>
        </div>
        <button
          aria-label="关闭预览"
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-50 text-slate-500"
          onClick={onClose}
          type="button"
        >
          <X className="size-5" />
        </button>
      </div>

      {storageMode === 'reference' ? (
        <ReferencePreview
          copyMessage={copyMessage}
          onCopy={() => void handleCopyReference()}
          ticket={ticket}
        />
      ) : null}

      {storageMode === 'external' ? <ExternalPreview ticket={ticket} /> : null}

      {storageMode === 'copy' ? (
        <div className="max-h-[62dvh] overflow-auto rounded-xl bg-slate-50">
          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center text-slate-400">
              <LoaderCircle className="size-5 animate-spin" />
            </div>
          ) : null}

          {error ? (
            <p className="min-h-40 px-4 py-8 text-center text-sm leading-6 text-red-500">{error}</p>
          ) : null}

          {!isLoading && !error && objectUrl ? (
            <CopyPreviewContent
              canShareFile={canShareFile}
              objectUrl={objectUrl}
              onShare={() => void handleShareFile()}
              ticket={ticket}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CopyPreviewContent({
  ticket,
  objectUrl,
  canShareFile,
  onShare,
}: {
  ticket: TicketMeta
  objectUrl: string
  canShareFile: boolean
  onShare: () => void
}) {
  return (
    <div className="space-y-3 p-3">
      {ticket.fileType === 'image' ? (
        <img
          alt={ticket.fileName}
          className="max-h-[52dvh] w-full rounded-xl bg-white object-contain"
          src={objectUrl}
        />
      ) : null}

      {ticket.fileType === 'pdf' ? (
        <iframe className="h-[52dvh] w-full rounded-xl bg-white" src={objectUrl} title={ticket.fileName} />
      ) : null}

      {ticket.fileType === 'other' ? (
        <div className="space-y-3 p-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-white text-slate-500">
            <FileArchive className="size-7" />
          </div>
          <p className="text-sm leading-6 text-slate-500">此文件类型暂不支持内嵌预览。</p>
        </div>
      ) : null}

      <a
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1677ff] px-3 text-sm font-semibold text-white"
        href={objectUrl}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-4" />
        在新标签打开
      </a>

      {canShareFile ? (
        <Button className="w-full" icon={<Share2 className="size-4" />} onClick={onShare} variant="secondary">
          用系统分享/打开
        </Button>
      ) : null}
    </div>
  )
}

function ReferencePreview({
  ticket,
  copyMessage,
  onCopy,
}: {
  ticket: TicketMeta
  copyMessage: string | null
  onCopy: () => void
}) {
  return (
    <div className="space-y-3 rounded-xl bg-amber-50 p-4 text-amber-900">
      <p className="text-sm leading-6">
        此票据仅记录文件位置，旅图没有保存这个文件副本，也不能直接打开本地路径。请按你填写的位置到“文件”App、网盘或相册中查找。
      </p>
      <p className="rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold leading-6">
        {ticket.referenceLocation || '未填写位置说明'}
      </p>
      {ticket.referenceLocation ? (
        <Button className="w-full" icon={<Copy className="size-4" />} onClick={onCopy} variant="secondary">
          复制位置说明
        </Button>
      ) : null}
      {copyMessage ? <p className="text-xs font-semibold">{copyMessage}</p> : null}
    </div>
  )
}

function ExternalPreview({ ticket }: { ticket: TicketMeta }) {
  const url = ticket.externalUrl?.trim()
  const canOpen = Boolean(url && isValidExternalUrl(url))

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-4">
      <p className="text-sm leading-6 text-slate-500">
        此票据保存的是外部链接，打开时需要网络，并依赖对应的外部服务。
      </p>
      <p className="break-all rounded-xl bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">
        {url || '未填写外部链接'}
      </p>
      {canOpen ? (
        <a
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#1677ff] px-3 text-sm font-semibold text-white"
          href={url}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-4" />
          打开外部链接
        </a>
      ) : (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
          外部链接无效，只支持 http:// 或 https://。
        </p>
      )}
    </div>
  )
}
