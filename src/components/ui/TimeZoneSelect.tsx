import { useId } from 'react'
import {
  formatTimeZoneSource,
  getSupportedTimeZones,
  isValidTimeZone,
  type TimeZoneSource,
} from '../../lib/timeZone'
import { FIELD_INPUT_CLASS, FIELD_LABEL_CLASS } from './FormField'

type TimeZoneSelectProps = {
  description?: string
  disabled?: boolean
  label: string
  onChange: (value: string) => void
  source?: TimeZoneSource
  value: string
}

export function TimeZoneSelect({
  description,
  disabled = false,
  label,
  onChange,
  source,
  value,
}: TimeZoneSelectProps) {
  const id = useId()
  const timeZones = getSupportedTimeZones()
  const valid = isValidTimeZone(value)

  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <input
        className={FIELD_INPUT_CLASS}
        disabled={disabled}
        list={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder="例如 Europe/London"
        value={value}
      />
      <datalist id={id}>
        {timeZones.map((timeZone) => (
          <option key={timeZone} value={timeZone} />
        ))}
      </datalist>
      <span className={valid ? 'mt-1 block text-xs tm-muted' : 'mt-1 block text-xs font-medium text-red-600 dark:text-red-300'}>
        {valid
          ? `${description ?? '使用 IANA 时区标识'} · 来源：${formatTimeZoneSource(source)}`
          : '请输入有效 IANA 时区，例如 Europe/London'}
      </span>
    </label>
  )
}
