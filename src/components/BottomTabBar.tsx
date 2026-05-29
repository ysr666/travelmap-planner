import { Home, Map, Settings } from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'

type BottomTabBarProps = {
  activeRoute: RouteId
}

const tabs = [
  { id: 'home' as RouteId, label: '首页', icon: Home },
  { id: 'trip' as RouteId, label: '行程', icon: Map },
  { id: 'settings' as RouteId, label: '设置', icon: Settings },
]

export function BottomTabBar({ activeRoute }: BottomTabBarProps) {
  return (
    <nav className="shrink-0 border-t border-outline-variant/30 bg-surface-dim/90 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[600px] items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeRoute === tab.id
          return (
            <button
              aria-label={tab.label}
              className={`flex min-h-[72px] min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-3 text-[13px] font-medium transition active:scale-95 tm-focus ${
                isActive
                  ? 'text-primary'
                  : 'text-on-surface-variant active:bg-surface-container/60'
              }`}
              onClick={() => navigateTo(tab.id)}
              type="button"
            >
              <Icon className="size-5" />
              <span>{tab.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
