// Abbreviated relative-time formatter for the project sidebar.
// "just now", "5m", "2h", "3d", "2w", "5mo", "1y".

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  if (!timestamp || !Number.isFinite(timestamp)) return ''

  const diffMs = now - timestamp
  if (diffMs < 60_000) return 'just now'

  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (days < 30) return `${weeks}w`

  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`

  const years = Math.floor(days / 365)
  return `${years}y`
}
