type AppVersionProps = {
  label?: string
  suffix?: string
  className?: string
}

export function AppVersion({ label = '旅图', suffix, className = '' }: AppVersionProps) {
  const labelText = label === '旅图' ? `${label} v${__APP_VERSION__}` : `${label}：v${__APP_VERSION__}`

  return (
    <p className={`truncate text-center text-xs font-medium tm-muted ${className}`}>
      {labelText}
      {suffix ? ` · ${suffix}` : null}
    </p>
  )
}
