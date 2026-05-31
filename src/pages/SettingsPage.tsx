import { useEffect, useState, type ReactNode } from 'react'
import {
  ChevronRight,
  Cloud,
  User,
  Cpu,
  Shield,
  Map,
  Car,
  Moon,
  LogOut,
} from 'lucide-react'
import { useAppearance } from '../lib/appearanceContext'
import type { AppearanceMode } from '../lib/appearance'
import { getCurrentSession, signOut } from '../lib/cloudBackup'

// ── 主设置页面：完全对齐 design-reference/_2/code.html ──

export function SettingsPage() {
  const { mode: appearanceMode, setMode: setAppearanceMode } = useAppearance()
  const [isLoggedIntoCloud, setIsLoggedIntoCloud] = useState(false)
  const [aiRecommendations, setAiRecommendations] = useState(false)

  useEffect(() => {
    void getCurrentSession().then((session) => setIsLoggedIntoCloud(!!session))
  }, [])

  async function handleLogout() {
    await signOut()
    setIsLoggedIntoCloud(false)
  }

  function handleToggleAppearance() {
    const next: AppearanceMode = appearanceMode === 'dark' ? 'light' : appearanceMode === 'light' ? 'system' : 'dark'
    setAppearanceMode(next)
  }

  return (
    <main className="pt-24 px-4 max-w-3xl mx-auto space-y-section-gap pb-32">
      {/* 页面标题 */}
      <div className="mb-8">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">设置</h2>
      </div>

      {/* Section: 账户与云端 */}
      <SettingsSection title="账户与云端">
        <SettingsRow
          icon={<Cloud className="size-4" />}
          iconBg="bg-primary/20 text-primary"
          title="同步行程数据"
          detail={isLoggedIntoCloud ? '已连接' : '未连接'}
          onClick={() => {}}
        />
        <SettingsRow
          icon={<User className="size-4" />}
          iconBg="bg-secondary/20 text-secondary"
          title="管理账户"
          detail={isLoggedIntoCloud ? '已登录' : '未登录'}
          onClick={() => {}}
          separator={false}
        />
      </SettingsSection>

      {/* Section: AI 与隐私 */}
      <SettingsSection title="AI 与隐私">
        <SettingsToggleRow
          icon={<Cpu className="size-4" />}
          iconBg="bg-tertiary/20 text-tertiary"
          title="个性化推荐"
          detail="允许 AI 分析您的偏好"
          checked={aiRecommendations}
          onChange={setAiRecommendations}
        />
        <SettingsRow
          icon={<Shield className="size-4" />}
          iconBg="bg-error/20 text-error"
          title="隐私设置"
          onClick={() => {}}
          separator={false}
        />
      </SettingsSection>

      {/* Section: 地图与路线 */}
      <SettingsSection title="地图与路线">
        <SettingsRow
          icon={<Map className="size-4" />}
          iconBg="bg-primary/20 text-primary"
          title="离线地图下载"
          onClick={() => {}}
        />
        <SettingsRow
          icon={<Car className="size-4" />}
          iconBg="bg-secondary/20 text-secondary"
          title="路线偏好"
          detail="避开收费站"
          onClick={() => {}}
          separator={false}
        />
      </SettingsSection>

      {/* Section: 外观 */}
      <SettingsSection title="外观">
        <SettingsRow
          icon={<Moon className="size-4" />}
          iconBg="bg-surface-variant text-on-surface"
          title="深色模式"
          detail={appearanceMode === 'dark' ? '开启' : appearanceMode === 'light' ? '关闭' : '跟随系统'}
          onClick={handleToggleAppearance}
          separator={false}
        />
      </SettingsSection>

      {/* 退出登录 */}
      {isLoggedIntoCloud ? (
        <button
          className="w-full bg-surface-container border-[0.5px] border-outline-variant/30 rounded-xl p-4 text-center text-error font-body-lg text-body-lg hover:bg-error/10 transition-colors active:scale-[0.98] flex items-center justify-center gap-2"
          onClick={handleLogout}
          type="button"
        >
          <LogOut className="size-5" />
          退出登录
        </button>
      ) : null}
    </main>
  )
}

// ── SettingsSection 组件 ──

function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">{title}</h3>
      <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
        {children}
      </div>
    </section>
  )
}

// ── SettingsRow 组件 ──

function SettingsRow({
  icon,
  iconBg = 'bg-primary/20 text-primary',
  title,
  detail,
  onClick,
  separator = true,
}: {
  icon?: ReactNode
  iconBg?: string
  title: string
  detail?: string
  onClick?: () => void
  separator?: boolean
}) {
  return (
    <>
      <div
        className="flex items-center justify-between p-4 bg-surface-container hover:bg-surface-container-high/50 transition-colors cursor-pointer active:scale-[0.98]"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick?.() }}
      >
        <div className="flex items-center gap-4">
          {icon ? (
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${iconBg}`}>
              {icon}
            </div>
          ) : null}
          <span className="font-body-lg text-body-lg text-on-surface">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {detail ? <span className="font-label-sm text-label-sm text-on-surface-variant">{detail}</span> : null}
          <ChevronRight className="size-5 text-on-surface-variant" />
        </div>
      </div>
      {separator ? <div className="h-[1px] bg-outline-variant/30 ml-[60px]" /> : null}
    </>
  )
}

// ── SettingsToggleRow 组件 ──

function SettingsToggleRow({
  icon,
  iconBg = 'bg-tertiary/20 text-tertiary',
  title,
  detail,
  checked,
  onChange,
  separator = true,
}: {
  icon?: ReactNode
  iconBg?: string
  title: string
  detail?: string
  checked: boolean
  onChange: (checked: boolean) => void
  separator?: boolean
}) {
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
