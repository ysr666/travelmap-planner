import type { FlightStatusSnapshot, TransportSegment } from '../types'

export interface FlightStatusProvider {
  readonly name: FlightStatusSnapshot['provider']
  getStatus(segment: TransportSegment, now?: Date): Promise<FlightStatusSnapshot>
}

export function createDisabledFlightStatusProvider(): FlightStatusProvider {
  return {
    name: 'disabled',
    async getStatus(_segment, now = new Date()) {
      return {
        expiresAt: now.toISOString(),
        fetchedAt: now.toISOString(),
        provider: 'disabled',
        status: 'unknown',
        warnings: ['实时航班动态尚未启用，请通过承运方官网或外部应用核对。'],
      }
    },
  }
}

export function createMockFlightStatusProvider(status: FlightStatusSnapshot['status'] = 'scheduled'): FlightStatusProvider {
  return {
    name: 'mock',
    async getStatus(segment, now = new Date()) {
      return {
        arrivalTime: segment.arrivalTime,
        departureTime: segment.departureTime,
        expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        fetchedAt: now.toISOString(),
        gate: segment.gate,
        provider: 'mock',
        status,
        terminal: segment.terminal,
        warnings: ['这是测试航班动态，不会覆盖票面订单。'],
      }
    },
  }
}
