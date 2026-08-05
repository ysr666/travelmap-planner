import { listDaysByTrip, listItemsByTrip, listTicketsByTrip, listTrips } from '../db'
import type { HomeTripSnapshot } from './homeOverview'

export async function loadHomeTripSnapshots(): Promise<HomeTripSnapshot[]> {
  const trips = await listTrips()
  return Promise.all(trips.map(async (trip) => {
    const [days, items, tickets] = await Promise.all([
      listDaysByTrip(trip.id),
      listItemsByTrip(trip.id),
      listTicketsByTrip(trip.id),
    ])
    return { days, items, tickets, trip }
  }))
}
