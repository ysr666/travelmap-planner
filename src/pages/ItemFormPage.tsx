import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { createItineraryItem, getDay, getItineraryItem, getTrip, listItemsByDay, updateItineraryItem } from '../db'
import { ItineraryItemForm, type ItineraryItemFormValue } from '../components/ItineraryItemForm'
import { getRouteParams, navigateTo, routeFromHash } from '../lib/routes'
import type { ItineraryItem } from '../types'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'

export function ItemFormPage() {
  const route = routeFromHash()
  const params = getRouteParams()
  const isEdit = route === 'item/edit'
  const tripId = params.get('tripId')
  const dayId = params.get('dayId')
  const itemId = params.get('itemId')
  const sourceView = params.get('view') === 'map' ? 'map' : 'schedule'

  const [existingItem, setExistingItem] = useState<ItineraryItem | null>(null)
  const [dayItems, setDayItems] = useState<ItineraryItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(() => {
    if (!tripId || !dayId) return '缺少旅行或日程 ID。'
    if (isEdit && !itemId) return '缺少行程点 ID。'
    return null
  })
  const hasInitialError = !tripId || !dayId || (isEdit && !itemId)

  const sortOrder = useMemo(() => {
    return dayItems.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1
  }, [dayItems])

  useEffect(() => {
    if (hasInitialError || !tripId || !dayId) return

    let cancelled = false

    void Promise.all([
      getTrip(tripId),
      getDay(dayId),
      listItemsByDay(dayId),
    ]).then(([foundTrip, foundDay, items]) => {
      if (cancelled) return

      if (!foundTrip) {
        setError('未找到该旅行')
        setIsLoading(false)
        return
      }

      if (!foundDay) {
        setError('未找到该日程')
        setIsLoading(false)
        return
      }

      setDayItems(items)

      if (isEdit) {
        if (!itemId) {
          setError('缺少行程点 ID。')
          setIsLoading(false)
          return
        }
        void getItineraryItem(itemId).then((foundItem) => {
          if (cancelled) return
          if (!foundItem) {
            setError('未找到该行程点')
            setIsLoading(false)
            return
          }
          setExistingItem(foundItem)
          setIsLoading(false)
        })
      } else {
        setIsLoading(false)
      }
    }).catch(() => {
      if (!cancelled) {
        setError('加载数据失败')
        setIsLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [tripId, dayId, isEdit, itemId, hasInitialError])

  function handleCancel() {
    if (tripId) {
      if (dayId) {
        navigateTo('day', { tripId, dayId, view: sourceView })
      } else {
        navigateTo('trip', { tripId })
      }
    } else {
      navigateTo('home')
    }
  }

  async function handleSubmit(value: ItineraryItemFormValue) {
    if (!tripId || !dayId) return

    setIsSubmitting(true)
    setError(null)
    try {
      if (isEdit && itemId && existingItem) {
        await updateItineraryItem(itemId, value)
        navigateTo('item', { tripId, dayId, itemId, view: sourceView })
      } else {
        await createItineraryItem({
          ...value,
          tripId,
          dayId,
          ticketIds: [],
          sortOrder,
        })
        navigateTo('day', { tripId, dayId, view: 'schedule' })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : isEdit ? '保存修改失败' : '新增行程点失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (error || hasInitialError) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card variant="grouped" className="space-y-3">
          <p className="text-sm text-red-600 dark:text-red-300">{error}</p>
          <Button onClick={handleCancel} variant="secondary">{tripId ? '返回旅行工作台' : '返回首页'}</Button>
        </Card>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4 px-4 pt-[max(0.9rem,env(safe-area-inset-top))]">
        <Card variant="grouped" className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-full bg-surface-container dark:bg-surface-container-highest" />
          <div className="h-5 w-2/3 animate-pulse rounded-full bg-surface-container dark:bg-surface-container-highest" />
          <div className="h-4 w-full animate-pulse rounded-full bg-surface-container dark:bg-surface-container-highest" />
        </Card>
      </div>
    )
  }

  return (
    <div
      className="flex h-full min-h-0 flex-col overflow-hidden"
      data-testid="item-form-page"
    >
      <header className="z-30 shrink-0 border-b tm-row bg-surface/88 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="返回"
            className="flex size-10 items-center justify-center rounded-xl text-on-surface ring-1 ring-outline-variant/30/80 transition active:scale-[0.98] tm-surface tm-focus dark:text-outline-variant dark:ring-outline-variant/30/80"
            onClick={handleCancel}
            type="button"
          >
            <ArrowLeft className="size-5" />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-xl font-semibold leading-tight text-on-surface dark:text-on-surface">
            {isEdit ? '编辑行程点' : '新增行程点'}
          </h1>
          <div className="size-10" />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4 app-scrollbar">
        <div className="page-transition">
          <Card variant="grouped">
            <ItineraryItemForm
              initialItem={isEdit ? existingItem ?? undefined : undefined}
              loading={isSubmitting}
              onCancel={handleCancel}
              onSubmit={handleSubmit}
              submitLabel={isEdit ? '保存修改' : '新增行程点'}
            />
          </Card>
        </div>
      </main>
    </div>
  )
}
