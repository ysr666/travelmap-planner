interface ExecutionContext { waitUntil(promise: Promise<unknown>): void }
interface ScheduledController { scheduledTime: number; cron: string }
