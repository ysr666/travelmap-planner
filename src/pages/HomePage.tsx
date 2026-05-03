import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, MapPinned, Plus, Trash2, Upload } from 'lucide-react'
import { createDemoTrip, createTrip, deleteTripCascade, listTrips } from '../db'
import { navigateTo } from '../lib/routes'
import type { Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { EmptyState } from '../components/ui/EmptyState'
import { SectionHeader } from '../components/ui/SectionHeader'

type TripFormState = {
  title: string
  destination: string
  startDate: string
  endDate: string
  notes: string
}

const initialFormState: TripFormState = {
  title: '',
  destination: '',
  startDate: '',
  endDate: '',
  notes: '',
}

export function HomePage() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [form, setForm] = useState<TripFormState>(initialFormState)
  const [isCreating, setIsCreating] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isCreatingDemo, setIsCreatingDemo] = useState(false)
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null)
  const [pendingDeleteTrip, setPendingDeleteTrip] = useState<Trip | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const hasTrips = trips.length > 0

  const tripStats = useMemo(() => {
    return {
      count: trips.length,
      latest: trips[0]?.updatedAt,
    }
  }, [trips])

  async function refreshTrips() {
    setError(null)
    const nextTrips = await listTrips()
    setTrips(nextTrips)
  }

  useEffect(() => {
    let isMounted = true

    async function load() {
      setIsLoading(true)
      setError(null)
      try {
        const nextTrips = await listTrips()
        if (isMounted) {
          setTrips(nextTrips)
        }
      } catch (caught) {
        if (isMounted) {
          setError(caught instanceof Error ? caught.message : '读取本地数据库失败')
        }
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      isMounted = false
    }
  }, [])

  async function handleCreateTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setFormError(null)
    setError(null)

    const title = form.title.trim()
    const destination = form.destination.trim()
    const notes = form.notes.trim()

    if (!title) {
      setFormError('请填写旅行标题')
      return
    }

    if (!form.startDate || !form.endDate) {
      setFormError('请选择开始日期和结束日期')
      return
    }

    if (form.endDate < form.startDate) {
      setFormError('结束日期不能早于开始日期')
      return
    }

    setIsSubmitting(true)
    try {
      await createTrip({
        title,
        destination: destination || '未填写目的地',
        startDate: form.startDate,
        endDate: form.endDate,
        notes: notes || undefined,
      })
      setForm(initialFormState)
      setIsCreating(false)
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '新建旅行失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleCreateDemoTrip() {
    setIsCreatingDemo(true)
    setError(null)
    try {
      await createDemoTrip()
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '创建示例旅行失败')
    } finally {
      setIsCreatingDemo(false)
    }
  }

  async function confirmDeleteTrip() {
    if (!pendingDeleteTrip) {
      return
    }

    const trip = pendingDeleteTrip
    setDeletingTripId(trip.id)
    setError(null)
    try {
      await deleteTripCascade(trip.id)
      setPendingDeleteTrip(null)
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除旅行失败')
    } finally {
      setDeletingTripId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden pb-[max(1rem,env(safe-area-inset-bottom))]">
      <section className="shrink-0 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_8px_22px_rgba(47,65,88,0.05)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-sky-600">本地旅行总控台</p>
            <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">旅图</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              管理行程、地图、交通段和票据。数据只保存在当前浏览器。
            </p>
          </div>
          <div className="shrink-0 rounded-xl bg-sky-50 px-3 py-2 text-center">
            <p className="text-lg font-semibold text-sky-600">{tripStats.count}</p>
            <p className="text-xs font-semibold text-sky-500">旅行</p>
          </div>
        </div>
        {tripStats.latest ? (
          <p className="mt-3 text-xs text-slate-400">最近更新：{formatDateTime(tripStats.latest)}</p>
        ) : null}
      </section>

      {error ? (
        <div className="shrink-0 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      ) : null}

      <section className="flex min-h-0 flex-1 flex-col gap-3">
        {isCreating ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
            <Card>
              <form className="space-y-3" onSubmit={handleCreateTrip}>
                <div>
                  <h3 className="text-base font-semibold text-slate-950">新建旅行</h3>
                  <p className="mt-1 text-sm text-slate-500">创建后保存在本机 IndexedDB。</p>
                </div>
                <FormField
                  label="旅行标题"
                  onChange={(value) => setForm((current) => ({ ...current, title: value }))}
                  placeholder="例如：东京春日旅行"
                  required
                  value={form.title}
                />
                <FormField
                  label="目的地"
                  onChange={(value) => setForm((current) => ({ ...current, destination: value }))}
                  placeholder="例如：日本东京"
                  value={form.destination}
                />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <FormField
                    label="开始日期"
                    onChange={(value) => setForm((current) => ({ ...current, startDate: value }))}
                    required
                    type="date"
                    value={form.startDate}
                  />
                  <FormField
                    label="结束日期"
                    onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
                    required
                    type="date"
                    value={form.endDate}
                  />
                </div>
                <label className="block">
                  <span className="text-sm font-semibold text-slate-700">备注</span>
                  <textarea
                    className="mt-2 min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                    onChange={(event) =>
                      setForm((current) => ({ ...current, notes: event.target.value }))
                    }
                    placeholder="可选：酒店、航班或旅行说明"
                    value={form.notes}
                  />
                </label>
                {formError ? (
                  <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
                    {formError}
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    onClick={() => {
                      setIsCreating(false)
                      setFormError(null)
                    }}
                    variant="secondary"
                  >
                    取消
                  </Button>
                  <Button loading={isSubmitting} type="submit">
                    保存旅行
                  </Button>
                </div>
              </form>
            </Card>
          </div>
        ) : (
          <>
            <SectionHeader title="我的旅行" action="刷新" onAction={() => void refreshTrips()} />
            <div className="min-h-0 flex-1 overflow-y-auto pr-1 app-scrollbar">
              {isLoading ? (
                <Card className="space-y-3">
                  <SkeletonLine className="w-2/3" />
                  <SkeletonLine className="w-full" />
                  <SkeletonLine className="w-1/2" />
                </Card>
              ) : null}

              {!isLoading && !hasTrips ? (
                <div className="space-y-3">
                  <EmptyState
                    body="新用户不会自动生成示例数据。你可以新建旅行，也可以手动创建一个东京示例用于体验地图和时间轴。"
                    icon={<CalendarDays className="size-6" />}
                    title="还没有旅行"
                  />
                  <Button
                    className="w-full"
                    loading={isCreatingDemo}
                    onClick={() => void handleCreateDemoTrip()}
                    variant="secondary"
                  >
                    创建示例旅行
                  </Button>
                </div>
              ) : null}

              {!isLoading && hasTrips ? (
                <div className="space-y-3">
                  {trips.map((trip, index) => (
                    <TripCard
                      key={trip.id}
                      onDelete={() => setPendingDeleteTrip(trip)}
                      onOpen={() => navigateTo('overview', { tripId: trip.id })}
                      trip={trip}
                      variantIndex={index}
                      isDeleting={deletingTripId === trip.id}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>

      {!isCreating ? (
        <div className="shrink-0">
          <div className="mb-3 flex items-center gap-3 rounded-2xl bg-emerald-50/70 px-3 py-2 text-xs text-emerald-700 ring-1 ring-emerald-100">
            <MapPinned className="size-4 shrink-0" />
            <span className="min-w-0 truncate">出发前请导出 zip 备份到安全位置。</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button
              icon={<Plus className="size-4" />}
              onClick={() => {
                setIsCreating(true)
                setFormError(null)
              }}
            >
              新建旅行
            </Button>
            <Button icon={<Upload className="size-4" />} onClick={() => navigateTo('settings')} variant="secondary">
              导入备份
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        body="删除后，本机保存的日程、行程点、票据元数据、票据文件和绑定关系都会被移除。"
        confirmLabel="删除旅行"
        loading={Boolean(deletingTripId)}
        onCancel={() => {
          if (!deletingTripId) {
            setPendingDeleteTrip(null)
          }
        }}
        onConfirm={() => void confirmDeleteTrip()}
        open={Boolean(pendingDeleteTrip)}
        title={pendingDeleteTrip ? `确认删除「${pendingDeleteTrip.title}」吗？` : '确认删除这个旅行吗？'}
      />
    </div>
  )
}

function TripCard({
  trip,
  onOpen,
  onDelete,
  variantIndex,
  isDeleting,
}: {
  trip: Trip
  onOpen: () => void
  onDelete: () => void
  variantIndex: number
  isDeleting: boolean
}) {
  const accent =
    variantIndex % 2 === 0
      ? 'bg-sky-500'
      : 'bg-emerald-500'

  return (
    <Card className="relative overflow-hidden p-0">
      <div className={`absolute inset-y-0 left-0 w-1 ${accent}`} />
      <button
        aria-label={`删除 ${trip.title}`}
        className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-xl bg-slate-50 text-slate-500 ring-1 ring-slate-100 active:scale-[0.98]"
        disabled={isDeleting}
        onClick={onDelete}
        type="button"
      >
        <Trash2 className="size-4" />
      </button>
      <button className="block w-full space-y-3 p-4 pl-5 pr-14 text-left" onClick={onOpen} type="button">
        <div>
          <p className="truncate text-xs font-semibold text-slate-400">{formatDateRange(trip.startDate, trip.endDate)}</p>
          <h3 className="mt-1 truncate text-lg font-semibold text-slate-950">{trip.title}</h3>
          <p className="mt-1 truncate text-sm text-slate-500">{trip.destination}</p>
        </div>
        <p className="line-clamp-2 text-sm leading-6 text-slate-500">
          {trip.notes || '暂无备注。'}
        </p>
        <div className="grid grid-cols-3 gap-3">
          <Stat label="开始" value={formatShortDate(trip.startDate)} />
          <Stat label="结束" value={formatShortDate(trip.endDate)} />
          <Stat label="更新" value={formatShortDateTime(trip.updatedAt)} />
        </div>
      </button>
    </Card>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'date'
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        className="mt-2 h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-50 px-2.5 py-2">
      <p className="truncate text-sm font-semibold text-slate-950">{value}</p>
      <p className="text-xs font-semibold text-slate-400">{label}</p>
    </div>
  )
}

function SkeletonLine({ className = '' }: { className?: string }) {
  return <div className={`h-4 animate-pulse rounded-full bg-slate-100 ${className}`} />
}

function formatDateRange(startDate: string, endDate: string) {
  if (!startDate || !endDate) {
    return '日期未定'
  }

  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`
}

function formatShortDate(date: string) {
  if (!date) {
    return '未定'
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(`${date}T00:00:00`))
}

function formatShortDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(new Date(timestamp))
}

function formatDateTime(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}
