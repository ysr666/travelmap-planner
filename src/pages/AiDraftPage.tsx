import { useState } from 'react'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { navigateTo } from '../lib/routes'
import { createId } from '../db/ids'
import {
  validateAiTripDraft,
  summarizeAiTripDraft,
  type AiTripDraft,
  type AiDraftValidationError,
} from '../lib/aiTripDraft'
import { importTripPlanRecords } from '../db'
import type { Trip, Day, ItineraryItem } from '../types'

const SAMPLE_DRAFT = {
  title: '东京五日游',
  destination: '东京',
  startDate: '2025-04-01',
  endDate: '2025-04-05',
  days: [
    {
      date: '2025-04-01',
      title: '抵达与浅草',
      items: [
        {
          title: '浅草寺',
          locationName: '浅草寺',
          address: '东京都台东区浅草2-3-1',
          lat: 35.7148,
          lng: 139.7967,
          startTime: '10:00',
          endTime: '12:00',
          note: '参观雷门和仲见世通',
        },
        {
          title: '东京晴空塔',
          locationName: '东京晴空塔',
          startTime: '14:00',
          endTime: '16:00',
          previousTransportMode: 'transit',
        },
      ],
    },
    {
      date: '2025-04-02',
      title: '涩谷与原宿',
      items: [
        {
          title: '明治神宫',
          locationName: '明治神宫',
          lat: 35.6764,
          lng: 139.6993,
          startTime: '09:00',
        },
        {
          title: '涩谷十字路口',
          startTime: '14:00',
          previousTransportMode: 'transit',
        },
      ],
    },
  ],
}

export function AiDraftPage() {
  const [jsonText, setJsonText] = useState('')
  const [draft, setDraft] = useState<AiTripDraft | null>(null)
  const [errors, setErrors] = useState<AiDraftValidationError[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [importing, setImporting] = useState(false)

  function handleLoadSample() {
    setJsonText(JSON.stringify(SAMPLE_DRAFT, null, 2))
    setDraft(null)
    setErrors([])
  }

  function handleParse() {
    try {
      const input = JSON.parse(jsonText)
      const result = validateAiTripDraft(input)
      if (result.valid && result.draft) {
        setDraft(result.draft)
        setErrors([])
      } else {
        setDraft(null)
        setErrors(result.errors)
      }
    } catch {
      setDraft(null)
      setErrors([{ path: 'root', message: 'JSON 格式无效，请检查语法。' }])
    }
  }

  async function handleConfirmImport() {
    if (!draft) return
    setImporting(true)
    try {
      const now = Date.now()
      const tripId = createId('trip')

      const trip: Trip = {
        id: tripId,
        title: draft.title,
        destination: draft.destination,
        startDate: draft.startDate,
        endDate: draft.endDate,
        createdAt: now,
        updatedAt: now,
      }

      const days: Day[] = []
      const itineraryItems: ItineraryItem[] = []

      draft.days.forEach((day, dayIndex) => {
        const dayId = createId('day')
        days.push({
          id: dayId,
          tripId,
          date: day.date,
          title: day.title ?? `第 ${dayIndex + 1} 天`,
          sortOrder: dayIndex,
        })

        day.items.forEach((item, itemIndex) => {
          itineraryItems.push({
            id: createId('item'),
            tripId,
            dayId,
            title: item.title,
            startTime: item.startTime,
            endTime: item.endTime,
            locationName: item.locationName,
            address: item.address,
            lat: item.lat,
            lng: item.lng,
            previousTransportMode: item.previousTransportMode,
            notes: item.note,
            ticketIds: [],
            sortOrder: itemIndex,
            createdAt: now,
            updatedAt: now,
          })
        })
      })

      const result = await importTripPlanRecords({
        trip,
        days,
        itineraryItems,
        ticketMetas: [],
        ticketBlobs: [],
      })
      navigateTo('trip', { tripId: result.tripId })
    } catch (error) {
      setErrors([{ path: 'root', message: `导入失败: ${error instanceof Error ? error.message : '未知错误'}` }])
      setShowConfirm(false)
    } finally {
      setImporting(false)
    }
  }

  const summary = draft ? summarizeAiTripDraft(draft) : null

  return (
    <div className="mx-auto max-w-lg space-y-4 p-4 pb-24">
      <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">AI 行程草稿</h1>

      <Card className="space-y-4">
        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
            粘贴 JSON 草稿
          </label>
          <textarea
            className="h-48 w-full rounded-xl border border-slate-200 p-3 font-mono text-sm tm-surface dark:border-slate-700"
            placeholder='{"title": "...", "startDate": "YYYY-MM-DD", ...}'
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button onClick={handleLoadSample} variant="secondary">
            加载示例草稿
          </Button>
          <Button onClick={handleParse} disabled={!jsonText.trim()}>
            解析草稿
          </Button>
        </div>
      </Card>

      {errors.length > 0 && (
        <Card className="border-red-200 bg-red-50/50 dark:border-red-800 dark:bg-red-950/30">
          <h3 className="mb-2 font-medium text-red-800 dark:text-red-200">验证错误</h3>
          <ul className="space-y-1 text-sm text-red-700 dark:text-red-300">
            {errors.map((error, i) => (
              <li key={i}>
                {error.path !== 'root' && <span className="font-mono text-xs">{error.path}: </span>}
                {error.message}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary && (
        <>
          <Card className="space-y-3">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">草稿摘要</h3>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="tm-muted">旅行标题</dt>
              <dd className="font-medium">{summary.title}</dd>
              <dt className="tm-muted">目的地</dt>
              <dd>{summary.destination || '未指定'}</dd>
              <dt className="tm-muted">日期范围</dt>
              <dd>{summary.startDate} 至 {summary.endDate}</dd>
              <dt className="tm-muted">天数</dt>
              <dd>{summary.daysCount} 天</dd>
              <dt className="tm-muted">行程点</dt>
              <dd>{summary.itemsCount} 个</dd>
            </dl>
          </Card>

          <Card className="space-y-3">
            <h3 className="font-medium text-slate-900 dark:text-slate-100">行程预览</h3>
            <div className="space-y-4">
              {draft!.days.map((day, dayIndex) => (
                <div key={dayIndex} className="space-y-2">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {day.date}
                    </span>
                    {day.title && (
                      <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {day.title}
                      </span>
                    )}
                  </div>
                  <ul className="space-y-1 pl-4">
                    {day.items.map((item, itemIndex) => (
                      <li key={itemIndex} className="text-sm">
                        <span className="font-medium">{item.title}</span>
                        {item.startTime && <span className="ml-2 tm-muted">{item.startTime}</span>}
                        {item.locationName && <span className="ml-2 tm-muted">@ {item.locationName}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>

          <Card className="border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/30">
            <p className="text-sm text-blue-800 dark:text-blue-200">
              当前仅在本机解析草稿，不会调用外部 AI。
              <br />
              确认导入后才会写入本地旅行。
            </p>
          </Card>

          <Button onClick={() => setShowConfirm(true)} className="w-full">
            确认导入
          </Button>
        </>
      )}

      <ConfirmDialog
        open={showConfirm}
        title="导入行程草稿"
        body={`将创建新的本地旅行\n不会自动生成路线\n不会创建票据\n不会上传云端\n可在创建后继续编辑`}
        confirmLabel="确认导入"
        cancelLabel="取消"
        loading={importing}
        onCancel={() => setShowConfirm(false)}
        onConfirm={handleConfirmImport}
      />
    </div>
  )
}
