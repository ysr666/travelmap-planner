import { db } from '../db/database'
import { requireSupabaseClient } from './supabaseClient'
import { buildGenericReminderCopy, markReminderSent } from './travelReminders'

export function getWebPushSupport() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function enableTravelWebPush() {
  if (!getWebPushSupport()) throw new Error('当前浏览器不支持 Web Push。')
  const publicKey = import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY?.trim()
  if (!publicKey) throw new Error('尚未配置 VITE_WEB_PUSH_PUBLIC_KEY。')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知权限未获授权，应用内提醒仍会保留。')
  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  const subscription = existing ?? await registration.pushManager.subscribe({ applicationServerKey: urlBase64ToUint8Array(publicKey), userVisibleOnly: true })
  const serialized = subscription.toJSON()
  if (!serialized.endpoint || !serialized.keys?.p256dh || !serialized.keys.auth) throw new Error('浏览器返回的推送订阅不完整。')
  const client = requireSupabaseClient()
  const { data, error: authError } = await client.auth.getUser()
  if (authError || !data.user) throw new Error('请先登录账号再启用跨设备通知。')
  const { error } = await client.from('push_subscriptions').upsert({ auth: serialized.keys.auth, endpoint: serialized.endpoint, p256dh: serialized.keys.p256dh, user_agent: navigator.userAgent.slice(0, 500), user_id: data.user.id }, { onConflict: 'user_id,endpoint' })
  if (error) throw new Error('保存推送订阅失败。')
  return subscription
}

export async function showDueLocalReminders() {
  if (!getWebPushSupport() || Notification.permission !== 'granted') return 0
  const reminders = await db.reminderSchedules.where('status').equals('pending').toArray()
  const due = reminders.filter((item) => Date.parse(item.triggerAt) <= Date.now())
  const registration = await navigator.serviceWorker.ready
  for (const reminder of due) {
    const copy = buildGenericReminderCopy(reminder.kind)
    await registration.showNotification(copy.title, { body: copy.body, data: { route: `/#/documents?tab=${reminder.objectType === 'document' ? 'documents' : 'transport'}` }, tag: reminder.occurrenceId })
    await markReminderSent(reminder.id)
  }
  return due.length
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}
