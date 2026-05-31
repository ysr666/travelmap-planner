import { useState } from 'react'
import { Car, Footprints, Train, AlertTriangle } from 'lucide-react'

export function SettingsRoutePage() {
  const [preference, setPreference] = useState<'fastest' | 'shortest' | 'scenic'>('fastest')
  const [avoidTolls, setAvoidTolls] = useState(false)
  const [avoidHighways, setAvoidHighways] = useState(false)

  return (
    <main className="pt-24 px-4 max-w-3xl mx-auto space-y-section-gap pb-32">
      <div className="mb-8">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">路线偏好</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">
          自定义路线计算偏好
        </p>
      </div>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">路线策略</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          <RouteOption icon={<Car className="size-4" />} title="最快路线" detail="优先选择速度最快的道路" selected={preference === 'fastest'} onClick={() => setPreference('fastest')} />
          <RouteOption icon={<Footprints className="size-4" />} title="最短路线" detail="优先选择距离最短的道路" selected={preference === 'shortest'} onClick={() => setPreference('shortest')} />
          <RouteOption icon={<Train className="size-4" />} title="风景路线" detail="优先选择沿途风景好的道路" selected={preference === 'scenic'} onClick={() => setPreference('scenic')} separator={false} />
        </div>
      </section>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">避让选项</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          <ToggleRow icon={<AlertTriangle className="size-4" />} title="避开收费站" checked={avoidTolls} onChange={setAvoidTolls} />
          <ToggleRow icon={<AlertTriangle className="size-4" />} title="避开高速公路" checked={avoidHighways} onChange={setAvoidHighways} separator={false} />
        </div>
      </section>
    </main>
  )
}

function RouteOption({ icon, title, detail, selected, onClick, separator = true }: {
  icon: React.ReactNode
  title: string
  detail: string
  selected: boolean
  onClick: () => void
  separator?: boolean
}) {
  return (
    <>
      <div
        className={`flex items-center justify-between p-4 bg-surface-container hover:bg-surface-container-high/50 transition-colors cursor-pointer active:scale-[0.98] ${selected ? 'ring-2 ring-primary/30' : ''}`}
        onClick={onClick}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-4">
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${selected ? 'bg-primary/20 text-primary' : 'bg-surface-container-highest text-on-surface-variant'}`}>
            {icon}
          </div>
          <div className="flex flex-col">
            <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
            <span className="font-label-sm text-label-sm text-on-surface-variant">{detail}</span>
          </div>
        </div>
        {selected ? (
          <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-white" />
          </div>
        ) : (
          <div className="w-5 h-5 rounded-full border-2 border-outline-variant" />
        )}
      </div>
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}

function ToggleRow({ icon, title, checked, onChange, separator = true }: {
  icon: React.ReactNode
  title: string
  checked: boolean
  onChange: (v: boolean) => void
  separator?: boolean
}) {
  return (
    <>
      <div className="flex items-center justify-between p-4 bg-surface-container">
        <div className="flex items-center gap-4">
          <div className="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center">{icon}</div>
          <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
        </div>
        <label className="relative inline-flex items-center cursor-pointer">
          <input checked={checked} className="sr-only peer" onChange={(e) => onChange(e.target.checked)} type="checkbox" />
          <div className="w-11 h-6 bg-surface-container-highest peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary" />
        </label>
      </div>
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}
