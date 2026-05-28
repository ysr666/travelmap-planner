import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft } from 'lucide-react'
import { createTrip, getTrip, updateTrip } from '../db'
import { ensureDaysForTrip } from '../lib/dates'
import { getRouteParams, navigateTo, routeFromHash } from '../lib/routes'
import type { Trip } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FIELD_LABEL_CLASS, FIELD_TEXTAREA_CLASS, FormField } from '../components/ui/FormField'

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

export function TripFormPage() {
  const route = routeFromHash()
  const params = getRouteParams()
  const isEdit = route === 'trip/edit'
  const tripId = params.get('tripId')

  const [form, setForm] = useState<TripFormState>(initialFormState)
  const [isLoading, setIsLoading] = useState(isEdit)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [trip, setTrip] = useState<Trip | null>(null)

  useEffect(() => {
    if (!isEdit || !tripId) return

    let cancelled = false
    void getTrip(tripId).then((found) => {
      if (cancelled) return
      if (!found) {
        setError('未找到该旅行')
        setIsLoading(false)
        return
      }
      setTrip(found)
      setForm({
        title: found.title,
        destination: found.destination,
        startDate: found.startDate,
        endDate: found.endDate,
        notes: found.notes ?? '',
      })
      setIsLoading(false)
    })

    return () => { cancelled = true }
  }, [isEdit, tripId])

  if (isEdit && !tripId) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card variant="grouped" className="space-y-3">
          <p className="text-sm text-red-600 dark:text-red-300">缺少旅行 ID。</p>
          <Button onClick={() => navigateTo('home')} variant="secondary">返回首页</Button>
        </Card>
      </div>
    )
  }

  if (isEdit && error) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card variant="grouped" className="space-y-3">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          <Button onClick={() => navigateTo('home')} variant="secondary">返回首页</Button>
        </Card>
      </div>
    )
  }

  if (isEdit && isLoading) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card variant="grouped" className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-5 w-2/3 animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
          <div className="h-4 w-full animate-pulse rounded-full bg-slate-100 dark:bg-slate-800" />
        </Card>
      </div>
    )
  }

  function handleCancel() {
    if (isEdit && tripId) {
      navigateTo('trip', { tripId })
    } else {
      navigateTo('home')
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
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
      if (isEdit && tripId && trip) {
        await updateTrip(tripId, {
          title,
          destination: destination || '未填写目的地',
          startDate: form.startDate,
          endDate: form.endDate,
          notes: notes || undefined,
        })
        navigateTo('trip', { tripId })
      } else {
        const created = await createTrip({
          title,
          destination: destination || '未填写目的地',
          startDate: form.startDate,
          endDate: form.endDate,
          notes: notes || undefined,
        })
        await ensureDaysForTrip(created)
        navigateTo('trip', { tripId: created.id })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : isEdit ? '保存修改失败' : '新建旅行失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="trip-form-page"
    >
      <header className="z-30 shrink-0 border-b tm-row bg-surface/88 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label={isEdit ? '返回旅行工作台' : '返回首页'}
            className="flex size-10 items-center justify-center rounded-xl text-slate-700 ring-1 ring-slate-200/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-slate-200 dark:ring-slate-700/80"
            onClick={handleCancel}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight text-slate-950 dark:text-slate-100">
            {isEdit ? '编辑旅行' : '新建旅行'}
          </h1>
          <div className="size-10" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 app-scrollbar">
        <div className="page-transition">
          <Card variant="grouped">
            <form className="space-y-3" onSubmit={(e) => void handleSubmit(e)}>
              {error ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300 ring-1 ring-red-100/80 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50">{error}</p>
              ) : null}
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
                <span className={FIELD_LABEL_CLASS}>备注</span>
                <textarea
                  className={`${FIELD_TEXTAREA_CLASS} min-h-24 resize-none`}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, notes: event.target.value }))
                  }
                  placeholder="可选：酒店、航班或旅行说明"
                  value={form.notes}
                />
              </label>
              {formError ? (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-300 ring-1 ring-red-100/80 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50">{formError}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Button
                  data-testid="trip-form-cancel"
                  onClick={handleCancel}
                  type="button"
                  variant="secondary"
                >
                  取消
                </Button>
                <Button
                  data-testid="trip-form-submit"
                  loading={isSubmitting}
                  type="submit"
                >
                  {isEdit ? '保存修改' : '保存旅行'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </main>
    </div>
  )
}
