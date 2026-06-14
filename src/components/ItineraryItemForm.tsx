import { useCallback, useMemo, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, LocateFixed } from 'lucide-react'
import { parseCoordinatesFromMapLink } from '../lib/mapLinks'
import { isGoogleMapsConfigured } from '../lib/googleMaps'
import { transportModeOptions } from '../lib/itinerary'
import { isValidPlainDate } from '../lib/plainDate'
import { getDeviceTimeZone, normalizeTimeZone } from '../lib/timeZone'
import type { ItineraryItem, TransportMode } from '../types'
import { Button } from './ui/Button'
import { FIELD_LABEL_CLASS, FIELD_SELECT_CLASS, FIELD_TEXTAREA_CLASS, FormField } from './ui/FormField'
import { PlaceSearchInput, type PlaceResult } from './ui/PlaceSearchInput'
import { TimeZoneSelect } from './ui/TimeZoneSelect'

export type ItineraryItemFormValue = {
  title: string
  startTime?: string
  endTime?: string
  startTimeZone?: string
  endDate?: string
  endTimeZone?: string
  locationName?: string
  address?: string
  lat?: number
  lng?: number
  transportMode?: TransportMode
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  previousTransportNote?: string
  notes?: string
}

type ItineraryItemFormProps = {
  dayDate?: string
  defaultTimeZone?: string
  initialItem?: ItineraryItem
  submitLabel: string
  loading?: boolean
  onCancel: () => void
  onSubmit: (value: ItineraryItemFormValue) => Promise<void>
}

type FormState = {
  title: string
  startTime: string
  endTime: string
  startTimeZone: string
  endDate: string
  endTimeZone: string
  locationName: string
  address: string
  lat: string
  lng: string
  transportMode: TransportMode | ''
  previousTransportMode: TransportMode | ''
  previousTransportDurationMinutes: string
  previousTransportNote: string
  notes: string
  mapLink: string
}

export function ItineraryItemForm({
  dayDate,
  defaultTimeZone,
  initialItem,
  submitLabel,
  loading = false,
  onCancel,
  onSubmit,
}: ItineraryItemFormProps) {
  const inheritedTimeZone = normalizeTimeZone(defaultTimeZone) ?? getDeviceTimeZone()
  const initialState = useMemo<FormState>(
    () => ({
      title: initialItem?.title ?? '',
      startTime: initialItem?.startTime ?? '',
      endTime: initialItem?.endTime ?? '',
      startTimeZone: initialItem?.startTimeZone ?? inheritedTimeZone,
      endDate: initialItem?.endDate ?? dayDate ?? '',
      endTimeZone: initialItem?.endTimeZone ?? initialItem?.startTimeZone ?? inheritedTimeZone,
      locationName: initialItem?.locationName ?? '',
      address: initialItem?.address ?? '',
      lat: initialItem?.lat?.toString() ?? '',
      lng: initialItem?.lng?.toString() ?? '',
      transportMode: initialItem?.transportMode ?? '',
      previousTransportMode: initialItem?.previousTransportMode ?? '',
      previousTransportDurationMinutes: initialItem?.previousTransportDurationMinutes?.toString() ?? '',
      previousTransportNote: initialItem?.previousTransportNote ?? '',
      notes: initialItem?.notes ?? '',
      mapLink: '',
    }),
    [dayDate, inheritedTimeZone, initialItem],
  )
  const [form, setForm] = useState<FormState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [parseMessage, setParseMessage] = useState<string | null>(null)
  const googleMapsKeyConfigured = isGoogleMapsConfigured()
  const [showManualCoords, setShowManualCoords] = useState(!googleMapsKeyConfigured)
  const showTravelTimeZoneFields = isLongDistanceTransportMode(form.transportMode) ||
    Boolean(initialItem?.startTimeZone || initialItem?.endDate || initialItem?.endTimeZone)

  const handlePlaceSelect = useCallback((place: PlaceResult) => {
    setForm((current) => ({
      ...current,
      locationName: place.name || current.locationName,
      address: place.address || current.address,
      lat: place.lat.toString(),
      lng: place.lng.toString(),
    }))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    const title = form.title.trim()
    if (!title) {
      setError('请填写行程标题')
      return
    }

    const lat = form.lat.trim() ? Number(form.lat) : undefined
    const lng = form.lng.trim() ? Number(form.lng) : undefined
    if (!validateCoordinates(lat, lng)) {
      setError('坐标范围无效：纬度需在 -90 到 90，经度需在 -180 到 180')
      return
    }

    const previousTransportDurationMinutes = form.previousTransportDurationMinutes.trim()
      ? Number(form.previousTransportDurationMinutes)
      : undefined
    if (!validateDuration(previousTransportDurationMinutes)) {
      setError('预计耗时需为大于或等于 0 的分钟数')
      return
    }

    const startTimeZone = normalizeOptional(form.startTimeZone)
    const endDate = normalizeOptional(form.endDate)
    const endTimeZone = normalizeOptional(form.endTimeZone)
    if (showTravelTimeZoneFields) {
      if (startTimeZone && !normalizeTimeZone(startTimeZone)) {
        setError('出发时区无效，请使用 IANA 时区，例如 Europe/London')
        return
      }
      if (endTimeZone && !normalizeTimeZone(endTimeZone)) {
        setError('到达时区无效，请使用 IANA 时区，例如 Asia/Shanghai')
        return
      }
      if (endDate && !isValidPlainDate(endDate)) {
        setError('到达日期格式无效，请使用 YYYY-MM-DD')
        return
      }
      if (endDate && dayDate && isValidPlainDate(dayDate) && endDate < dayDate) {
        setError('到达日期不能早于当前日程日期')
        return
      }
    }

    await onSubmit({
      title,
      startTime: normalizeOptional(form.startTime),
      endTime: normalizeOptional(form.endTime),
      startTimeZone: showTravelTimeZoneFields ? normalizeTimeZone(startTimeZone) : undefined,
      endDate: showTravelTimeZoneFields ? endDate : undefined,
      endTimeZone: showTravelTimeZoneFields ? normalizeTimeZone(endTimeZone) : undefined,
      locationName: normalizeOptional(form.locationName),
      address: normalizeOptional(form.address),
      lat,
      lng,
      transportMode: form.transportMode || undefined,
      previousTransportMode: form.previousTransportMode || undefined,
      previousTransportDurationMinutes,
      previousTransportNote: normalizeOptional(form.previousTransportNote),
      notes: normalizeOptional(form.notes),
    })
  }

  function handleParseCoordinates() {
    setParseMessage(null)
    setError(null)
    const coordinates = parseCoordinatesFromMapLink(form.mapLink)
    if (!coordinates) {
      setParseMessage('未识别到明确坐标，请手动输入纬度和经度。')
      return
    }

    setForm((current) => ({
      ...current,
      lat: coordinates.lat.toString(),
      lng: coordinates.lng.toString(),
    }))
    setParseMessage('已解析坐标并填入表单。')
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <FormField
        label="行程标题"
        onChange={(value) => setForm((current) => ({ ...current, title: value }))}
        placeholder="例如：Shibuya Sky 夜景"
        required
        value={form.title}
      />
      <div className="grid grid-cols-2 gap-3">
        <FormField
          label="开始时间"
          onChange={(value) => setForm((current) => ({ ...current, startTime: value }))}
          type="time"
          value={form.startTime}
        />
        <FormField
          label="结束时间"
          onChange={(value) => setForm((current) => ({ ...current, endTime: value }))}
          type="time"
          value={form.endTime}
        />
      </div>
      {googleMapsKeyConfigured ? (
        <PlaceSearchInput
          label="搜索地点"
          onChange={(value) => setForm((current) => ({ ...current, locationName: value }))}
          onPlaceSelect={handlePlaceSelect}
          placeholder="输入地点名称搜索..."
          value={form.locationName}
        />
      ) : (
        <FormField
          label="地点名称"
          onChange={(value) => setForm((current) => ({ ...current, locationName: value }))}
          placeholder="例如：涩谷天空"
          value={form.locationName}
        />
      )}
      <FormField
        label="地址"
        onChange={(value) => setForm((current) => ({ ...current, address: value }))}
        placeholder="可选：街道地址或建筑名称"
        value={form.address}
      />
      <label className="block">
        <span className={FIELD_LABEL_CLASS}>交通方式</span>
        <select
          className={FIELD_SELECT_CLASS}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              endDate: current.endDate || dayDate || '',
              endTimeZone: current.endTimeZone || inheritedTimeZone,
              startTimeZone: current.startTimeZone || inheritedTimeZone,
              transportMode: event.target.value as TransportMode | '',
            }))
          }
          value={form.transportMode}
        >
          <option value="">未填写</option>
          {transportModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      {showTravelTimeZoneFields ? (
        <section className="space-y-3 border-t tm-row pt-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">跨时区时间</h4>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TimeZoneSelect
              description="出发或开始时间所在时区"
              label="出发时区"
              onChange={(value) => setForm((current) => ({ ...current, startTimeZone: value }))}
              source="manual"
              value={form.startTimeZone}
            />
            <FormField
              label="到达日期"
              onChange={(value) => setForm((current) => ({ ...current, endDate: value }))}
              type="date"
              value={form.endDate}
            />
            <TimeZoneSelect
              description="到达或结束时间所在时区"
              label="到达时区"
              onChange={(value) => setForm((current) => ({ ...current, endTimeZone: value }))}
              source="manual"
              value={form.endTimeZone}
            />
          </div>
        </section>
      ) : null}
      <section className="space-y-3 border-t tm-row pt-4">
        <div>
          <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">从上一站到此处</h4>
          <p className="mt-1 text-xs leading-5 tm-muted">
            可先用外部地图查看路线，再记录交通方式、预计耗时和备注。
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className={FIELD_LABEL_CLASS}>交通方式</span>
            <select
              className={FIELD_SELECT_CLASS}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  previousTransportMode: event.target.value as TransportMode | '',
                }))
              }
              value={form.previousTransportMode}
            >
              <option value="">未填写</option>
              {transportModeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <FormField
            label="预计耗时（分钟）"
            onChange={(value) =>
              setForm((current) => ({ ...current, previousTransportDurationMinutes: value }))
            }
            placeholder="25"
            type="number"
            value={form.previousTransportDurationMinutes}
          />
        </div>
        <label className="block">
          <span className={FIELD_LABEL_CLASS}>交通备注</span>
          <textarea
            className={`${FIELD_TEXTAREA_CLASS} min-h-28 resize-y leading-6`}
            onChange={(event) =>
              setForm((current) => ({ ...current, previousTransportNote: event.target.value }))
            }
            placeholder="例如：JR 山手线到原宿站"
            value={form.previousTransportNote}
          />
        </label>
      </section>
      {googleMapsKeyConfigured ? (
        <section className="space-y-3 border-t tm-row pt-4">
          <button
            className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 transition active:scale-[0.99] tm-focus dark:text-slate-200"
            onClick={() => setShowManualCoords((current) => !current)}
            type="button"
          >
            <span>手动输入坐标</span>
            {showManualCoords ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </button>
          {showManualCoords ? (
            <div className="space-y-3">
              <FormField
                label="粘贴地图链接解析坐标"
                onChange={(value) => setForm((current) => ({ ...current, mapLink: value }))}
                placeholder="支持 ll=、query=、q=、@lat,lng 等显式坐标"
                value={form.mapLink}
              />
              <Button
                className="w-full"
                icon={<LocateFixed className="size-4" />}
                onClick={handleParseCoordinates}
                variant="secondary"
              >
                解析坐标
              </Button>
              {parseMessage ? <p className="text-xs tm-muted">{parseMessage}</p> : null}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label="纬度 lat"
                  onChange={(value) => setForm((current) => ({ ...current, lat: value }))}
                  placeholder="35.6585"
                  type="number"
                  value={form.lat}
                />
                <FormField
                  label="经度 lng"
                  onChange={(value) => setForm((current) => ({ ...current, lng: value }))}
                  placeholder="139.7020"
                  type="number"
                  value={form.lng}
                />
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <section className="space-y-3 border-t tm-row pt-4">
          <div>
            <h4 className="text-sm font-semibold text-slate-950 dark:text-slate-100">坐标</h4>
            <p className="mt-1 text-xs leading-5 tm-muted">
              可粘贴地图链接解析，也可以手动填写纬度和经度。
            </p>
          </div>
          <div className="space-y-3">
            <FormField
              label="粘贴地图链接解析坐标"
              onChange={(value) => setForm((current) => ({ ...current, mapLink: value }))}
              placeholder="支持 ll=、query=、q=、@lat,lng 等显式坐标"
              value={form.mapLink}
            />
            <Button
              className="mt-3 w-full"
              icon={<LocateFixed className="size-4" />}
              onClick={handleParseCoordinates}
              variant="secondary"
            >
              解析坐标
            </Button>
            {parseMessage ? <p className="mt-2 text-xs tm-muted">{parseMessage}</p> : null}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="纬度 lat"
              onChange={(value) => setForm((current) => ({ ...current, lat: value }))}
              placeholder="35.6585"
              type="number"
              value={form.lat}
            />
            <FormField
              label="经度 lng"
              onChange={(value) => setForm((current) => ({ ...current, lng: value }))}
              placeholder="139.7020"
              type="number"
              value={form.lng}
            />
          </div>
        </section>
      )}
      <label className="block">
        <span className={FIELD_LABEL_CLASS}>备注</span>
        <textarea
          className={`${FIELD_TEXTAREA_CLASS} min-h-32 resize-y leading-6`}
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          placeholder="可选：预约信息、注意事项或备用方案"
          value={form.notes}
        />
      </label>
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600 ring-1 ring-red-100/80 dark:bg-red-950/35 dark:text-red-300 dark:ring-red-900/50">
          {error}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <Button onClick={onCancel} variant="secondary">
          取消
        </Button>
        <Button loading={loading} type="submit">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

function normalizeOptional(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function validateCoordinates(lat?: number, lng?: number) {
  if (lat === undefined && lng === undefined) {
    return true
  }

  if (lat === undefined || lng === undefined) {
    return false
  }

  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

function validateDuration(duration?: number) {
  return duration === undefined || (Number.isFinite(duration) && duration >= 0)
}

function isLongDistanceTransportMode(mode: TransportMode | '') {
  return mode === 'flight' || mode === 'train' || mode === 'other'
}
