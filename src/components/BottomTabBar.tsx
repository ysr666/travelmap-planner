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
    <nav className="shrink-0 border-t tm-row bg-white/90 px-2 pb-[max(0.25rem,env(safe-area-inset-bottom))] pt-1 backdrop-blur-xl dark:bg-slate-950/90">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeRoute === tab.id
          return (
            <button
              aria-disabled={tab.disabled}
              aria-label={tab.label}
              className={`flex min-h-12 min-w-12 flex-col items-center justify-center gap-0.5 rounded-xl px-3 text-[10px] font-medium transition active:scale-95 tm-focus ${
                tab.disabled
                  ? 'cursor-not-allowed text-slate-300 dark:text-slate-600'
                  : isActive
                    ? 'text-primary'
                    : 'text-slate-500 active:bg-slate-100/60 dark:text-slate-400 dark:active:bg-slate-800/40'
              }`}
              disabled={tab.disabled}
              onClick={() => {
                if (!tab.disabled) navigateTo(tab.id)
              }}
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
