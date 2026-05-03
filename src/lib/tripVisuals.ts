import type { Trip } from '../types'

export type TripStatus = 'active' | 'planned' | 'ended' | 'draft'

type TripVisual = {
  emoji: string
  label: string
  gradientClass: string
  accentClass: string
}

export function getTripVisual(trip: Trip): TripVisual {
  const text = `${trip.title} ${trip.destination}`.toLowerCase()

  if (text.includes('东京') || text.includes('日本') || text.includes('tokyo') || text.includes('japan')) {
    return {
      accentClass: 'text-rose-100',
      emoji: '🌸',
      gradientClass: 'from-rose-300 via-sky-300 to-indigo-400',
      label: 'Tokyo',
    }
  }

  if (text.includes('伦敦') || text.includes('英国') || text.includes('london') || text.includes('uk')) {
    return {
      accentClass: 'text-slate-100',
      emoji: '🏛️',
      gradientClass: 'from-slate-500 via-blue-500 to-cyan-400',
      label: 'London',
    }
  }

  if (text.includes('北海道') || text.includes('雪') || text.includes('hokkaido')) {
    return {
      accentClass: 'text-cyan-100',
      emoji: '🏔️',
      gradientClass: 'from-cyan-300 via-blue-300 to-slate-400',
      label: 'Hokkaido',
    }
  }

  return {
    accentClass: 'text-teal-100',
    emoji: '📍',
    gradientClass: 'from-sky-400 via-teal-300 to-emerald-400',
    label: trip.destination || 'Trip',
  }
}

export function getTripStatus(trip: Trip, now = new Date()): { label: string; status: TripStatus; className: string } {
  if (!trip.startDate || !trip.endDate || trip.endDate < trip.startDate) {
    return {
      className: 'bg-slate-100 text-slate-500',
      label: '草稿',
      status: 'draft',
    }
  }

  const today = formatDateKey(now)
  if (today >= trip.startDate && today <= trip.endDate) {
    return {
      className: 'bg-emerald-50 text-emerald-700',
      label: '进行中',
      status: 'active',
    }
  }

  if (today < trip.startDate) {
    return {
      className: 'bg-sky-50 text-sky-700',
      label: '计划中',
      status: 'planned',
    }
  }

  return {
    className: 'bg-slate-100 text-slate-500',
    label: '已结束',
    status: 'ended',
  }
}

function formatDateKey(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
