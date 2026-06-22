type RegisterSWOptions = {
  onRegisteredSW?: (swScriptUrl: string, registration?: ServiceWorkerRegistration) => void
}

export function registerSW(options: RegisterSWOptions = {}) {
  window.setTimeout(() => {
    options.onRegisteredSW?.('/sw.js')
  }, 0)

  return async () => {}
}
