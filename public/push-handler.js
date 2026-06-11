self.addEventListener('push', (event) => {
  let payload = { title: '旅行提醒', body: '你有一项旅行安排需要检查。', tag: 'tripmap-reminder', data: { route: '/#/documents' } }
  try { payload = { ...payload, ...event.data.json() } } catch { /* keep generic copy */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    data: payload.data,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: payload.tag,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.route || '/#/documents', self.location.origin).href
  event.waitUntil(self.clients.matchAll({ includeUncontrolled: true, type: 'window' }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client)
    if (existing) { existing.navigate(target); return existing.focus() }
    return self.clients.openWindow(target)
  }))
})
