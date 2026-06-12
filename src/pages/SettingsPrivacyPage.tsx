import { useState } from 'react'
import { Shield, Eye, FileText, Database } from 'lucide-react'

export function SettingsPrivacyPage() {
  const [allowBasics, setAllowBasics] = useState(true)
  const [allowLocation, setAllowLocation] = useState(true)
  const [allowCoords, setAllowCoords] = useState(true)
  const [allowTransport, setAllowTransport] = useState(true)
  const [allowTickets, setAllowTickets] = useState(true)
  const [allowNotes, setAllowNotes] = useState(false)

  return (
    <main className="pt-24 px-4 max-w-3xl mx-auto space-y-section-gap pb-32">
      <div className="mb-8">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">隐私设置</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">
          控制 AI 功能可以访问的行程数据范围
        </p>
      </div>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">行程数据</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          <PrivacyToggle icon={<FileText className="size-4" />} title="行程基础信息" detail="标题、日期、时间和行程点标题" checked={allowBasics} onChange={setAllowBasics} />
          <PrivacyToggle icon={<Eye className="size-4" />} title="地点名称和地址" detail="不包含精确经纬度" checked={allowLocation} onChange={setAllowLocation} />
          <PrivacyToggle icon={<Database className="size-4" />} title="坐标状态" detail="仅表示是否有坐标" checked={allowCoords} onChange={setAllowCoords} />
          <PrivacyToggle icon={<Shield className="size-4" />} title="交通信息" detail="交通方式和耗时" checked={allowTransport} onChange={setAllowTransport} separator={false} />
        </div>
      </section>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">票据和备注</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          <PrivacyToggle icon={<FileText className="size-4" />} title="票据元数据" detail="数量、绑定状态和类型" checked={allowTickets} onChange={setAllowTickets} />
          <PrivacyToggle icon={<FileText className="size-4" />} title="完整备注内容" detail="默认关闭" checked={allowNotes} onChange={setAllowNotes} separator={false} />
        </div>
      </section>

      <p className="text-xs text-on-surface-variant px-4">
        这些设置只保存在当前浏览器 localStorage，不会进入 IndexedDB、zip 归档或云端同步。
      </p>
    </main>
  )
}

function PrivacyToggle({ icon, title, detail, checked, onChange, separator = true }: {
  icon: React.ReactNode
  title: string
  detail: string
  checked: boolean
  onChange: (v: boolean) => void
  separator?: boolean
}) {
  return (
    <>
      <button
        aria-checked={checked}
        aria-label={`${title}：${detail}`}
        className="flex w-full items-center justify-between gap-3 bg-surface-container p-4 text-left transition active:scale-[0.99] tm-focus"
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <div className="flex items-center gap-4">
          <div aria-hidden="true" className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center">{icon}</div>
          <div className="flex min-w-0 flex-col">
            <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">{detail}</span>
          </div>
        </div>
        <span
          aria-hidden="true"
          className={`relative flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
            checked ? 'justify-end bg-primary' : 'justify-start bg-surface-container-highest'
          }`}
        >
          <span className="size-5 rounded-full border border-gray-300 bg-white transition-all" />
        </span>
      </button>
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}
