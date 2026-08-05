import type { ReactNode } from 'react'
import type { TicketBlobSyncState, TicketMeta } from '../../types'
import { TicketThumbnail } from './TicketThumbnail'

type DocumentPreviewRowProps = {
  action?: ReactNode
  blobSyncState?: TicketBlobSyncState
  detail?: ReactNode
  meta?: ReactNode
  onOpen: () => void
  subtitle?: ReactNode
  ticket: TicketMeta
  title: string
}

export function DocumentPreviewRow({ action, blobSyncState, detail, meta, onOpen, subtitle, ticket, title }: DocumentPreviewRowProps) {
  return (
    <article className="document-preview-row" data-ticket-layout="row" data-testid="ticket-card">
      <button
        aria-label={`预览${title}`}
        className="document-preview-open tm-focus"
        onClick={onOpen}
        type="button"
      >
        <TicketThumbnail
          blobSyncState={blobSyncState}
          className="document-preview-thumbnail"
          ticket={ticket}
        />
        <span className="document-preview-content">
          <span className="document-preview-title" title={title}>{title}</span>
          {subtitle ? <span className="document-preview-subtitle">{subtitle}</span> : null}
          {detail ? <span className="document-preview-detail">{detail}</span> : null}
          {meta ? <span className="document-preview-meta">{meta}</span> : null}
        </span>
      </button>
      {action ? <span className="document-preview-action">{action}</span> : null}
    </article>
  )
}
