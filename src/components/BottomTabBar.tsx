import { Home, Map, Search, Settings } from 'lucide-react'
import type { RouteId } from '../types'
import { navigateTo } from '../lib/routes'

type BottomTabBarProps = {
  activeRoute: RouteId
}

const tabs = [
  { id: 'home' as RouteId, label: '首页', icon: Home },
  { id: 'trip' as RouteId, label: '行程', icon: Map },
  { id: 'search' as RouteId, label: '搜索', icon: Search, disabled: true },
  { id: 'settings' as RouteId, label: '设置', icon: Settings },
]

export function BottomTabBar({ activeRoute }: BottomTabBarProps) {
  return (
    <nav className="fixed bottom-0 z-50 flex h-16 w-full items-center justify-around border-t-[0.5px] border-outline-variant/30 bg-surface-dim/80 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur-xl">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = activeRoute === tab.id
        return (
          <button
            key={tab.id}
            aria-disabled={tab.disabled}
            aria-label={tab.label}
            className={`flex flex-col items-center justify-center rounded-xl px-3 py-1 transition active:scale-90 ${
              tab.disabled
                ? 'cursor-not-allowed text-outline-variant'
                : isActive
                  ? 'text-primary bg-primary-container/10'
                  : 'text-on-surface-variant hover:text-on-surface'
            }`}
            disabled={tab.disabled}
            onClick={() => {
              if (!tab.disabled) navigateTo(tab.id)
            }}
            type="button"
          >
            <Icon className="size-5 mb-1" />
            <span className="font-label-sm text-label-sm">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
