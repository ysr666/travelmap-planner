import { useMemo, useState, type FormEvent } from 'react'
import { LocateFixed } from 'lucide-react'
import { parseCoordinatesFromMapLink } from '../lib/mapLinks'
import { transportModeOptions } from '../lib/itinerary'
import type { ItineraryItem, TransportMode } from '../types'
import { Button } from './ui/Button'
import { FormField } from './ui/FormField'

export type ItineraryItemFormValue = {
  title: string
  startTime?: string
  endTime?: string
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
  locationName: string
  address: string
  lat: string
  lng: string
  transportMode: TransportMode
  previousTransportMode: TransportMode | ''
  previousTransportDurationMinutes: string
  previousTransportNote: string
  notes: string
  mapLink: string
}

export function ItineraryItemForm({
  initialItem,
  submitLabel,
  loading = false,
  onCancel,
  onSubmit,
}: ItineraryItemFormProps) {
  const initialState = useMemo<FormState>(
    () => ({
      title: initialItem?.title ?? '',
      startTime: initialItem?.startTime ?? '',
      endTime: initialItem?.endTime ?? '',
      locationName: initialItem?.locationName ?? '',
      address: initialItem?.address ?? '',
      lat: initialItem?.lat?.toString() ?? '',
      lng: initialItem?.lng?.toString() ?? '',
      transportMode: initialItem?.transportMode ?? 'other',
      previousTransportMode: initialItem?.previousTransportMode ?? '',
      previousTransportDurationMinutes: initialItem?.previousTransportDurationMinutes?.toString() ?? '',
      previousTransportNote: initialItem?.previousTransportNote ?? '',
      notes: initialItem?.notes ?? '',
      mapLink: '',
    }),
    [initialItem],
  )
  const [form, setForm] = useState<FormState>(initialState)
  const [error, setError] = useState<string | null>(null)
  const [parseMessage, setParseMessage] = useState<string | null>(null)

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

    await onSubmit({
      title,
      startTime: normalizeOptional(form.startTime),
      endTime: normalizeOptional(form.endTime),
      locationName: normalizeOptional(form.locationName),
      address: normalizeOptional(form.address),
      lat,
      lng,
      transportMode: form.transportMode,
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
    <form className="space-y-3" onSubmit={handleSubmit}>
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
      <FormField
        label="地点名称"
        onChange={(value) => setForm((current) => ({ ...current, locationName: value }))}
        placeholder="例如：涩谷天空"
        value={form.locationName}
      />
      <FormField
        label="地址"
        onChange={(value) => setForm((current) => ({ ...current, address: value }))}
        placeholder="可选：街道地址或建筑名称"
        value={form.address}
      />
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">交通方式</span>
        <select
          className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              transportMode: event.target.value as TransportMode,
            }))
          }
          value={form.transportMode}
        >
          {transportModeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
        <h4 className="text-sm font-semibold text-slate-950">从上一站到此处</h4>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          可先用外部地图查看路线，再手动记录交通方式、预计耗时和备注。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-sm font-semibold text-slate-700">交通方式</span>
            <select
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
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
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-slate-700">交通备注</span>
          <textarea
            className="mt-2 min-h-20 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
            onChange={(event) =>
              setForm((current) => ({ ...current, previousTransportNote: event.target.value }))
            }
            placeholder="例如：JR 山手线到原宿站"
            value={form.previousTransportNote}
          />
        </label>
      </div>
      <div className="rounded-xl bg-slate-50 p-3">
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
        {parseMessage ? <p className="mt-2 text-xs text-slate-500">{parseMessage}</p> : null}
      </div>
      <div className="grid grid-cols-2 gap-3">
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
      <label className="block">
        <span className="text-sm font-semibold text-slate-700">备注</span>
        <textarea
          className="mt-2 min-h-24 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100"
          onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
          placeholder="可选：预约信息、注意事项或备用方案"
          value={form.notes}
        />
      </label>
      {error ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-600">
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
