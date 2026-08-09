import { useState, type ReactNode } from 'react'
import {
  FileArchive,
  HardDrive,
  Link2,
  MapPinned,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { TicketPreview } from '../TicketPreview'
import { DocumentPreviewRow } from './DocumentPreviewRow'
import { TravelObjectMedia } from '../media/TravelObjectMedia'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { EmptyState } from '../ui/EmptyState'
import {
  FIELD_INPUT_CLASS,
  FIELD_LABEL_CLASS,
  FIELD_SELECT_CLASS,
  FIELD_TEXTAREA_CLASS,
} from '../ui/FormField'
import { InlineStatus } from '../ui/InlineStatus'
import { SkeletonLine } from '../ui/SkeletonLine'
import { TravelObjectLeading, TravelObjectStatusBadge } from '../travel/TravelObjectPresentation'
import type { TicketLibraryController } from '../../hooks/useTicketLibraryController'
import { useTravelObjectPresentation } from '../../hooks/useTravelObjectPresentation'
import { navigateTo } from '../../lib/routes'
import {
  describeTicketMetaLine,
  formatFileSize,
  getTicketDisplayTitle,
  ticketCategoryOptions,
} from '../../lib/tickets'
import {
  describeCompactTicketMeta,
  describeTicketBinding,
  getTicketBindingTarget,
  getTicketFilterSummary,
  ticketFilterOptions,
  type BindingTarget,
  type TicketEditDraft,
  type TicketSort,
} from '../../lib/ticketLibraryViewModel'
import type {
  TicketCategory,
  TicketMeta,
  TicketStorageMode,
} from '../../types'
import type { TravelObjectViewModelV1 } from '../../lib/travelObjects'

const storageOptions: Array<{ value: TicketStorageMode; label: string; icon: ReactNode }> = [
  { value: 'copy', label: '文件', icon: <Upload className="size-4" /> },
  { value: 'reference', label: '位置', icon: <MapPinned className="size-4" /> },
  { value: 'external', label: '链接', icon: <Link2 className="size-4" /> },
]

export function TicketLibraryView({
  contextControls,
  controller,
  embedded,
  headerAction,
}: {
  contextControls?: ReactNode
  controller: TicketLibraryController
  embedded: boolean
  headerAction?: ReactNode
}) {
  const {
    actionError,
    actionMessage,
    bindingOptions,
    bindingTarget,
    closeTicketPreview,
    confirmCreateExpenseDraft,
    confirmDeleteTicket,
    deletingTicketId,
    days,
    editingTicket,
    externalUrl,
    fileInputKey,
    filter,
    filteredTickets,
    handleClearTicketCache,
    handleRestoreTicketCache,
    handleRetryTicketBlobUpload,
    handleSaveTicket,
    handleSaveTicketEdit,
    handleTicketIntelligenceAction,
    isLoading,
    isSavingTicketEdit,
    isUploading,
    items,
    itemById,
    loadError,
    note,
    openTicketEditor,
    openTicketPreview,
    pendingDeleteTicket,
    pendingExpenseDraft,
    previewTicket,
    referenceFileName,
    referenceLocation,
    restoreSuggestionState,
    searchInputRef,
    searchQuery,
    selectedFile,
    setActionError,
    setActionMessage,
    setBindingTarget,
    setEditingTicket,
    setExternalUrl,
    setFilter,
    setNote,
    setPendingDeleteTicket,
    setPendingExpenseDraft,
    setReferenceFileName,
    setReferenceLocation,
    setSearchQuery,
    setSelectedFile,
    setShowAddSheet,
    setShowFilterSheet,
    setSort,
    setStorageMode,
    setSuggestionState,
    setTicketCategory,
    setTitle,
    showAddSheet,
    showEmbeddedScopeFilters,
    showFilterSheet,
    showSearch,
    sort,
    storageMode,
    ticketBlobActionId,
    ticketBlobSyncStates,
    ticketCategory,
    ticketIntelligenceActionId,
    ticketIntelligenceModel,
    ticketLibraryStats,
    tickets,
    title,
    trip,
    visibleTicketCategoryFilters,
  } = controller
  const { collection: travelObjects } = useTravelObjectPresentation({
    days,
    items,
    tickets,
    trip,
  })

  function renderDocumentPreviewRow(ticket: TicketMeta) {
    const displayTitle = getTicketDisplayTitle(ticket)
    const blobSyncState = ticketBlobSyncStates[ticket.id]
    const canClearCache = blobSyncState?.uploadStatus === 'synced' && blobSyncState.cacheStatus === 'cached' && Boolean(blobSyncState.cloudStoragePath)
    const canRestoreCache = blobSyncState?.uploadStatus === 'synced' && blobSyncState.cacheStatus !== 'cached' && Boolean(blobSyncState.cloudStoragePath)
    const canRetryUpload = blobSyncState?.uploadStatus === 'error'
    const object = travelObjects.byTicketId.get(ticket.id)
    return (
      <DocumentPreviewRow
        action={(
          <TicketActionsMenu
            busy={ticketBlobActionId === ticket.id}
            canClearCache={canClearCache}
            canRestoreCache={canRestoreCache}
            canRetryUpload={canRetryUpload}
            className="relative"
            displayTitle={displayTitle}
            onClearCache={() => void handleClearTicketCache(ticket)}
            onDelete={() => setPendingDeleteTicket(ticket)}
            onEdit={() => openTicketEditor(ticket)}
            onRestoreCache={() => void handleRestoreTicketCache(ticket)}
            onRetryUpload={() => void handleRetryTicketBlobUpload(ticket)}
          />
        )}
        blobSyncState={blobSyncState}
        detail={object?.documentLink?.label || describeTicketBinding(ticket, itemById)}
        key={ticket.id}
        meta={ticket.size > 0 ? formatFileSize(ticket.size) : undefined}
        onOpen={() => openTicketPreview(ticket)}
        preview={object?.media ? (
          <TravelObjectMedia
            alt={object.title}
            asset={object.media}
            className="document-preview-thumbnail"
            sizes="96px"
            variant="document"
          />
        ) : object?.brand ? (
          <TravelObjectLeading className="document-preview-thumbnail" object={object} preferBrand />
        ) : undefined}
        status={<TravelObjectStatusBadge status={object?.status} />}
        subtitle={describeDocumentObject(object, ticket)}
        ticket={ticket}
        title={displayTitle}
      />
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Card variant="grouped" className="space-y-3">
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-1/2" />
        </Card>
      </div>
    )
  }

  if (loadError || !trip) {
    return (
      <div className="space-y-5">
        <EmptyState body={loadError || '请从旅行总览进入票据库。'} icon={<FileArchive className="size-6" />} title="无法打开票据库" />
        <Button className="w-full" onClick={() => navigateTo('home')} variant="secondary">返回首页</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {actionError ? <InlineStatus role="alert" size="md" tone="error">{actionError}</InlineStatus> : null}
      {actionMessage ? <InlineStatus role="status" size="md" tone="success">{actionMessage}</InlineStatus> : null}

      <section className="space-y-3">
        {embedded ? <h2 className="sr-only">票据</h2> : null}
        <div className="flex min-h-11 items-center justify-between gap-3">
          {embedded ? (
            <div className="min-w-0 flex-1 overflow-x-auto app-scrollbar">{contextControls}</div>
          ) : (
            <h2 className="min-w-0 truncate text-base font-semibold text-on-surface">
              票据 <span className="text-sm font-normal text-on-surface-variant">{ticketLibraryStats.totalCount}</span>
            </h2>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {headerAction}
            <button aria-label="筛选和排序票据" className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus" onClick={() => setShowFilterSheet(true)} type="button">
              <SlidersHorizontal className="size-5" />
            </button>
            <button aria-label="添加票据" className="flex size-11 items-center justify-center rounded-lg bg-primary text-on-primary tm-focus" onClick={() => setShowAddSheet(true)} type="button">
              <Plus className="size-5" />
            </button>
          </div>
        </div>

        <label className={showSearch ? 'relative block' : 'hidden'}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-on-surface-variant" />
          <input
            aria-label="搜索票据"
            className={`${FIELD_INPUT_CLASS} pl-9`}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索票据、地点或订单"
            ref={searchInputRef}
            value={searchQuery}
          />
        </label>

        {ticketLibraryStats.totalCount > 0 && (!embedded || showEmbeddedScopeFilters) ? (
          <div className="flex gap-2 overflow-x-auto pb-1 app-scrollbar" aria-label="票据分类">
            {visibleTicketCategoryFilters.map((option) => (
              <button
                className={`min-h-10 shrink-0 rounded-full border px-3 text-xs font-semibold tm-focus ${
                  filter === option.value
                    ? 'border-primary/45 bg-primary-container/45 text-primary'
                    : 'border-outline-variant/45 bg-surface text-on-surface-variant'
                }`}
                key={option.value}
                onClick={() => setFilter(option.value)}
                type="button"
              >
                {option.label}{embedded ? '' : ` ${option.count}`}
              </button>
            ))}
          </div>
        ) : null}

        <div className={filter !== 'all' || searchQuery ? 'flex min-h-6 items-center justify-between gap-3 text-xs tm-muted' : 'sr-only'} data-testid="ticket-filter-summary">
          <span className="min-w-0 truncate">{getTicketFilterSummary(filter, filteredTickets.length)}</span>
          {filter !== 'all' ? <button className="shrink-0 font-semibold text-primary tm-focus" onClick={() => setFilter('all')} type="button">清除</button> : null}
        </div>

        {filteredTickets.length === 0 ? (
          <div className="space-y-3">
            <EmptyState body={tickets.length > 0 ? '换个关键词或清除筛选。' : '添加图片、PDF 或订单链接。'} icon={<FileArchive className="size-6" />} title={tickets.length > 0 ? '没有匹配的票据' : '暂无票据'} />
            {tickets.length === 0 ? <Button className="w-full" icon={<Plus className="size-4" />} onClick={() => setShowAddSheet(true)}>添加票据</Button> : null}
          </div>
        ) : (
          <div className="document-preview-list" data-testid="ticket-gallery" id="ticket-gallery">
            {filteredTickets.map(renderDocumentPreviewRow)}
          </div>
        )}
      </section>

      <BottomSheet maxHeight="calc(100dvh - 1rem)" onClose={() => setShowAddSheet(false)} open={showAddSheet} title="添加票据">
        <div className="space-y-4" data-testid="ticket-add-panel">
          <div className="grid grid-cols-3 gap-2">
            {storageOptions.map((option) => (
              <button
                aria-pressed={storageMode === option.value}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-2 text-sm font-semibold transition active:scale-[0.99] ${
                  storageMode === option.value
                    ? 'border-primary/35 bg-primary-container text-on-primary-container'
                    : 'border-outline-variant/30 bg-surface text-on-surface-variant'
                }`}
                key={option.value}
                onClick={() => {
                  setStorageMode(option.value)
                  setActionError(null)
                  setActionMessage(null)
                }}
                type="button"
              >
                {option.icon}
                {option.label}
              </button>
            ))}
          </div>

          <TextField label="显示名称" onChange={setTitle} placeholder="例如：浅草寺门票" value={title} />

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>票据分类</span>
            <select className={FIELD_SELECT_CLASS} onChange={(event) => setTicketCategory(event.target.value as TicketCategory)} value={ticketCategory}>
              {ticketCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {storageMode === 'copy' ? <CopyTicketFields fileInputKey={fileInputKey} selectedFile={selectedFile} setSelectedFile={setSelectedFile} /> : null}
          {storageMode === 'reference' ? <ReferenceTicketFields fileName={referenceFileName} location={referenceLocation} setFileName={setReferenceFileName} setLocation={setReferenceLocation} /> : null}
          {storageMode === 'external' ? <TextField label="外部链接" onChange={setExternalUrl} placeholder="https://..." required value={externalUrl} /> : null}

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>绑定对象</span>
            <select className={FIELD_SELECT_CLASS} onChange={(event) => setBindingTarget(event.target.value as BindingTarget)} value={bindingTarget}>
              <option value="trip">整个旅行</option>
              <option value="unassigned">暂不分类</option>
              {bindingOptions.map((option) => <option key={option.id} value={`item:${option.id}`}>{option.label}</option>)}
            </select>
          </label>

          <label className="block">
            <span className={FIELD_LABEL_CLASS}>备注</span>
            <textarea className={`${FIELD_TEXTAREA_CLASS} min-h-20 resize-none`} onChange={(event) => setNote(event.target.value)} placeholder="订单号、取票位置等" value={note} />
          </label>

          <Button className="w-full" icon={<Upload className="size-4" />} loading={isUploading} onClick={() => void handleSaveTicket()}>保存票据</Button>
        </div>
      </BottomSheet>

      <BottomSheet onClose={() => setShowFilterSheet(false)} open={showFilterSheet} title="筛选与排序">
        <div className="space-y-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold tm-muted">筛选</legend>
            <div className="grid grid-cols-2 gap-2">
              {ticketFilterOptions.map((option) => (
                <button
                  aria-pressed={filter === option.value}
                  className={`min-h-11 rounded-lg px-3 text-left text-sm font-semibold tm-focus ${filter === option.value ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface'}`}
                  key={option.value}
                  onClick={() => setFilter(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold tm-muted">排序</legend>
            <div className="grid grid-cols-3 gap-2">
              {([['newest', '最新'], ['oldest', '最早'], ['title', '名称']] as Array<[TicketSort, string]>).map(([value, label]) => (
                <button
                  aria-pressed={sort === value}
                  className={`min-h-11 rounded-lg px-2 text-sm font-semibold tm-focus ${sort === value ? 'bg-primary-container text-on-primary-container' : 'bg-surface-container text-on-surface'}`}
                  key={value}
                  onClick={() => setSort(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <Button className="w-full" onClick={() => setShowFilterSheet(false)}>完成</Button>
        </div>
      </BottomSheet>

      {previewTicket ? (
        <TicketPreview
          hiddenIntelligenceSuggestions={ticketIntelligenceModel.allSuggestions.filter((suggestion) =>
            suggestion.ticketIds.includes(previewTicket.id) && (suggestion.status === 'ignored' || suggestion.status === 'later'),
          )}
          intelligenceActionBusyId={ticketIntelligenceActionId}
          intelligenceSuggestions={ticketIntelligenceModel.forTicket(previewTicket.id)}
          key={previewTicket.id}
          onChangeTicket={openTicketPreview}
          onClose={closeTicketPreview}
          onEditTicket={openTicketEditor}
          onIntelligenceSuggestionAction={handleTicketIntelligenceAction}
          onIntelligenceSuggestionIgnore={(suggestion) => void setSuggestionState({ status: 'ignored', suggestion })}
          onIntelligenceSuggestionLater={(suggestion) => void setSuggestionState({ status: 'later', suggestion })}
          onIntelligenceSuggestionRestore={(suggestion) => void restoreSuggestionState(suggestion.key)}
          blobSyncState={ticketBlobSyncStates[previewTicket.id]}
          blobSyncStates={ticketBlobSyncStates}
          ticket={previewTicket}
          tickets={filteredTickets}
        />
      ) : null}

      {editingTicket ? (
        <TicketMetadataEditor
          bindingOptions={bindingOptions}
          isSaving={isSavingTicketEdit}
          onCancel={() => { if (!isSavingTicketEdit) setEditingTicket(null) }}
          onSave={(draft) => void handleSaveTicketEdit(editingTicket, draft)}
          ticket={editingTicket}
        />
      ) : null}

      <ConfirmDialog
        body="删除后，票据文件、元数据和行程点绑定关系都会从此设备移除，并会随旅行同步到账号。"
        confirmLabel="删除票据"
        loading={Boolean(deletingTicketId)}
        onCancel={() => { if (!deletingTicketId) setPendingDeleteTicket(null) }}
        onConfirm={() => void confirmDeleteTicket()}
        open={Boolean(pendingDeleteTicket)}
        title={pendingDeleteTicket ? `确认删除「${getTicketDisplayTitle(pendingDeleteTicket)}」吗？` : '确认删除这个票据吗？'}
      />

      <ConfirmDialog
        body={pendingExpenseDraft ? `将为「${getTicketDisplayTitle(pendingExpenseDraft.ticket)}」生成一条待确认费用草稿。不会自动计入结算。` : '将生成一条待确认费用草稿。'}
        cancelLabel="暂不生成"
        confirmLabel="生成草稿"
        loading={Boolean(ticketIntelligenceActionId)}
        onCancel={() => { if (!ticketIntelligenceActionId) setPendingExpenseDraft(null) }}
        onConfirm={() => void confirmCreateExpenseDraft()}
        open={Boolean(pendingExpenseDraft)}
        tone="default"
        title="从票据生成费用草稿？"
      />
    </div>
  )
}

function describeDocumentObject(object: TravelObjectViewModelV1 | undefined, ticket: TicketMeta) {
  if (!object || object.kind === 'ticket') {
    return [describeCompactTicketMeta(ticket), object?.dateLabel, object?.timeLabel]
      .filter((value): value is string => Boolean(value))
      .join(' · ')
  }
  return [object.subtitle || describeCompactTicketMeta(ticket), object.dateLabel, object.timeLabel]
    .filter((value): value is string => Boolean(value))
    .join(' · ')
}

function TicketMetadataEditor({
  bindingOptions,
  isSaving,
  onCancel,
  onSave,
  ticket,
}: {
  bindingOptions: Array<{ id: string; label: string }>
  isSaving: boolean
  onCancel: () => void
  onSave: (draft: TicketEditDraft) => void
  ticket: TicketMeta
}) {
  const [title, setTitle] = useState(ticket.title ?? '')
  const [ticketCategory, setTicketCategory] = useState<TicketCategory>(ticket.ticketCategory ?? 'other')
  const [bindingTarget, setBindingTarget] = useState<BindingTarget>(getTicketBindingTarget(ticket))
  const [note, setNote] = useState(ticket.note ?? '')

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-[140] flex items-end justify-center bg-slate-950/60 px-3 py-4 backdrop-blur-sm sm:items-center"
      data-testid="ticket-metadata-editor"
      onClick={(event) => { if (event.target === event.currentTarget && !isSaving) onCancel() }}
      role="dialog"
    >
      <div className="w-full max-w-[460px] space-y-4 rounded-2xl bg-surface p-4 shadow-[0_18px_50px_rgba(15,23,42,0.22)] ring-1 ring-outline-variant/30 dark:bg-surface-container-high">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-600 dark:text-sky-300">{describeTicketMetaLine(ticket)}</p>
            <h3 className="mt-1 text-lg font-semibold text-on-surface dark:text-on-surface">编辑票据</h3>
          </div>
          <button aria-label="关闭编辑" className="flex size-11 shrink-0 items-center justify-center rounded-full tm-chip tm-focus" disabled={isSaving} onClick={onCancel} type="button">
            <X className="size-4" />
          </button>
        </div>

        <TextField label="显示名称" onChange={setTitle} placeholder={ticket.fileName} value={title} />

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>票据分类</span>
          <select className={FIELD_SELECT_CLASS} onChange={(event) => setTicketCategory(event.target.value as TicketCategory)} value={ticketCategory}>
            {ticketCategoryOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>绑定对象</span>
          <select className={FIELD_SELECT_CLASS} onChange={(event) => setBindingTarget(event.target.value as BindingTarget)} value={bindingTarget}>
            <option value="trip">整个旅行：机票、酒店、保险等</option>
            <option value="unassigned">不绑定：暂时未分类</option>
            {bindingOptions.map((option) => <option key={option.id} value={`item:${option.id}`}>{option.label}</option>)}
          </select>
        </label>

        <label className="block">
          <span className={FIELD_LABEL_CLASS}>备注</span>
          <textarea className={`${FIELD_TEXTAREA_CLASS} min-h-24 resize-none`} onChange={(event) => setNote(event.target.value)} placeholder="例如：订单号、取票位置、同行人说明" value={note} />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Button disabled={isSaving} onClick={onCancel} variant="secondary">取消</Button>
          <Button icon={<Save className="size-4" />} loading={isSaving} onClick={() => onSave({ bindingTarget, note, ticketCategory, title })}>保存修改</Button>
        </div>
      </div>
    </div>
  )
}

function TicketActionsMenu({
  busy,
  canClearCache,
  canRestoreCache,
  canRetryUpload,
  className,
  displayTitle,
  onClearCache,
  onDelete,
  onEdit,
  onRestoreCache,
  onRetryUpload,
}: {
  busy: boolean
  canClearCache: boolean
  canRestoreCache: boolean
  canRetryUpload: boolean
  className: string
  displayTitle: string
  onClearCache: () => void
  onDelete: () => void
  onEdit: () => void
  onRestoreCache: () => void
  onRetryUpload: () => void
}) {
  return (
    <details className={`group z-10 ${className}`}>
      <summary aria-label={`${displayTitle}更多操作`} className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg bg-surface/90 text-on-surface shadow-sm backdrop-blur marker:hidden [&::-webkit-details-marker]:hidden tm-focus">
        <MoreHorizontal className="size-5" />
      </summary>
      <div className="absolute right-0 top-11 z-20 w-40 overflow-hidden rounded-lg bg-surface p-1 shadow-xl ring-1 ring-outline-variant/30">
        <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-on-surface tm-focus" onClick={onEdit} type="button"><Pencil className="size-4" />编辑</button>
        {canClearCache ? <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-on-surface-variant tm-focus" disabled={busy} onClick={onClearCache} type="button"><HardDrive className="size-4" />清理缓存</button> : null}
        {canRestoreCache ? <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-on-surface-variant tm-focus" disabled={busy} onClick={onRestoreCache} type="button"><RefreshCw className="size-4" />重新同步</button> : null}
        {canRetryUpload ? <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-amber-800 tm-focus" disabled={busy} onClick={onRetryUpload} type="button"><RefreshCw className="size-4" />重试上传</button> : null}
        <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm font-semibold text-error tm-focus" onClick={onDelete} type="button"><Trash2 className="size-4" />删除</button>
      </div>
    </details>
  )
}

function CopyTicketFields({
  selectedFile,
  fileInputKey,
  setSelectedFile,
}: {
  selectedFile: File | null
  fileInputKey: number
  setSelectedFile: (file: File | null) => void
}) {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>文件 *</span>
      <input className="mt-2 block w-full min-w-0 tm-field px-3 py-3 text-sm text-on-surface file:mr-3 file:rounded-lg file:border-0 file:bg-sky-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sky-700 dark:text-outline-variant dark:file:bg-sky-950/45 dark:file:text-sky-300" key={fileInputKey} onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} type="file" />
      {selectedFile ? <span className="mt-2 block rounded-xl bg-surface-container-low/75 px-3 py-2 text-xs tm-muted ring-1 ring-outline-variant/30 dark:bg-surface-container-highest/40 dark:ring-outline-variant/30">已选择：{selectedFile.name} · {formatFileSize(selectedFile.size)}</span> : null}
    </label>
  )
}

function ReferenceTicketFields({
  fileName,
  location,
  setFileName,
  setLocation,
}: {
  fileName: string
  location: string
  setFileName: (value: string) => void
  setLocation: (value: string) => void
}) {
  return (
    <div className="space-y-3">
      <TextField label="原文件名" onChange={setFileName} placeholder="例如：酒店订单.pdf" value={fileName} />
      <TextField label="文件位置说明" onChange={setLocation} placeholder="例如：iCloud Drive/英国签证/酒店订单.pdf" required value={location} />
      <InlineStatus tone="warning">旅图只记录这个文件的位置说明，不保存文件内容，也不能直接打开本地路径。请按你填写的位置到“文件”App、网盘或相册中查找。</InlineStatus>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>{label}{required ? <span className="text-red-500"> *</span> : null}</span>
      <input className={FIELD_INPUT_CLASS} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} />
    </label>
  )
}
