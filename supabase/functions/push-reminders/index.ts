import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

type ReminderRow = {
  id: string
  user_id: string
  occurrence_id: string
  object_id: string
  object_type: 'document' | 'transport'
  reminder_kind: 'document_expiry' | 'check_in' | 'departure' | 'transfer'
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 })
  const cronSecret = Deno.env.get('TRIPMAP_REMINDER_CRON_SECRET')
  if (!cronSecret || request.headers.get('x-cron-secret') !== cronSecret) return new Response('unauthorized', { status: 401 })
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const subject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
  if (!url || !serviceKey || !publicKey || !privateKey) return new Response('not_configured', { status: 503 })
  webpush.setVapidDetails(subject, publicKey, privateKey)
  const client = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: reminders, error } = await client
    .from('reminder_schedules')
    .select('id,user_id,occurrence_id,object_id,object_type,reminder_kind')
    .eq('status', 'pending')
    .lte('trigger_at', new Date().toISOString())
    .limit(100)
  if (error) return new Response('query_failed', { status: 500 })
  let delivered = 0
  for (const reminder of (reminders ?? []) as ReminderRow[]) {
    const { data: subscriptions } = await client.from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', reminder.user_id)
    let deliveredForReminder = false
    for (const subscription of subscriptions ?? []) {
      const { data: existing } = await client.from('reminder_deliveries').select('occurrence_id').eq('user_id', reminder.user_id).eq('occurrence_id', reminder.occurrence_id).eq('subscription_id', subscription.id).maybeSingle()
      if (existing) { deliveredForReminder = true; continue }
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { auth: subscription.auth, p256dh: subscription.p256dh } }, JSON.stringify(genericPayload(reminder)))
        await client.from('reminder_deliveries').insert({ occurrence_id: reminder.occurrence_id, subscription_id: subscription.id, user_id: reminder.user_id })
        deliveredForReminder = true
        delivered += 1
      } catch (caught) {
        const statusCode = typeof caught === 'object' && caught && 'statusCode' in caught ? Number(caught.statusCode) : 0
        if (statusCode === 404 || statusCode === 410) await client.from('push_subscriptions').delete().eq('id', subscription.id)
      }
    }
    if (deliveredForReminder) {
      await client.from('reminder_schedules').update({ sent_at: new Date().toISOString(), status: 'sent' }).eq('id', reminder.id).eq('user_id', reminder.user_id)
    }
  }
  return Response.json({ delivered, processed: reminders?.length ?? 0 })
})

function genericPayload(reminder: ReminderRow) {
  const copy = reminder.reminder_kind === 'document_expiry'
    ? { body: '你有一项旅行证件需要检查。', title: '旅行证件提醒' }
    : reminder.reminder_kind === 'check_in'
      ? { body: '你有一段大交通订单需要办理值机。', title: '值机提醒' }
      : reminder.reminder_kind === 'transfer'
        ? { body: '你有一段换乘安排即将开始。', title: '换乘提醒' }
        : { body: '你有一段大交通行程即将出发。', title: '出发提醒' }
  const tab = reminder.object_type === 'document' ? 'documents' : 'transport'
  return { ...copy, data: { objectId: reminder.object_id, route: `/#/documents?tab=${tab}` }, tag: reminder.occurrence_id }
}
