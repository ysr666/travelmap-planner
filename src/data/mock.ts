import type { MockItineraryItem, MockTicket, MockTrip } from '../types'

export const mockTrip: MockTrip = {
  title: '东京春日旅行',
  destination: '日本东京',
  dateRange: '2026 年 4 月 12 日 - 4 月 17 日',
  notes: '酒店、票据、每日路线和订单文件都将保存在本机。',
  days: [
    {
      id: 'day-1',
      label: '第 1 天',
      date: '4 月 12 日',
      title: '抵达与涩谷',
      itemCount: 4,
    },
    {
      id: 'day-2',
      label: '第 2 天',
      date: '4 月 13 日',
      title: '浅草与上野',
      itemCount: 5,
    },
    {
      id: 'day-3',
      label: '第 3 天',
      date: '4 月 14 日',
      title: '博物馆与银座',
      itemCount: 3,
    },
  ],
}

export const mockItems: MockItineraryItem[] = [
  {
    id: 'hotel',
    order: 1,
    title: '酒店入住',
    time: '15:00',
    location: 'Nohga Hotel Ueno Tokyo',
    address: '2 Chome-21-10 Higashiueno, Taito City',
    transportMode: '电车',
    notes: '后续可在票据库保存酒店订单 PDF 和证件副本。',
    hasCoordinates: true,
    ticketCount: 1,
  },
  {
    id: 'sky',
    order: 2,
    title: 'Shibuya Sky 夜景',
    time: '17:30',
    location: 'Shibuya Scramble Square',
    address: '2 Chome-24-12 Shibuya, Shibuya City',
    transportMode: '步行',
    notes: '预约入场，后续可绑定二维码门票。',
    hasCoordinates: true,
    ticketCount: 2,
  },
  {
    id: 'dinner',
    order: 3,
    title: '晚餐预约',
    time: '19:45',
    location: 'Ebisu Yokocho',
    address: '1 Chome-7-4 Ebisu, Shibuya City',
    transportMode: '地铁',
    notes: '保存预约确认截图，后续阶段会接入真实票据。',
    hasCoordinates: true,
    ticketCount: 1,
  },
]

export const mockTickets: MockTicket[] = [
  {
    id: 'ticket-1',
    title: '酒店订单.pdf',
    type: 'pdf',
    size: '428 KB',
    linkedTo: '酒店入住',
  },
  {
    id: 'ticket-2',
    title: 'Shibuya Sky 二维码.png',
    type: 'qr',
    size: '214 KB',
    linkedTo: 'Shibuya Sky 夜景',
  },
  {
    id: 'ticket-3',
    title: '成田特快车票.jpg',
    type: 'image',
    size: '1.2 MB',
    linkedTo: '旅行',
  },
]
