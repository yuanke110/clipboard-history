export function formatRelativeTime(dateStr: string): string {
  const now = Date.now()
  const date = new Date(dateStr.replace(' ', 'T'))
  const diff = now - date.getTime()

  if (diff < 0) return dateStr

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return '刚刚'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}天前`

  // Older than 7 days: show date portion only
  return dateStr.slice(0, 10)
}
