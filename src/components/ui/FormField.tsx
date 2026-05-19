export const FIELD_LABEL_CLASS = 'text-sm font-semibold text-slate-700 dark:text-slate-300'

export const FIELD_INPUT_CLASS =
  'mt-2 h-11 w-full min-w-0 tm-field px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-500/15'

export const FIELD_SELECT_CLASS = FIELD_INPUT_CLASS

export const FIELD_TEXTAREA_CLASS =
  'mt-2 w-full min-w-0 tm-field px-3 py-2.5 text-sm text-slate-950 outline-none transition placeholder:text-slate-300 focus:border-sky-400 focus:ring-4 focus:ring-sky-100 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-sky-500 dark:focus:ring-sky-500/15'

type FormFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'date' | 'time' | 'number'
  required?: boolean
}

export function FormField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: FormFieldProps) {
  return (
    <label className="block">
      <span className={FIELD_LABEL_CLASS}>
        {label}
        {required ? <span className="text-red-500"> *</span> : null}
      </span>
      <input
        className={FIELD_INPUT_CLASS}
        inputMode={type === 'number' ? 'decimal' : undefined}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        step={type === 'number' ? 'any' : undefined}
        type={type}
        value={value}
      />
    </label>
  )
}
