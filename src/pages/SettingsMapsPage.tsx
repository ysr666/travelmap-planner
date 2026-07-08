import { Map, Wifi } from 'lucide-react'

export function SettingsMapsPage() {
  return (
    <main className="pt-24 px-4 max-w-3xl mx-auto space-y-section-gap pb-32">
      <div className="mb-8">
        <h2 className="font-headline-lg-mobile text-headline-lg-mobile text-on-surface">离线地图</h2>
        <p className="font-body-md text-body-md text-on-surface-variant mt-2">
          下载地图区域供离线使用
        </p>
      </div>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">地图状态</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 flex flex-col">
          <div className="flex items-center justify-between p-4 bg-surface-container">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center">
                <Wifi className="size-4" />
              </div>
              <span className="font-body-lg text-body-lg text-on-surface">在线状态</span>
            </div>
            <span className="font-label-sm text-label-sm text-on-secondary-fixed">在线</span>
          </div>
          <div className="h-[1px] bg-outline-variant/30 ml-[60px]" />
          <div className="flex items-center justify-between p-4 bg-surface-container">
            <div className="flex items-center gap-4">
              <div className="w-8 h-8 rounded-full bg-surface-container-highest text-on-surface-variant flex items-center justify-center">
                <Map className="size-4" />
              </div>
              <span className="font-body-lg text-body-lg text-on-surface">地图来源</span>
            </div>
            <span className="font-label-sm text-label-sm text-on-surface-variant">OpenFreeMap</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="font-label-sm text-label-sm text-on-surface-variant mb-stack-gap uppercase tracking-wider px-4">说明</h3>
        <div className="bg-surface-container rounded-xl overflow-hidden border-[0.5px] border-outline-variant/30 p-4">
          <p className="font-body-md text-body-md text-on-surface-variant leading-relaxed">
            旅图使用 OpenFreeMap 作为地图源，需要网络连接才能加载地图瓦片。
            路线数据保存在本地 IndexedDB 中，离线时仍可查看已缓存的路线。
          </p>
        </div>
      </section>
    </main>
  )
}
