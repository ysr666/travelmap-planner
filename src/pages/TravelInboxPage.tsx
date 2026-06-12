import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cloud, FolderOpen, Inbox, Loader2, Mail, Pause, Play, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
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
  refreshCloudTravelInboxSources,
} from '../lib/ai/travelInboxOrganization'
import {
  createTravelInboxLocalFolderConnector,
  deleteTravelInboxLocalFolderConnector,
  listTravelInboxLocalFolderConnectors,
  scanTravelInboxLocalFolder,
  supportsTravelInboxLocalFolders,
} from '../lib/travelInboxLocalFolders'
import { navigateTo } from '../lib/routes'
import type { TravelInboxAccountSource, TravelInboxLocalConnector, Trip } from '../types'

export function TravelInboxPage() {
  const connectorConfig = getTravelInboxConnectorConfig()
  const [sources, setSources] = useState<TravelInboxAccountSource[]>([])
  const [connectors, setConnectors] = useState<CloudTravelInboxConnector[]>([])
  const [localConnectors, setLocalConnectors] = useState<TravelInboxLocalConnector[]>([])
  const [trips, setTrips] = useState<Trip[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [imapOpen, setImapOpen] = useState(false)
  const [imap, setImap] = useState({ folder: 'INBOX', host: '', name: '', password: '', username: '' })
  const [gmailLabelId, setGmailLabelId] = useState('INBOX')
  const [backfillDays, setBackfillDays] = useState<0 | 7 | 30>(0)
  const [autoAiConsent, setAutoAiConsent] = useState(false)
  const processing = useRef(new Set<string>())

  const load = useCallback(async () => {
    setError(null)
    try {
      const [nextTrips, nextLocal] = await Promise.all([listTrips(), listTravelInboxLocalFolderConnectors()])
      setTrips(nextTrips)
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
    const scan = async () => {
      for (const connector of await listTravelInboxLocalFolderConnectors()) {
        if (connector.status !== 'active' || processing.current.has(`scan:${connector.id}`)) continue
        processing.current.add(`scan:${connector.id}`)
        try { await scanTravelInboxLocalFolder(connector) } catch { /* surfaced on manual refresh */ }
        finally { processing.current.delete(`scan:${connector.id}`) }
      }
      setSources(await listTravelInboxAccountSources())
    }
    void scan()
    const visible = () => { if (document.visibilityState === 'visible') void scan() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [])

  useEffect(() => {
    const queued = sources.filter((source) => ['queued', 'extracting', 'classifying', 'building_preview'].includes(source.status))
    for (const source of queued) {
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

  const counts = useMemo(() => ({
    error: sources.filter((source) => source.status === 'error').length,
    needsAssignment: sources.filter((source) => source.status === 'needs_assignment').length,
    preview: sources.filter((source) => source.status === 'preview_ready').length,
    processing: sources.filter((source) => ['queued', 'extracting', 'classifying', 'building_preview'].includes(source.status)).length,
  }), [sources])

  async function run(action: string, work: () => Promise<void>) {
    setBusy(action); setError(null); setMessage(null)
    try { await work(); await load() } catch (caught) { setError(caught instanceof Error ? caught.message : '操作失败。') }
    finally { setBusy(null) }
  }

  async function connectGmail() {
    if (!autoAiConsent) { setError('请先确认持续拉取和自动 AI 整理授权。'); return }
    await run('gmail', async () => {
      const result = await getGmailAuthorizationUrl({ autoAiEnabled: true, backfillDays, labelId: gmailLabelId.trim() || 'INBOX', name: 'Gmail' })
      window.location.assign(result.authorizationUrl)
    })
  }

  async function connectImap() {
    if (!autoAiConsent) { setError('请先确认持续拉取和自动 AI 整理授权。'); return }
    await run('imap', async () => {
      await createImapConnector({ ...imap, autoAiEnabled: true, backfillDays })
      setImap({ folder: 'INBOX', host: '', name: '', password: '', username: '' })
      setImapOpen(false)
      setMessage('邮箱连接器已创建，将从现在开始同步。')
    })
  }

  return (
    <div className="space-y-5 px-4 pb-28 pt-24" data-testid="travel-inbox-page">
      <section>
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Travel Inbox</p>
        <h2 className="mt-1 text-2xl font-bold text-on-surface">旅行收件箱</h2>
        <p className="mt-2 text-sm leading-6 tm-muted">把订单邮件、PDF、截图和票据集中到待整理来源。本地提取后只发送文本给 AI，写入旅行前仍需确认。</p>
      </section>

      <div className="grid grid-cols-4 gap-2">
        <Summary value={counts.processing} label="处理中" />
        <Summary value={counts.needsAssignment} label="待分配" />
        <Summary value={counts.preview} label="预览就绪" />
        <Summary value={counts.error} label="错误" />
      </div>

      <Card className="space-y-4" variant="grouped">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="font-semibold text-on-surface">来源连接器</h3><p className="text-xs tm-muted">邮箱后台拉取；本地文件夹在此浏览器打开时扫描。</p></div>
          <Button icon={<RefreshCw className="size-4" />} onClick={() => void run('refresh', async () => { for (const connector of localConnectors) await scanTravelInboxLocalFolder(connector); if (connectorConfig.configured) await refreshCloudTravelInboxSources() })} variant="ghost">刷新</Button>
        </div>

        {connectorConfig.configured ? (
          <div className="space-y-3 rounded-xl bg-surface-container-high p-3">
            <label className="flex items-start gap-3 text-sm">
              <input checked={autoAiConsent} className="mt-1 size-4" onChange={(event) => setAutoAiConsent(event.target.checked)} type="checkbox" />
              <span><strong className="block text-on-surface">允许持续拉取并自动 AI 整理</strong><span className="mt-1 block text-xs tm-muted">原文件私有暂存；应用打开后本地提取，只把文本发送给 AI。最终写入仍需确认。</span></span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-on-surface">首次同步<select className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm font-normal" onChange={(event) => setBackfillDays(Number(event.target.value) as 0 | 7 | 30)} value={backfillDays}><option value={0}>从连接时刻开始</option><option value={7}>回捞最近 7 天</option><option value={30}>回捞最近 30 天</option></select></label>
              <Input label="Gmail 标签 ID" placeholder="INBOX" value={gmailLabelId} onChange={setGmailLabelId} />
            </div>
          </div>
        ) : <p className="rounded-xl bg-surface-container-high p-3 text-sm tm-muted">连接器后端未配置，现有手动上传和本地文件夹仍可使用。</p>}

        <div className="grid gap-2 sm:grid-cols-3">
          {connectorConfig.configured ? <Button disabled={busy === 'gmail'} icon={<Mail className="size-4" />} onClick={() => void connectGmail()} variant="secondary">连接 Gmail</Button> : null}
          {connectorConfig.configured ? <Button icon={<Cloud className="size-4" />} onClick={() => setImapOpen((value) => !value)} variant="secondary">连接其他邮箱</Button> : null}
          {supportsTravelInboxLocalFolders() ? <Button icon={<FolderOpen className="size-4" />} onClick={() => void run('local', async () => { await createTravelInboxLocalFolderConnector(true); setMessage('本地文件夹已连接。') })} variant="secondary">连接本地文件夹</Button> : null}
        </div>

        {imapOpen ? (
          <div className="grid gap-3 rounded-xl border border-outline-variant/30 p-3 sm:grid-cols-2">
            <Input label="名称" value={imap.name} onChange={(value) => setImap({ ...imap, name: value })} />
            <Input label="IMAP 主机" placeholder="imap.example.com" value={imap.host} onChange={(value) => setImap({ ...imap, host: value })} />
            <Input label="邮箱账号" value={imap.username} onChange={(value) => setImap({ ...imap, username: value })} />
            <Input label="应用专用密码" type="password" value={imap.password} onChange={(value) => setImap({ ...imap, password: value })} />
            <Input label="文件夹" value={imap.folder} onChange={(value) => setImap({ ...imap, folder: value })} />
            <div className="flex items-end"><Button disabled={busy === 'imap'} onClick={() => void connectImap()}>测试并连接</Button></div>
          </div>
        ) : null}

        {[...connectors, ...localConnectors].map((connector) => (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-container-high p-3" key={connector.id}>
            <div className="min-w-0"><p className="truncate text-sm font-semibold text-on-surface">{connector.name}</p><p className="text-xs tm-muted">{connector.kind === 'local_folder' ? '本地文件夹' : connector.kind === 'gmail' ? 'Gmail' : 'IMAP'} · {connector.status}</p></div>
            <div className="flex gap-1">
              {'last_synced_at' in connector ? <button aria-label="立即同步" className="flex size-11 items-center justify-center rounded-xl text-primary tm-focus" onClick={() => void run(`sync:${connector.id}`, async () => { const result = await syncTravelInboxConnector(connector.id); setMessage(`同步完成：新增 ${result.imported}，跳过 ${result.skipped}。`) })} type="button"><RefreshCw className="size-4" /></button> : null}
              {'mailbox_folder' in connector ? <button aria-label={connector.status === 'paused' ? '恢复' : '暂停'} className="flex size-11 items-center justify-center rounded-xl text-on-surface-variant tm-focus" onClick={() => void run(`toggle:${connector.id}`, async () => { await updateTravelInboxConnector(connector.id, connector.status === 'paused' ? 'active' : 'paused') })} type="button">{connector.status === 'paused' ? <Play className="size-4" /> : <Pause className="size-4" />}</button> : null}
              <button aria-label="删除连接器" className="flex size-11 items-center justify-center rounded-xl text-red-600 tm-focus" onClick={() => void run(`delete:${connector.id}`, async () => { if (connector.kind === 'local_folder') await deleteTravelInboxLocalFolderConnector(connector.id); else await deleteTravelInboxConnector(connector.id) })} type="button"><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </Card>

      <Card className="space-y-3" variant="grouped">
        <div><h3 className="font-semibold text-on-surface">待整理来源</h3><p className="text-xs tm-muted">高置信唯一匹配会自动生成预览，其余来源由你选择旅行。</p></div>
        {sources.length === 0 ? <EmptyState icon={<Inbox className="size-6" />} title="还没有来源" body="连接邮箱或本地文件夹后，新材料会出现在这里。" /> : sources.map((source) => (
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
      </Card>

      {message ? <p className="rounded-xl bg-primary/10 p-3 text-sm text-primary">{message}</p> : null}
      {error ? <p className="rounded-xl bg-error-container p-3 text-sm text-on-error-container">{error}</p> : null}
    </div>
  )
}

function SourceRow({ busy, onAssign, onDiscard, onOpen, onRetry, source, trips }: { busy: boolean; onAssign: (tripId: string) => void; onDiscard: () => void; onOpen: () => void; onRetry: () => void; source: TravelInboxAccountSource; trips: Trip[] }) {
  return (
    <div className="space-y-2 rounded-xl bg-surface-container-high p-3" data-testid="travel-inbox-source">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0"><p className="break-words text-sm font-semibold text-on-surface">{source.label}</p><p className="text-xs tm-muted">{source.connectorKind === 'local_folder' ? '本地文件夹' : source.connectorKind.toUpperCase()} · {statusLabel(source.status)}</p></div>
        {busy ? <Loader2 className="size-4 animate-spin text-primary" /> : <button aria-label="丢弃来源" className="flex size-11 shrink-0 items-center justify-center rounded-xl text-red-600 tm-focus" onClick={onDiscard} type="button"><Trash2 className="size-4" /></button>}
      </div>
      {source.classification ? <p className="text-xs tm-muted">{source.classification.reason} · {source.classification.confidence}</p> : null}
      {source.error ? <p className="text-xs text-red-600">{source.error}</p> : null}
      {source.status === 'needs_assignment' || source.status === 'error' ? (
        <div className="flex flex-wrap gap-2">
          <select aria-label="目标旅行" className="min-h-11 flex-1 rounded-lg border border-outline-variant/40 bg-surface px-2 text-sm" defaultValue="" onChange={(event) => event.target.value && onAssign(event.target.value)}>
            <option value="">选择目标旅行</option>{trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.title}</option>)}
          </select>
          {source.status === 'error' ? <Button onClick={onRetry} variant="ghost">重试</Button> : null}
        </div>
      ) : null}
      {source.status === 'preview_ready' ? <Button onClick={onOpen} variant="secondary">查看整理预览</Button> : null}
    </div>
  )
}

function Summary({ label, value }: { label: string; value: number }) { return <div className="rounded-xl bg-surface-container-high p-2 text-center"><p className="text-xl font-bold text-on-surface">{value}</p><p className="text-[11px] tm-muted">{label}</p></div> }
function Input({ label, onChange, placeholder, type = 'text', value }: { label: string; onChange: (value: string) => void; placeholder?: string; type?: string; value: string }) { return <label className="text-xs font-semibold text-on-surface">{label}<input className="mt-1 min-h-11 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 text-sm font-normal" onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={type} value={value} /></label> }
function statusLabel(status: TravelInboxAccountSource['status']) { return ({ queued: '等待处理', extracting: '本地提取中', classifying: 'AI 分类中', needs_assignment: '待分配', building_preview: '生成预览中', preview_ready: '预览就绪', error: '需要处理' })[status] }
