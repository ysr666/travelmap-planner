import type { LucideIcon } from 'lucide-react'

export type TransportMode = 'walk' | 'transit' | 'car' | 'train' | 'flight' | 'other'
export type TicketScope = 'trip' | 'item' | 'unassigned'
export type TicketStorageMode = 'copy' | 'reference' | 'external'

export type Trip = {
  id: string
  title: string
  destination: string
  startDate: string
  endDate: string
  notes?: string
  createdAt: number
  updatedAt: number
}

export type Day = {
  id: string
  tripId: string
  date: string
  title: string
  sortOrder: number
}

export type ItineraryItem = {
  id: string
  tripId: string
  dayId: string
  title: string
  startTime?: string
  endTime?: string
  locationName?: string
  address?: string
  lat?: number
  lng?: number
  transportMode?: TransportMode
  previousTransportMode?: TransportMode
  previousTransportDurationMinutes?: number
  previousTransportNote?: string
  notes?: string
  ticketIds: string[]
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type TicketMeta = {
  id: string
  tripId: string
  itemId?: string
  scope?: TicketScope
  title?: string
  storageMode?: TicketStorageMode
  externalUrl?: string
  referenceLocation?: string
  fileName: string
  fileType: 'image' | 'pdf' | 'other'
  mimeType: string
  size: number
  note?: string
  createdAt: number
  updatedAt: number
}

export type TicketBlob = {
  ticketId: string
  blob: Blob
}

export type TicketFile = TicketMeta & {
  blob: Blob
}

export type RouteId =
  | 'home'
  | 'overview'
  | 'timeline'
  | 'map'
  | 'item'
  | 'tickets'
  | 'settings'

export type NavItem = {
  id: RouteId
  label: string
  icon: LucideIcon
}

export type MockTrip = {
  title: string
  destination: string
  dateRange: string
  notes: string
  days: MockDay[]
}

export type MockDay = {
  id: string
  label: string
  date: string
  title: string
  itemCount: number
}

export type MockItineraryItem = {
  id: string
  order: number
  title: string
  time: string
  location: string
  address: string
  transportMode: string
  notes: string
  hasCoordinates: boolean
  ticketCount: number
}

export type MockTicket = {
  id: string
  title: string
  type: 'image' | 'pdf' | 'qr'
  size: string
  linkedTo: string
}
