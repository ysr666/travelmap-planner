import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'

type SettingsSectionProps = {
  title: string
  children: ReactNode
  defaultOpen?: boolean
}

export function SettingsSection({ title, children, defaultOpen = false }: SettingsSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section>
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-container rounded-xl border-[0.5px] border-outline-variant/30 transition-colors hover:bg-surface-container-high/50 active:scale-[0.99]"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <h3 className="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider">{title}</h3>
        <ChevronRight className={`size-4 text-on-surface-variant transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen ? (
        <div className="mt-2 bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          {children}
        </div>
      ) : null}
    </section>
  )
}

type SettingsRowProps = {
  icon?: ReactNode
  iconBg?: string
  title: string
  detail?: string
  onClick?: () => void
  separator?: boolean
  children?: ReactNode
}

export function SettingsRow({ icon, iconBg = 'bg-primary/20 text-primary', title, detail, onClick, separator = true, children }: SettingsRowProps) {
  const content = (
    <>
      <div className="flex items-center gap-4">
        {icon ? (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconBg}`}>
            {icon}
          </div>
        ) : null}
        <div className="flex flex-col">
          <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
          {detail ? <span className="font-label-sm text-label-sm text-on-surface-variant">{detail}</span> : null}
        </div>
      </div>
      {children || (onClick ? <ChevronRight className="size-5 text-on-surface-variant" /> : null)}
    </>
  )

  const rowClasses = `flex items-center justify-between p-4 bg-surface-container hover:bg-surface-container-high/50 transition-colors ${onClick ? 'cursor-pointer active:scale-[0.98]' : ''}`

  return (
    <>
      {onClick ? (
        <button className={rowClasses} onClick={onClick} type="button">
          {content}
        </button>
      ) : (
        <div className={rowClasses}>
          {content}
        </div>
      )}
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}

type SettingsToggleRowProps = {
  icon?: ReactNode
  iconBg?: string
  title: string
  detail?: string
  checked: boolean
  onChange: (checked: boolean) => void
  separator?: boolean
}

export function SettingsToggleRow({ icon, iconBg = 'bg-tertiary/20 text-tertiary', title, detail, checked, onChange, separator = true }: SettingsToggleRowProps) {
  return (
    <>
      <div className="flex items-center justify-between p-4 bg-surface-container">
        <div className="flex items-center gap-4">
          {icon ? (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconBg}`}>
              {icon}
            </div>
          ) : null}
          <div className="flex flex-col">
            <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
            {detail ? <span className="font-label-sm text-label-sm text-on-surface-variant">{detail}</span> : null}
          </div>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            checked={checked}
            className="sr-only peer"
            onChange={(e) => onChange(e.target.checked)}
            type="checkbox"
          />
          <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
        </label>
      </div>
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}
