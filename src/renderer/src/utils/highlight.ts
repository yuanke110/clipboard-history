export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function highlightText(text: string, keyword: string): string {
  const escaped = escapeHtml(text)
  if (!keyword.trim()) return escaped
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(
    new RegExp(`(${escapedKeyword})`, 'gi'),
    (match) => `<mark>${match}</mark>`
  )
}
