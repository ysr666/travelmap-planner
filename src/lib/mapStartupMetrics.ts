const MAP_TRACE_LABEL = '[TripMap map startup]'

let traceStart = 0

export function markMapStartup(stage: string, detail?: Record<string, unknown>) {
  if (!import.meta.env.DEV || typeof performance === 'undefined') {
    return
  }

  if (traceStart === 0) {
    traceStart = performance.now()
  }

  const elapsedMs = Math.round(performance.now() - traceStart)
  if (detail) {
    console.debug(MAP_TRACE_LABEL, `${elapsedMs}ms`, stage, detail)
  } else {
    console.debug(MAP_TRACE_LABEL, `${elapsedMs}ms`, stage)
  }
}

export function resetMapStartupTrace(stage = 'TripWorkspace mounted') {
  if (!import.meta.env.DEV || typeof performance === 'undefined') {
    return
  }

  traceStart = performance.now()
  console.debug(MAP_TRACE_LABEL, '0ms', stage)
}
