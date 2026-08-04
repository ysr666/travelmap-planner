import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Cloud, FileText, FileUp, FolderOpen, Inbox, Loader2, Mail, MoreHorizontal, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { BottomSheet } from '../components/ui/BottomSheet'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { listTrips } from '../db'
import {
  createImapConnector,
  deleteTravelInboxConnector,
  getGmailAuthorizationUrl,
  getTravelInboxConnectorConfig,
  listTravelInboxConnectors,
  syncTravelInboxConnector,
  updateTravelInboxConnector,
  type CloudTravelInboxConnector,
} from '../lib/travelInboxConnectors'
import {
  assignTravelInboxAccountSource,
  discardTravelInboxAccountSource,
  listTravelInboxAccountSources,
  processTravelInboxAccountSource,
  processTravelInboxAccountSourceBatch,
  refreshCloudTravelInboxSources,
  TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT,
} from '../lib/ai/travelInboxOrganization'
import {
  createTravelInboxLocalFolderConnector,
  deleteTravelInboxLocalFolderConnector,
  importTravelInboxFiles,
  listTravelInboxLocalFolderConnectors,
  scanTravelInboxLocalFolder,
  supportsTravelInboxLocalFolders,
  TRAVEL_INBOX_FILE_ACCEPT,
} from '../lib/travelInboxLocalFolders'
import { getTravelInboxEntry } from '../lib/ai/travelInbox'
import { getRouteParams, navigateTo } from '../lib/routes'
import type { TravelInboxAccountSource, TravelInboxEntry, TravelInboxLocalConnector, Trip } from '../types'

export function TravelInboxPage() {
  const connectorConfig = getTravelInboxConnectorConfig()
  const params = getRouteParams()
  const focusedEntryId = params.get('inboxEntryId')
  const [sources, setSources] = useState<TravelInboxAccountSource[]>([])
  const [connectors, setConnectors] = useState<CloudTravelInboxConnector[]>([])
  const [localConnectors, setLocalConnectors] = useState<TravelInboxLocalConnector[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false)
  const [imapOpen, setImapOpen] = useState(false)
  const [imap, setImap] = useState({ folder: 'INBOX', host: '', name: '', password: '', username: '' })
  const [gmailLabelId, setGmailLabelId] = useState('INBOX')
  const [backfillDays, setBackfillDays] = useState<0 | 7 | 30>(0)
  const [autoAiConsent, setAutoAiConsent] = useState(false)
  const [bulkTripId, setBulkTripId] = useState('')
  const [focusedEntry, setFocusedEntry] = useState<TravelInboxEntry | null>(null)
  const [focusedEntryMissing, setFocusedEntryMissing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const processing = useRef(new Set<string>())

  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextTrips, nextLocal] = await Promise.all([listTrips(), listTravelInboxLocalFolderConnectors()])
      setTrips(nextTrips)
      setBulkTripId((current) => current || (nextTrips.length === 1 ? nextTrips[0].id : ''))
      setLocalConnectors(nextLocal)
      if (connectorConfig.configured) {
        const [nextConnectors] = await Promise.all([listTravelInboxConnectors(), refreshCloudTravelInboxSources()])
        setConnectors(nextConnectors)
      }
      setSources(await listTravelInboxAccountSources())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '读取旅行收件箱失败。')
      setSources(await listTravelInboxAccountSources())
    }
  }, [connectorConfig.configured])

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timeout)
  }, [load])

  useEffect(() => {
    if (!focusedEntryId) return
    let cancelled = false
    void getTravelInboxEntry(focusedEntryId).then((entry) => {
      if (cancelled) return
      setFocusedEntry(entry ?? null)
      setFocusedEntryMissing(!entry)
    })
    return () => { cancelled = true }
  }, [focusedEntryId])

  useEffect(() => {
    const scan = async () => {
      for (const connector of await listTravelInboxLocalFolderConnectors()) {
        if (connector.status !== 'active' || processing.current.has(`scan:${connector.id}`)) continue
        processing.current.add(`scan:${connector.id}`)
        try { await scanTravelInboxLocalFolder(connector) } catch { /* surfaced on manual refresh */ }
        finally { processing.current.delete(`scan:${connector.id}`) }
      }
      const [nextSources, nextConnectors] = await Promise.all([
        listTravelInboxAccountSources(),
        listTravelInboxLocalFolderConnectors(),
      ])
      setSources(nextSources)
      setLocalConnectors(nextConnectors)
    }
    void scan()
    const visible = () => { if (document.visibilityState === 'visible') void scan() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [])

  useEffect(() => {
    const queued = sources.filter((source) => ['queued', 'extracting', 'classifying', 'building_preview'].includes(source.status))
    const localQueued = queued.filter((source) => source.connectorKind === 'local_folder')
    if (localQueued.length > 0 && !processing.current.has('local-folder-batch')) {
      const batch = localQueued.slice(0, TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT)
      processing.current.add('local-folder-batch')
      for (const source of batch) processing.current.add(source.id)
      void processTravelInboxAccountSourceBatch(batch.map((source) => source.id))
        .catch(() => undefined)
        .finally(async () => {
          processing.current.delete('local-folder-batch')
          for (const source of batch) processing.current.delete(source.id)
          setSources(await listTravelInboxAccountSources())
        })
    }

    const activeIndividualCount = queued.filter((source) =>
      source.connectorKind !== 'local_folder' && processing.current.has(source.id),
    ).length
    const cloudQueued = queued
      .filter((source) => source.connectorKind !== 'local_folder')
      .slice(0, Math.max(0, 2 - activeIndividualCount))
    for (const source of cloudQueued) {
      if (processing.current.has(source.id)) continue
      processing.current.add(source.id)
      void processTravelInboxAccountSource(source.id)
        .catch(() => undefined)
        .finally(async () => {
          processing.current.delete(source.id)
          setSources(await listTravelInboxAccountSources())
        })
    }
  }, [sources])

  const assignableSources = useMemo(
    () => sources.filter((source) => source.status === 'needs_assignment'),
    [sources],
  )

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError(null); setMessage(null)
    try { await work(); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败。') }
    finally { setBusy(null) }
  }

  async function importFiles(files: File[]) {
    if (files.length === 0) return
    await run('files', async () => {
      const result = await importTravelInboxFiles(files)
      if (result.created.length === 0) throw new Error(result.warnings[0] ?? '没有可导入的文件。')
      setMessage(result.warnings.length > 0
        ? `已导入 ${result.created.length} 项，${result.warnings.length} 项未处理。`
        : `已导入 ${result.created.length} 项，正在整理。`)
      setSourceSheetOpen(false)
    })
  }

  async function connectGmail() {
    if (!autoAiConsent) { setError('请先开启自动整理。'); return }
    await run('gmail', async () => {
      const result = await getGmailAuthorizationUrl({ autoAiEnabled: true, backfillDays, labelId: gmailLabelId.trim() || 'INBOX', name: 'Gmail' })
      window.location.assign(result.authorizationUrl)
    })
  }

  async function connectImap() {
    if (!autoAiConsent) { setError('请先开启自动整理。'); return }
    await run('imap', async () => {
      await createImapConnector({ ...imap, autoAiEnabled: true, backfillDays })
      setImap({ folder: 'INBOX', host: '', name: '', password: '', username: '' })
      setImapOpen(false)
      setMessage('邮箱连接器已创建，将从现在开始同步。')
    })
  }

  return (
    <div className="space-y-4 pb-4" data-testid="travel-inbox-page">
      <input
        accept={TRAVEL_INBOX_FILE_ACCEPT}
        aria-label="选择旅行材料"
        className="sr-only"
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? [])
          event.currentTarget.value = ''
          void importFiles(files)
        }}
        ref={fileInputRef}
        type="file"
      />

      {sources.length > 0 ? (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-lg font-semibold text-on-surface">待整理</h2>
            <span className="text-xs tm-muted">{sources.length} 项</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              aria-label="刷新收件箱"
              className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus"
              disabled={busy === 'refresh'}
              onClick={() => void run('refresh', async () => {
                for (const connector of localConnectors) await scanTravelInboxLocalFolder(connector)
                if (connectorConfig.configured) await refreshCloudTravelInboxSources()
              })}
              type="button"
            >
              <RefreshCw className={`size-5 ${busy === 'refresh' ? 'animate-spin' : ''}`} />
            </button>
            <button
              aria-label="导入材料"
              className="flex size-11 items-center justify-center rounded-lg bg-primary text-on-primary tm-focus"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              <Plus className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      {focusedEntryId ? (
        <Card className="space-y-3 border-primary/40" data-testid="travel-inbox-focused-entry" variant="grouped">
          <div><p className="text-xs font-semibold text-primary">来源内容</p><h3 className="mt-1 font-semibold text-on-surface">{focusedEntry?.label ?? '来源已不可用'}</h3></div>
          {focusedEntry ? <><p className="text-xs tm-muted">{focusedEntry.fileName || focusedEntry.sourceKind} · {new Date(focusedEntry.createdAt).toLocaleString('zh-CN')}</p><pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-high p-3 text-xs leading-5 text-on-surface">{focusedEntry.extractedText || '该来源没有可显示的提取文本。'}</pre></> : null}
          {focusedEntryMissing ? <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">原始来源已经删除，账单仍保留来源摘要。</p> : null}
        </Card>
      ) : null}

      {message ? <p className="rounded-lg bg-primary/10 p-3 text-sm text-primary">{message}</p> : null}
      {error ? <p className="rounded-lg bg-error-container p-3 text-sm text-on-error-container">{error}</p> : null}

      <section className="space-y-3">
        {assignableSources.length > 1 && trips.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg bg-surface-container-high p-3 sm:flex-row sm:items-end">
            {trips.length > 1 ? (
              <label className="min-w-0 flex-1 text-xs font-semibold text-on-surface">
                目标旅行
                <select
                  aria-label="批量目标旅行"
                  className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-2 text-sm font-normal"
                  onChange={(event) => setBulkTripId(event.target.value)}
                  value={bulkTripId}
                >
                  <option value="">选择目标旅行</option>
                  {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
                </select>
              </label>
            ) : <p className="min-w-0 flex-1 text-sm font-semibold text-on-surface">{trips[0].title}</p>}
            <Button
              disabled={!bulkTripId || busy === 'bulk-assign'}
              onClick={() => void run('bulk-assign', async () => {
                const batch = assignableSources.slice(0, TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT)
                const result = await processTravelInboxAccountSourceBatch(batch.map((source) => source.id), bulkTripId)
                setMessage(result.failedCount > 0
                  ? `已生成 ${result.previewCount} 个预览，${result.failedCount} 项需处理。`
                  : `已将 ${result.processedCount} 项整理为一个确认预览。`)
              })}
            >
              整理 {Math.min(assignableSources.length, TRAVEL_INBOX_BATCH_MAX_SOURCE_COUNT)} 项
            </Button>
          </div>
        ) : null}
        {sources.length === 0 ? (
          <div className="mx-auto flex min-h-64 max-w-sm flex-col items-center justify-center px-4 py-10 text-center sm:min-h-80">
            <div className="mb-4 flex size-12 items-center justify-center rounded-lg bg-primary-fixed text-primary">
              <Inbox className="size-6" />
            </div>
            <h2 className="text-lg font-semibold text-on-surface">导入旅行材料</h2>
            <p className="mt-1 text-sm leading-6 tm-muted">票据、证件和行程单都可以</p>
            <Button className="mt-5 min-w-40" icon={<FileUp className="size-4" />} loading={busy === 'files'} onClick={() => fileInputRef.current?.click()}>
              导入材料
            </Button>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/25 border-y border-outline-variant/25">
            {sources.map((source) => (
              <SourceRow
                busy={busy === `source:${source.id}`}
                key={source.id}
                onAssign={(tripId) => void run(`source:${source.id}`, async () => { await assignTravelInboxAccountSource(source.id, tripId); setMessage('整理预览已生成。') })}
                onDiscard={() => void run(`source:${source.id}`, async () => discardTravelInboxAccountSource(source))}
                onOpen={() => source.targetTripId && navigateTo('trip', { tripId: source.targetTripId })}
                onRetry={() => void run(`source:${source.id}`, async () => processTravelInboxAccountSource(source.id))}
                source={source}
                trips={trips}
              />
            ))}
          </div>
        )}
      </section>

      <button
        aria-label={`来源与导入 ${connectors.length + localConnectors.length}`}
        className="flex min-h-12 w-full items-center justify-between border-t border-outline-variant/25 px-1 pt-2 text-sm font-semibold text-on-surface-variant tm-focus"
        onClick={() => setSourceSheetOpen(true)}
        type="button"
      >
        <span>来源与导入</span>
        <span className="flex items-center gap-1 text-xs tm-muted">
          {connectors.length + localConnectors.length > 0 ? connectors.length + localConnectors.length : null}
          <ChevronRight className="size-4" />
        </span>
      </button>

      <BottomSheet maxHeight="calc(100dvh - 1rem)" onClose={() => setSourceSheetOpen(false)} open={sourceSheetOpen} title="来源与导入">
        <div className="space-y-4">
          <div className="grid gap-2">
            <Button icon={<FileUp className="size-4" />} loading={busy === 'files'} onClick={() => fileInputRef.current?.click()}>
              导入文件
            </Button>
            {supportsTravelInboxLocalFolders() ? (
              <Button icon={<FolderOpen className="size-4" />} onClick={() => void run('local', async () => {
                await createTravelInboxLocalFolderConnector(true)
                setMessage('本地文件夹已连接。')
                setSourceSheetOpen(false)
              })} variant="secondary">
                选择本地文件夹
              </Button>
            ) : null}
          </div>

          {connectorConfig.configured ? (
            <details className="rounded-lg border border-outline-variant/30 px-3 py-2">
              <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-on-surface">连接邮箱</summary>
              <div className="space-y-3 border-t border-outline-variant/20 pt-3">
                <label className="flex items-center gap-3 text-sm">
                  <input checked={autoAiConsent} className="size-4" onChange={(event) => setAutoAiConsent(event.target.checked)} type="checkbox" />
                  <span className="font-semibold text-on-surface">自动整理新材料</span>
                </label>
                <label className="text-xs font-semibold text-on-surface">
                  首次同步
                  <select className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm font-normal" onChange={(event) => setBackfillDays(Number(event.target.value) as 0 | 7 | 30)} value={backfillDays}>
                    <option value={0}>从现在开始</option>
                    <option value={7}>最近 7 天</option>
                    <option value={30}>最近 30 天</option>
                  </select>
                </label>
                <Input label="Gmail 标签" placeholder="INBOX" value={gmailLabelId} onChange={setGmailLabelId} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button disabled={busy === 'gmail' || !autoAiConsent} icon={<Mail className="size-4" />} onClick={() => void connectGmail()} variant="secondary">
                    连接 Gmail
                  </Button>
                  <Button icon={<Cloud className="size-4" />} onClick={() => setImapOpen((value) => !value)} variant="secondary">
                    其他邮箱
                  </Button>
                </div>
              </div>
            </details>
          ) : null}

          {imapOpen ? (
            <div className="grid gap-3 rounded-lg border border-outline-variant/30 p-3 sm:grid-cols-2">
              <Input label="名称" value={imap.name} onChange={(value) => setImap({ ...imap, name: value })} />
              <Input label="IMAP 主机" placeholder="imap.example.com" value={imap.host} onChange={(value) => setImap({ ...imap, host: value })} />
              <Input label="邮箱账号" value={imap.username} onChange={(value) => setImap({ ...imap, username: value })} />
              <Input label="应用专用密码" type="password" value={imap.password} onChange={(value) => setImap({ ...imap, password: value })} />
              <Input label="文件夹" value={imap.folder} onChange={(value) => setImap({ ...imap, folder: value })} />
              <div className="flex items-end"><Button disabled={busy === 'imap'} onClick={() => void connectImap()}>测试并连接</Button></div>
            </div>
          ) : null}

          {[...connectors, ...localConnectors].length > 0 ? (
            <div className="space-y-2 border-t border-outline-variant/25 pt-3">
              <p className="text-xs font-semibold tm-muted">已连接</p>
              {[...connectors, ...localConnectors].map((connector) => (
                <div className="flex items-center justify-between gap-3 py-1" key={connector.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-on-surface">{connector.name}</p>
                    <p className="text-xs tm-muted">{connector.kind === 'local_folder' ? '本地文件夹' : connector.kind === 'gmail' ? 'Gmail' : 'IMAP'}</p>
                  </div>
                  <div className="flex gap-1">
                    {'last_synced_at' in connector ? <button aria-label="立即同步" className="flex size-11 items-center justify-center rounded-lg text-primary tm-focus" onClick={() => void run(`sync:${connector.id}`, async () => { const result = await syncTravelInboxConnector(connector.id); setMessage(`同步完成：新增 ${result.imported}，跳过 ${result.skipped}。`) })} type="button"><RefreshCw className="size-4" /></button> : null}
                    {'mailbox_folder' in connector ? <button aria-label={connector.status === 'paused' ? '恢复' : '暂停'} className="flex size-11 items-center justify-center rounded-lg text-on-surface-variant tm-focus" onClick={() => void run(`toggle:${connector.id}`, async () => { await updateTravelInboxConnector(connector.id, connector.status === 'paused' ? 'active' : 'paused') })} type="button">{connector.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}</button> : null}
                    <button aria-label="删除连接器" className="flex size-11 items-center justify-center rounded-lg text-error tm-focus" onClick={() => void run(`delete:${connector.id}`, async () => { if (connector.kind === 'local_folder') await deleteTravelInboxLocalFolderConnector(connector.id); else await deleteTravelInboxConnector(connector.id) })} type="button"><Trash2 className="size-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  )
}

function SourceRow({ busy, onAssign, onDiscard, onOpen, onRetry, source, trips }: { busy: boolean; onAssign: (tripId: string) => void; onDiscard: () => void; onOpen: () => void; onRetry: () => void; source: TravelInboxAccountSource; trips: Trip[] }) {
  return (
    <div className="space-y-2 py-2.5" data-testid="travel-inbox-source">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant">
            <FileText className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-on-surface" title={source.label}>{source.label}</p>
            <p className="mt-0.5 text-xs tm-muted">{source.connectorKind === 'local_folder' ? (source.connectorId ? '文件夹' : '文件') : '邮箱'} · {statusLabel(source.status)}</p>
          </div>
        </div>
        {busy ? <Loader2 className="mt-2 size-4 animate-spin text-primary" /> : (
          <details className="relative shrink-0">
            <summary aria-label={`${source.label}更多操作`} className="flex size-11 cursor-pointer list-none items-center justify-center rounded-lg text-on-surface-variant marker:hidden [&::-webkit-details-marker]:hidden tm-focus">
              <MoreHorizontal className="size-5" />
            </summary>
            <div className="absolute right-0 top-11 z-20 w-36 rounded-lg bg-surface p-1 shadow-xl ring-1 ring-outline-variant/30">
              {source.status === 'error' ? <button className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-on-surface tm-focus" onClick={onRetry} type="button">重试</button> : null}
              <button className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm font-semibold text-error tm-focus" onClick={onDiscard} type="button"><Trash2 className="size-4" />移除</button>
            </div>
          </details>
        )}
      </div>
      {source.error ? <p className="text-xs text-red-600">{source.error}</p> : null}
      {source.status === 'needs_assignment' || source.status === 'error' ? (
        <div className="flex gap-2">
          <select aria-label="目标旅行" className="min-h-11 flex-1 rounded-lg border border-outline-variant/40 bg-surface px-2 text-sm" defaultValue="" onChange={(event) => event.target.value && onAssign(event.target.value)}>
            <option value="">选择目标旅行</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
          </select>
        </div>
      ) : null}
      {source.status === 'preview_ready' ? (
        <button className="flex min-h-11 w-full items-center justify-between rounded-lg px-2 text-sm font-semibold text-primary tm-focus" onClick={onOpen} type="button">
          <span>查看整理预览</span>
          <ChevronRight className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

function Input({ label, onChange, placeholder, type = 'text', value }: { label: string; onChange: (value: string) => void; placeholder?: string; type?: string; value: string }) { return <label className="text-xs font-semibold text-on-surface">{label}<input className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm font-normal" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} /></label> }
function statusLabel(status: TravelInboxAccountSource['status']) { return ({ queued: '等待处理', extracting: '本地提取中', classifying: 'AI 分类中', needs_assignment: '待分配', building_preview: '生成预览中', preview_ready: '预览就绪', error: '需要处理' })[status] }
