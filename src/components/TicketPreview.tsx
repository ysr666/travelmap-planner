import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileArchive, LoaderCircle, Share2, X } from 'lucide-react'
import { getTicketBlob } from '../db'
import {
  describeTicketMetaLine,
  getTicketDisplayTitle,
  getTicketStorageMode,
  isValidExternalUrl,
  ticketStorageModeLabels,
} from '../lib/tickets'
import type { TicketMeta } from '../types'
import { Button } from './ui/Button'

type TicketPreviewProps = {
  ticket: TicketMeta
  onClose: () => void
  onChangeTicket?: (ticket: TicketMeta) => void
  tickets?: TicketMeta[]
}

type BlobPreviewState = {
  blob: Blob | null
  error: string | null
  isLoading: boolean
  objectUrl: string | null
  ticketId: string
}

export function TicketPreview({ ticket, onClose, onChangeTicket, tickets }: TicketPreviewProps) {
  const storageMode = getTicketStorageMode(ticket)
  const displayTitle = getTicketDisplayTitle(ticket)
  const [blobState, setBlobState] = useState<BlobPreviewState>({
    blob: null,
    error: null,
    isLoading: storageMode === 'copy',
    objectUrl: null,
    ticketId: ticket.id,
  })
  const [copyMessageState, setCopyMessageState] = useState<{ message: string; ticketId: string } | null>(null)
  const contextIndex = tickets?.findIndex((contextTicket) => contextTicket.id === ticket.id) ?? -1
  const hasNavigation = Boolean(tickets && tickets.length > 1 && onChangeTicket && contextIndex >= 0)
  const previousTicket = hasNavigation && tickets ? tickets[contextIndex - 1] : undefined
  const nextTicket = hasNavigation && tickets ? tickets[contextIndex + 1] : undefined
  const activeBlobState = blobState.ticketId === ticket.id
    ? blobState
    : {
        blob: null,
        error: null,
        isLoading: storageMode === 'copy',
        objectUrl: null,
        ticketId: ticket.id,
      }
  const { blob, error, isLoading, objectUrl } = activeBlobState
  const copyMessage = copyMessageState?.ticketId === ticket.id ? copyMessageState.message : null
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
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  useEffect(() => {
    let isActive = true
    let nextObjectUrl: string | null = null

    async function loadBlob() {
      if (storageMode !== 'copy') {
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

        setBlobState({
          blob: record.blob,
          error: null,
          isLoading: false,
          objectUrl: nextObjectUrl,
          ticketId: ticket.id,
        })
      } catch (caught) {
        if (isActive) {
          if (nextObjectUrl) {
            URL.revokeObjectURL(nextObjectUrl)
            nextObjectUrl = null
          }
          setBlobState({
            blob: null,
            error: caught instanceof Error ? caught.message : '读取票据文件失败',
            isLoading: false,
            objectUrl: null,
            ticketId: ticket.id,
          })
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (!hasNavigation || !onChangeTicket) {
        return
      }

      if (event.key === 'ArrowLeft' && previousTicket) {
        event.preventDefault()
        onChangeTicket(previousTicket)
      }

      if (event.key === 'ArrowRight' && nextTicket) {
        event.preventDefault()
        onChangeTicket(nextTicket)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasNavigation, nextTicket, onChangeTicket, onClose, previousTicket])

  async function handleCopyReference() {
    if (!ticket.referenceLocation) {
      return
    }

    try {
      await navigator.clipboard.writeText(ticket.referenceLocation)
      setCopyMessageState({ message: '已复制位置说明。', ticketId: ticket.id })
    } catch {
      setCopyMessageState({ message: '复制失败，请手动选择位置说明。', ticketId: ticket.id })
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

  function handlePreviousTicket() {
    if (previousTicket && onChangeTicket) {
      onChangeTicket(previousTicket)
    }
  }

  function handleNextTicket() {
    if (nextTicket && onChangeTicket) {
      onChangeTicket(nextTicket)
    }
  }

  return createPortal(
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-center bg-slate-950/80 backdrop-blur-sm"
      data-testid="ticket-preview"
      role="dialog"
    >
      <div className="flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-slate-950 text-white shadow-[0_0_36px_rgba(15,23,42,0.35)]">
        <div className="shrink-0 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))]">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-sky-300">{ticketStorageModeLabels[storageMode]}</p>
              <h3 className="mt-1 break-words text-base font-semibold text-white [overflow-wrap:anywhere]">
                {displayTitle}
              </h3>
              <p className="mt-1 break-words text-xs text-slate-400 [overflow-wrap:anywhere]">
                {ticket.fileName} · {describeTicketMetaLine(ticket)}
              </p>
            </div>
            <button
              aria-label="关闭预览"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/10 active:scale-[0.98]"
              data-testid="ticket-preview-close"
              onClick={onClose}
              type="button"
            >
              <X className="size-5" />
            </button>
          </div>
          {hasNavigation && tickets ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                aria-label="上一张票据"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white ring-1 ring-white/10 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
                data-testid="ticket-preview-previous"
                disabled={!previousTicket}
                onClick={handlePreviousTicket}
                type="button"
              >
                <ChevronLeft className="size-4" />
                上一张
              </button>
              <span
                className="rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10"
                data-testid="ticket-preview-counter"
              >
                {contextIndex + 1} / {tickets.length}
              </span>
              <button
                aria-label="下一张票据"
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold text-white ring-1 ring-white/10 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"
                data-testid="ticket-preview-next"
                disabled={!nextTicket}
                onClick={handleNextTicket}
                type="button"
              >
                下一张
                <ChevronRight className="size-4" />
              </button>
            </div>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] app-scrollbar">
          {storageMode === 'reference' ? (
            <ReferencePreview
              copyMessage={copyMessage}
              onCopy={() => void handleCopyReference()}
              ticket={ticket}
            />
          ) : null}

          {storageMode === 'external' ? <ExternalPreview ticket={ticket} /> : null}

          {storageMode === 'copy' ? (
            <div className="min-h-[calc(100dvh-12rem)] rounded-3xl bg-black/25 ring-1 ring-white/10">
              {isLoading ? (
                <div className="flex min-h-64 items-center justify-center text-slate-400">
                  <LoaderCircle className="size-5 animate-spin" />
                </div>
              ) : null}

              {error ? (
                <p className="min-h-40 px-4 py-8 text-center text-sm leading-6 text-red-200">{error}</p>
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
      </div>
    </div>,
    document.body,
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
          className="max-h-[66dvh] w-full rounded-2xl bg-black object-contain"
          data-testid="ticket-preview-image"
          src={objectUrl}
        />
      ) : null}

      {ticket.fileType === 'pdf' ? (
        <>
          <iframe
            className="h-[64dvh] w-full rounded-2xl bg-white"
            data-testid="ticket-preview-pdf"
            src={objectUrl}
            title={ticket.fileName}
          />
          <p className="px-1 text-xs leading-5 text-slate-300">
            如果 PDF 没有显示，请使用“在新标签打开”。
          </p>
        </>
      ) : null}

      {ticket.fileType === 'other' ? (
        <div className="space-y-3 p-4 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-white/10 text-slate-300">
            <FileArchive className="size-7" />
          </div>
          <p className="text-sm leading-6 text-slate-300">此文件类型暂不支持内嵌预览。</p>
        </div>
      ) : null}

      <a
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-950"
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
    <div className="space-y-3 rounded-3xl bg-amber-50 p-4 text-amber-900" data-testid="ticket-preview-reference">
      <p className="text-sm leading-6">
        此票据仅记录文件位置，旅图没有保存这个文件副本，也不能直接打开本地路径。请按你填写的位置到“文件”App、网盘或相册中查找。
      </p>
      <p className="break-words rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold leading-6 [overflow-wrap:anywhere]">
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
    <div className="space-y-3 rounded-3xl bg-slate-50 p-4" data-testid="ticket-preview-external">
      <p className="text-sm leading-6 text-slate-500">
        此票据保存的是外部链接，打开时需要网络，并依赖对应的外部服务。
      </p>
      <p className="break-all rounded-xl bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">
        {url || '未填写外部链接'}
      </p>
      {canOpen ? (
        <a
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white"
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
