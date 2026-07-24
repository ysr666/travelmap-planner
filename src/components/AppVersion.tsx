type AppVersionProps = {
  label?: string
  suffix?: string
  className?: string
}

export function AppVersion({ label = '旅图', suffix, className = '' }: AppVersionProps) {
  const labelText = label === '旅图' ? `${label} v${__APP_VERSION__}` : `${label}：v${__APP_VERSION__}`
  const commitLabel = typeof __APP_COMMIT_SHA__ === 'string' && __APP_COMMIT_SHA__
    ? ` · ${__APP_COMMIT_SHA__}`
    : ''

  return (
    <p className={`truncate text-center text-xs font-medium tm-muted ${className}`}>
      {labelText}{commitLabel}
      {suffix ? ` · ${suffix}` : null}
    </p>
  )
}
