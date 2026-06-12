import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Copy, ExternalLink, FileArchive, LoaderCircle, X } from 'lucide-react'
import { getTicketBlob } from '../db'
import {
  describeTicketMetaLine,
  getTicketDisplayTitle,
  getTicketStorageMode,
  isValidExternalUrl,
  ticketStorageModeLabels,
} from '../lib/tickets'
import type { TicketMeta } from '../types'
import { TicketThumbnail } from './tickets/TicketThumbnail'
import { useModalAccessibility } from './ui/useModalAccessibility'

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

const SWIPE_THRESHOLD = 50

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
  const contextIndex = tickets?.findIndex((t) => t.id === ticket.id) ?? -1
  const hasNavigation = Boolean(tickets && tickets.length > 1 && onChangeTicket && contextIndex >= 0)
  const previousTicket = hasNavigation && tickets ? tickets[contextIndex - 1] : undefined
  const nextTicket = hasNavigation && tickets ? tickets[contextIndex + 1] : undefined
  const activeBlobState =
    blobState.ticketId === ticket.id
      ? blobState
      : { blob: null, error: null, isLoading: storageMode === 'copy', objectUrl: null, ticketId: ticket.id }
  const { blob, error, isLoading, objectUrl } = activeBlobState
  const copyMessage = copyMessageState?.ticketId === ticket.id ? copyMessageState.message : null
  const canOpenInNewTab =
    (storageMode === 'copy' && Boolean(objectUrl) && !isLoading && !error) ||
    (storageMode === 'external' && Boolean(ticket.externalUrl?.trim()) && isValidExternalUrl(ticket.externalUrl!.trim()))
  const shareFile = useMemo(() => {
    if (!blob) return null
    return new File([blob], ticket.fileName || displayTitle, {
      type: ticket.mimeType || blob.type || 'application/octet-stream',
    })
  }, [blob, displayTitle, ticket.fileName, ticket.mimeType])
  const canShareFile =
    Boolean(shareFile) &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: shareFile ? [shareFile] : [] })
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  // --- Swipe ---
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || !hasNavigation) return
      const dx = e.changedTouches[0].clientX - touchStartRef.current.x
      const dy = Math.abs(e.changedTouches[0].clientY - touchStartRef.current.y)
      touchStartRef.current = null
      if (Math.abs(dx) < SWIPE_THRESHOLD || dy > Math.abs(dx)) return
      if (dx < 0 && nextTicket && onChangeTicket) onChangeTicket(nextTicket)
      if (dx > 0 && previousTicket && onChangeTicket) onChangeTicket(previousTicket)
    },
    [hasNavigation, nextTicket, previousTicket, onChangeTicket],
  )

  // --- Body scroll lock ---
  useModalAccessibility({
    containerRef: dialogRef,
    initialFocusRef: closeButtonRef,
    onClose,
    open: true,
  })

  // --- Blob loading ---
  useEffect(() => {
    let isActive = true
    let nextObjectUrl: string | null = null

    async function loadBlob() {
      if (storageMode !== 'copy') return
      try {
        const record = await getTicketBlob(ticket.id)
        if (!record) {
          throw new Error('离线缓存不可用，可能尚未同步到此设备或浏览器缓存已被清理。请重新同步账号数据或重新上传票据。')
        }
        nextObjectUrl = URL.createObjectURL(record.blob)
        if (!isActive) { URL.revokeObjectURL(nextObjectUrl); return }
        setBlobState({ blob: record.blob, error: null, isLoading: false, objectUrl: nextObjectUrl, ticketId: ticket.id })
      } catch (caught) {
        if (isActive) {
          if (nextObjectUrl) { URL.revokeObjectURL(nextObjectUrl); nextObjectUrl = null }
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
    return () => { isActive = false; if (nextObjectUrl) URL.revokeObjectURL(nextObjectUrl) }
  }, [storageMode, ticket.id])

  // --- Keyboard ---
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!hasNavigation || !onChangeTicket) return
      if (event.key === 'ArrowLeft' && previousTicket) { event.preventDefault(); onChangeTicket(previousTicket) }
      if (event.key === 'ArrowRight' && nextTicket) { event.preventDefault(); onChangeTicket(nextTicket) }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [hasNavigation, nextTicket, onChangeTicket, onClose, previousTicket])

  // --- Actions ---
  async function handleCopyReference() {
    if (!ticket.referenceLocation) return
    try {
      await navigator.clipboard.writeText(ticket.referenceLocation)
      setCopyMessageState({ message: '已复制位置说明。', ticketId: ticket.id })
    } catch {
      setCopyMessageState({ message: '复制失败，请手动选择位置说明。', ticketId: ticket.id })
    }
  }

  async function handleShareFile() {
    if (!shareFile || !canShareFile) return
    try {
      await navigator.share({ files: [shareFile], title: displayTitle })
    } catch { /* 用户取消系统分享时不需要显示错误 */ }
  }

  function handlePrevious() { if (previousTicket && onChangeTicket) onChangeTicket(previousTicket) }
  function handleNext() { if (nextTicket && onChangeTicket) onChangeTicket(nextTicket) }

  return createPortal(
    <div
      aria-describedby={descriptionId}
      aria-labelledby={titleId}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
      data-testid="ticket-preview"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      ref={dialogRef}
      role="dialog"
      tabIndex={-1}
    >
      <div className="flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-slate-950 text-white shadow-[0_0_36px_rgba(15,23,42,0.35)]">
        {/* ── Top bar ── */}
        <div className="flex shrink-0 items-center justify-between px-4 pt-[max(0.9rem,env(safe-area-inset-top))] pb-2">
          <button
            aria-label="关闭预览"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/10 active:scale-[0.98] tm-focus"
            data-testid="ticket-preview-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X className="size-5" />
          </button>
          <h3 className="min-w-0 flex-1 break-words px-3 text-center text-base font-semibold text-white" id={titleId}>
            {displayTitle}
          </h3>
          {hasNavigation && tickets ? (
            <span
              className="shrink-0 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-slate-200 ring-1 ring-white/10"
              data-testid="ticket-preview-counter"
            >
              {contextIndex + 1} / {tickets.length}
            </span>
          ) : (
            <div className="size-11 shrink-0" />
          )}
        </div>

        {/* ── Metadata row ── */}
        <div className="shrink-0 break-words px-4 pb-2 text-xs leading-5 text-slate-400 [overflow-wrap:anywhere]" id={descriptionId}>
          {ticketStorageModeLabels[storageMode]} · {ticket.fileName} · {describeTicketMetaLine(ticket)}
        </div>

        {/* ── Content area with circular nav buttons ── */}
        <div
          className="relative min-h-0 flex-1 overflow-y-auto px-3 app-scrollbar"
          onTouchEnd={handleTouchEnd}
          onTouchStart={handleTouchStart}
        >
          {/* Left nav button */}
          {hasNavigation ? (
            <button
              aria-label="上一张票据"
              className="absolute left-1 top-1/2 z-10 -translate-y-1/2 flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur ring-1 ring-white/10 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 tm-focus"
              data-testid="ticket-preview-previous"
              disabled={!previousTicket}
              onClick={handlePrevious}
              type="button"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : null}

          {/* Right nav button */}
          {hasNavigation ? (
            <button
              aria-label="下一张票据"
              className="absolute right-1 top-1/2 z-10 -translate-y-1/2 flex size-11 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur ring-1 ring-white/10 transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 tm-focus"
              data-testid="ticket-preview-next"
              disabled={!nextTicket}
              onClick={handleNext}
              type="button"
            >
              <ChevronRight className="size-5" />
            </button>
          ) : null}

          {/* Content */}
          <div className="flex min-h-full items-center justify-center py-2">
            {storageMode === 'reference' ? (
              <ReferencePreview ticket={ticket} />
            ) : null}

            {storageMode === 'external' ? <ExternalPreview ticket={ticket} /> : null}

            {storageMode === 'copy' ? (
              <div className="w-full">
                {isLoading ? (
                  <div className="flex min-h-64 items-center justify-center text-slate-400">
                    <LoaderCircle className="size-5 animate-spin" />
                  </div>
                ) : null}

                {error ? (
                  <div className="space-y-3 p-4 text-center">
                    <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-red-500/10 text-red-300">
                      <FileArchive className="size-7" />
                    </div>
                    <p className="text-sm leading-6 text-red-200">{error}</p>
                  </div>
                ) : null}

                {!isLoading && !error && objectUrl ? (
                  <div className="flex flex-col items-center gap-3 px-3">
                    {ticket.fileType === 'image' ? (
                      <img
                        alt={ticket.fileName}
                        className="max-h-[55dvh] w-full rounded-2xl bg-black object-contain"
                        data-testid="ticket-preview-image"
                        src={objectUrl}
                      />
                    ) : null}

                    {ticket.fileType === 'pdf' ? (
                      <div className="w-full">
                        <iframe
                          className="h-[50dvh] w-full rounded-2xl bg-white"
                          data-testid="ticket-preview-pdf"
                          src={objectUrl}
                          title={ticket.fileName}
                        />
                        <p className="mt-1 px-1 text-xs leading-5 text-slate-300">
                          如果 PDF 没有显示，请使用"在新标签打开"。
                        </p>
                      </div>
                    ) : null}

                    {ticket.fileType === 'other' ? (
                      <div className="space-y-3 p-4 text-center">
                        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-white/10 text-slate-300">
                          <FileArchive className="size-7" />
                        </div>
                        <p className="text-sm leading-6 text-slate-300">此文件类型暂不支持内嵌预览。</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {/* ── Bottom thumbnail strip ── */}
        {hasNavigation && tickets ? (
          <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 app-scrollbar">
            {tickets.map((t, idx) => (
              <button
                key={t.id}
                aria-label={`切换到第 ${idx + 1} 张`}
                className={`flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition tm-focus ${
                  t.id === ticket.id
                    ? 'bg-white/15 text-white ring-2 ring-white/60'
                    : 'text-slate-400 ring-1 ring-white/10 opacity-60 hover:opacity-100'
                }`}
                data-testid="ticket-preview-thumbnail"
                onClick={() => onChangeTicket?.(t)}
                type="button"
              >
                <TicketThumbnail className="size-7 shrink-0 rounded" ticket={t} />
                <span className="max-w-[5rem] truncate">
                  {idx + 1} {t.title || t.fileName || '票据'}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {/* ── Bottom action bar ── */}
        <div className="flex shrink-0 flex-col gap-2 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          {storageMode === 'copy' ? (
            <>
              {canOpenInNewTab ? (
                <a
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white px-3 text-sm font-semibold text-slate-950 active:scale-[0.98]"
                  href={objectUrl ?? undefined}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-4" />
                  在新标签打开
                </a>
              ) : null}
              {canShareFile ? (
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/10 active:scale-[0.98]"
                  onClick={() => void handleShareFile()}
                  type="button"
                >
                  分享
                </button>
              ) : null}
            </>
          ) : null}

          {storageMode === 'reference' ? (
            <>
              {ticket.referenceLocation ? (
                <button
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 text-sm font-semibold text-white ring-1 ring-white/10 active:scale-[0.98]"
                  onClick={() => void handleCopyReference()}
                  type="button"
                >
                  <Copy className="size-4" />
                  复制位置说明
                </button>
              ) : null}
              {copyMessage ? <p className="text-center text-xs font-semibold text-emerald-400">{copyMessage}</p> : null}
            </>
          ) : null}

          {storageMode === 'external' ? (
            (() => {
              const url = ticket.externalUrl?.trim()
              const canOpen = Boolean(url && isValidExternalUrl(url))
              return canOpen ? (
                <a
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white active:scale-[0.98]"
                  href={url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink className="size-4" />
                  打开外部链接
                </a>
              ) : (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-center text-sm font-medium text-red-600 dark:text-red-300">
                  外部链接无效，只支持 http:// 或 https://。
                </p>
              )
            })()
          ) : null}

          {/* Hint text */}
          <p className="text-center text-[11px] text-slate-500">
            {hasNavigation ? '← 左右滑动切换 · 点击空白处关闭 →' : '点击空白处关闭'}
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ── Reference preview (content only, actions in bottom bar) ── */

function ReferencePreview({ ticket }: { ticket: TicketMeta }) {
  return (
    <div className="w-full space-y-3 rounded-3xl bg-amber-50 p-4 text-amber-900" data-testid="ticket-preview-reference">
      <p className="text-sm leading-6">
        此票据仅记录文件位置，旅图未保存文件内容，也不能直接打开本地路径。请按你填写的位置到"文件"App、网盘或相册中查找。
      </p>
      <p className="break-words rounded-xl bg-white/70 px-3 py-2 text-sm font-semibold leading-6 [overflow-wrap:anywhere]">
        {ticket.referenceLocation || '未填写位置说明'}
      </p>
    </div>
  )
}

/* ── External preview (content only, actions in bottom bar) ── */

function ExternalPreview({ ticket }: { ticket: TicketMeta }) {
  const url = ticket.externalUrl?.trim()
  const canOpen = Boolean(url && isValidExternalUrl(url))

  return (
    <div className="w-full space-y-3 rounded-3xl bg-slate-50 p-4" data-testid="ticket-preview-external">
      <p className="text-sm leading-6 text-slate-500">
        此票据保存的是外部链接，打开时需要网络，并依赖对应的外部服务。
      </p>
      <p className="break-all rounded-xl bg-white px-3 py-2 text-sm font-semibold leading-6 text-slate-700">
        {url || '未填写外部链接'}
      </p>
      {canOpen ? null : (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300">
          外部链接无效，只支持 http:// 或 https://。
        </p>
      )}
    </div>
  )
}
