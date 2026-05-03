import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, MapPinned, Plus, Trash2, Upload } from 'lucide-react'
import { createTrip, deleteTripCascade, ensureSeedData, listTrips } from '../db'
import { navigateTo } from '../lib/routes'
import type { Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
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
  const [deletingTripId, setDeletingTripId] = useState<string | null>(null)
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
        await ensureSeedData()
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

  async function handleDeleteTrip(trip: Trip) {
    const confirmed = window.confirm(`确定删除「${trip.title}」吗？相关日程、行程点和票据记录会一并删除。`)
    if (!confirmed) {
      return
    }

    setDeletingTripId(trip.id)
    setError(null)
    try {
      await deleteTripCascade(trip.id)
      await refreshTrips()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '删除旅行失败')
    } finally {
      setDeletingTripId(null)
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-sky-600">本机 IndexedDB</p>
            <h2 className="mt-1 text-[28px] font-bold leading-tight text-slate-950">
              我的旅行
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              数据只保存在当前浏览器。本阶段已接入真实旅行列表。
            </p>
          </div>
          <div className="rounded-2xl bg-sky-50 px-3 py-2 text-center">
            <p className="text-xl font-bold text-sky-600">{tripStats.count}</p>
            <p className="text-xs font-semibold text-sky-500">旅行</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Button
            icon={<Plus className="size-4" />}
            onClick={() => {
              setIsCreating((current) => !current)
              setFormError(null)
            }}
          >
            新建旅行
          </Button>
          <Button icon={<Upload className="size-4" />} onClick={() => navigateTo('settings')} variant="secondary">
            导入备份
          </Button>
        </div>
        {tripStats.latest ? (
          <p className="text-xs text-slate-400">最近更新：{formatDateTime(tripStats.latest)}</p>
        ) : null}
      </Card>

      {isCreating ? (
        <Card>
          <form className="space-y-4" onSubmit={handleCreateTrip}>
            <div>
              <h3 className="text-lg font-bold text-slate-950">新建旅行</h3>
              <p className="mt-1 text-sm text-slate-500">每日行程生成会在后续阶段接入。</p>
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
                className="mt-2 min-h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
                onChange={(event) =>
                  setForm((current) => ({ ...current, notes: event.target.value }))
                }
                placeholder="可选：酒店、航班或旅行说明"
                value={form.notes}
              />
            </label>
            {formError ? (
              <p className="rounded-2xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
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
      ) : null}

      {error ? (
        <div className="rounded-[24px] border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
          {error}
        </div>
      ) : null}

      <section className="space-y-3">
        <SectionHeader title="旅行列表" action="刷新" onAction={() => void refreshTrips()} />
        {isLoading ? (
          <Card className="space-y-3">
            <SkeletonLine className="w-2/3" />
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-1/2" />
          </Card>
        ) : null}

        {!isLoading && !hasTrips ? (
          <EmptyState
            body="点击新建旅行，创建后会写入本机 IndexedDB。"
            icon={<CalendarDays className="size-6" />}
            title="还没有旅行"
          />
        ) : null}

        {!isLoading && hasTrips ? (
          <div className="space-y-3">
            {trips.map((trip, index) => (
              <TripCard
                key={trip.id}
                onDelete={() => void handleDeleteTrip(trip)}
                onOpen={() => navigateTo('overview', { tripId: trip.id })}
                trip={trip}
                variantIndex={index}
                isDeleting={deletingTripId === trip.id}
              />
            ))}
          </div>
        ) : null}
      </section>

      <Card className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
          <MapPinned className="size-6" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-950">离线优先工作区</h3>
          <p className="mt-1 text-sm leading-6 text-slate-500">
            当前阶段只接入旅行列表。地图、票据和备份会在后续阶段实现。
          </p>
        </div>
      </Card>
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
  const gradient =
    variantIndex % 2 === 0
      ? 'bg-[linear-gradient(135deg,#cae4ff_0%,#f9fbff_48%,#d7f2e6_100%)]'
      : 'bg-[linear-gradient(135deg,#dbeafe_0%,#f8fafc_52%,#fde68a_100%)]'

  return (
    <Card className="overflow-hidden p-0">
      <div className={`relative h-36 ${gradient}`}>
        <div className="absolute left-5 top-5 rounded-2xl bg-white/85 px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm">
          {formatDateRange(trip.startDate, trip.endDate)}
        </div>
        <button
          aria-label={`删除 ${trip.title}`}
          className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-2xl bg-white/88 text-slate-500 shadow-sm active:scale-[0.98]"
          disabled={isDeleting}
          onClick={onDelete}
          type="button"
        >
          <Trash2 className="size-4" />
        </button>
        <button className="absolute inset-x-0 bottom-0 top-14 text-left" onClick={onOpen} type="button">
          <div className="absolute bottom-5 left-5 right-5">
            <p className="truncate text-sm font-semibold text-slate-500">{trip.destination}</p>
            <h3 className="mt-1 truncate text-2xl font-bold text-slate-950">{trip.title}</h3>
          </div>
        </button>
      </div>
      <button className="block w-full space-y-3 p-4 text-left" onClick={onOpen} type="button">
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
        className="mt-2 h-12 w-full min-w-0 rounded-2xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
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
    <div className="min-w-0 rounded-2xl bg-slate-50 px-3 py-3">
      <p className="truncate text-sm font-bold text-slate-950">{value}</p>
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
