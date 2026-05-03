import type { ReactNode } from 'react'
import {
  CalendarDays,
  Cog,
  Home,
  Map,
  Plus,
  Route,
  Ticket,
} from 'lucide-react'
import type { NavItem, RouteId } from '../types'
import { getRouteParams, navigateTo } from '../lib/routes'

type AppShellProps = {
  activeRoute: RouteId
  children: ReactNode
}

const navItems: NavItem[] = [
  { id: 'home', label: '首页', icon: Home },
  { id: 'overview', label: '旅行', icon: CalendarDays },
  { id: 'timeline', label: '日程', icon: Route },
  { id: 'map', label: '地图', icon: Map },
  { id: 'tickets', label: '票据', icon: Ticket },
  { id: 'settings', label: '设置', icon: Cog },
]

const routeTitles: Record<RouteId, { title: string; subtitle: string }> = {
  home: { title: '旅行列表', subtitle: '本地旅行总控台' },
  overview: { title: '旅行总览', subtitle: '每日行程与备注' },
  timeline: { title: '时间轴', subtitle: '当天行程点' },
  map: { title: '路线地图', subtitle: '每日行程路线' },
  item: { title: '行程点详情', subtitle: '地点、备注与外部地图' },
  tickets: { title: '票据库', subtitle: '文件保存在本机' },
  settings: { title: '设置', subtitle: '本机存储与备份' },
}

export function AppShell({ activeRoute, children }: AppShellProps) {
  const isMap = activeRoute === 'map'
  const title = routeTitles[activeRoute]
  const tripId = getRouteParams().get('tripId')

  function handleNavClick(route: RouteId) {
    if ((route === 'tickets' || route === 'settings') && tripId) {
      navigateTo(route, { tripId })
      return
    }

    navigateTo(route)
  }

  return (
    <div className="mx-auto flex min-h-svh w-full max-w-[430px] flex-col overflow-hidden bg-[#eef3f8] shadow-2xl shadow-slate-300/40">
      <header
        className={`z-30 border-b border-white/70 px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] backdrop-blur-xl ${
          isMap ? 'absolute inset-x-0 top-0 bg-white/78' : 'sticky top-0 bg-[#f8fbff]/88'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <button
            aria-label="返回首页"
            className="flex size-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 active:scale-[0.98]"
            onClick={() => navigateTo('home')}
            type="button"
          >
            <Home className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-slate-400">{title.subtitle}</p>
            <h1 className="truncate text-[22px] font-bold leading-tight text-slate-950">
              {title.title}
            </h1>
          </div>
          <button
            aria-label="新建"
            className="flex size-11 items-center justify-center rounded-2xl bg-[#1677ff] text-white shadow-[0_10px_24px_rgba(22,119,255,0.25)] active:scale-[0.98]"
            type="button"
          >
            <Plus className="size-5" />
          </button>
        </div>
      </header>

      <main className={isMap ? 'relative min-h-svh flex-1' : 'flex-1 px-4 pb-28 pt-4'}>
        {children}
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] px-3">
        <div className="grid grid-cols-6 rounded-[26px] border border-white/80 bg-white/94 p-2 shadow-[0_18px_44px_rgba(38,53,76,0.18)] backdrop-blur-xl">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive = activeRoute === item.id
            return (
              <button
                className={`flex min-w-0 flex-col items-center gap-1 rounded-[18px] px-1.5 py-2 text-[10px] font-semibold transition ${
                  isActive ? 'bg-sky-50 text-[#1677ff]' : 'text-slate-400 active:bg-slate-50'
                }`}
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                type="button"
              >
                <Icon className="size-5" />
                <span className="max-w-full truncate">{item.label}</span>
              </button>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
