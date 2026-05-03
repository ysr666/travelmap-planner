import { db } from './database'
import { createId } from './ids'
import type { Day, ItineraryItem, Trip } from '../types'

export async function createDemoTrip() {
  const now = Date.now()
  const tripId = createId('trip')
  const dayOneId = createId('day')
  const dayTwoId = createId('day')

  const trip: Trip = {
    id: tripId,
    title: '东京春日旅行',
    destination: '日本东京',
    startDate: '2026-04-12',
    endDate: '2026-04-17',
    notes: '示例数据只保存在本机 IndexedDB，可用于后续地图和时间轴测试。',
    createdAt: now,
    updatedAt: now,
  }

  const days: Day[] = [
    {
      id: dayOneId,
      tripId,
      date: '2026-04-12',
      title: '抵达与涩谷',
      sortOrder: 1,
    },
    {
      id: dayTwoId,
      tripId,
      date: '2026-04-13',
      title: '浅草与东京站',
      sortOrder: 2,
    },
  ]

  const items: ItineraryItem[] = [
    {
      id: createId('item'),
      tripId,
      dayId: dayOneId,
      title: 'Hotel Metropolitan Tokyo 入住',
      startTime: '15:00',
      locationName: 'Hotel Metropolitan Tokyo',
      address: '1 Chome-6-1 Nishiikebukuro, Toshima City, Tokyo',
      lat: 35.7292,
      lng: 139.7109,
      transportMode: 'train',
      notes: '确认入住时间和酒店订单。',
      ticketIds: [],
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId('item'),
      tripId,
      dayId: dayOneId,
      title: '明治神宫散步',
      startTime: '16:30',
      locationName: 'Meiji Shrine',
      address: '1-1 Yoyogikamizonocho, Shibuya City, Tokyo',
      lat: 35.6764,
      lng: 139.6993,
      transportMode: 'transit',
      notes: '轻松散步，不安排太紧。',
      ticketIds: [],
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId('item'),
      tripId,
      dayId: dayOneId,
      title: 'Shibuya Sky 夜景',
      startTime: '18:30',
      locationName: 'Shibuya Sky',
      address: '2 Chome-24-12 Shibuya, Shibuya City, Tokyo',
      lat: 35.6585,
      lng: 139.702,
      transportMode: 'walk',
      notes: '后续阶段可绑定二维码门票。',
      ticketIds: [],
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId('item'),
      tripId,
      dayId: dayTwoId,
      title: '浅草寺',
      startTime: '10:00',
      locationName: 'Senso-ji',
      address: '2 Chome-3-1 Asakusa, Taito City, Tokyo',
      lat: 35.7148,
      lng: 139.7967,
      transportMode: 'transit',
      notes: '上午避开人流。',
      ticketIds: [],
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: createId('item'),
      tripId,
      dayId: dayTwoId,
      title: '东京站周边',
      startTime: '14:00',
      locationName: 'Tokyo Station',
      address: '1 Chome Marunouchi, Chiyoda City, Tokyo',
      lat: 35.6812,
      lng: 139.7671,
      transportMode: 'train',
      notes: '可作为后续车票管理测试点。',
      ticketIds: [],
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
    },
  ]

  await db.transaction('rw', db.trips, db.days, db.itineraryItems, async () => {
    await db.trips.add(trip)
    await db.days.bulkAdd(days)
    await db.itineraryItems.bulkAdd(items)
  })

  return trip
}
