import { Home, Route, Settings, Ticket } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { updateDay } from '../../db'
import { navigateTo } from '../../lib/routes'
import { normalizeTimeZone, resolveDayTimeZone } from '../../lib/timeZone'
import type { Day, Trip } from '../../types'
import { BottomSheet } from '../ui/BottomSheet'
import { Button } from '../ui/Button'
import { TimeZoneSelect } from '../ui/TimeZoneSelect'

export function DayMoreMenu({
  day,
  onClose,
  onDayUpdated,
  open,
  trip,
  tripId,
}: {
  day: Day
  onClose: () => void
  onDayUpdated: () => void
  open: boolean
  trip: Trip
  tripId: string
}) {
  const [timeZone, setTimeZone] = useState(() => resolveDayTimeZone(trip, day))
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleClose() {
    setTimeZone(resolveDayTimeZone(trip, day))
    setSaveError(null)
    onClose()
  }

  async function handleSaveTimeZone() {
    const normalized = normalizeTimeZone(timeZone)
    if (!normalized) {
      setSaveError('请输入有效 IANA 时区，例如 Europe/Paris')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await updateDay(day.id, {
        timeZone: normalized,
        timeZoneSource: 'manual',
      })
      onDayUpdated()
      handleClose()
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : '保存当天时区失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <BottomSheet maxHeight="min(25rem, calc(100dvh - 2rem))" onClose={handleClose} open={open} title="更多操作">
      <div className="space-y-1 pb-2" data-testid="day-more-menu">
        <div className="space-y-3 rounded-xl bg-surface-container-low p-3">
          <TimeZoneSelect
            description="默认继承旅行时区，可单独覆盖"
            label="当天时区"
            onChange={setTimeZone}
            source={day.timeZoneSource ?? trip.timeZoneSource}
            value={timeZone}
          />
          {saveError ? <p className="text-xs font-medium text-red-600 dark:text-red-300">{saveError}</p> : null}
          <Button className="w-full" loading={saving} onClick={() => void handleSaveTimeZone()} variant="secondary">
            保存当天时区
          </Button>
        </div>
        <DayMoreMenuItem icon={<Route className="size-4" />} label="旅行总览" onClick={() => navigateTo('trip', { tripId })} />
        <DayMoreMenuItem icon={<Ticket className="size-4" />} label="票据库" onClick={() => navigateTo('tickets', { tripId })} />
        <DayMoreMenuItem icon={<Settings className="size-4" />} label="设置" onClick={() => navigateTo('settings')} />
        <DayMoreMenuItem icon={<Home className="size-4" />} label="返回首页" onClick={() => navigateTo('home')} />
      </div>
    </BottomSheet>
  )
}

function DayMoreMenuItem({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-on-surface transition active:bg-surface-container-low"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      type="button"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-container-low text-on-surface-variant">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
