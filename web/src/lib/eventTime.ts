const timeRange = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/** "Happening now · until 9:00 PM", "Today · 7:00 – 9:00 PM", or "Tue, Oct 27 · 7:00 – 9:00 PM". */
export function eventTime(startsAt: string, endsAt: string) {
  const start = new Date(startsAt)
  const end = new Date(endsAt)
  const now = new Date()
  if (start <= now) return `Happening now · until ${timeRange.format(end)}`
  const day = start.toDateString() === now.toDateString() ? 'Today' : dayLabel.format(start)
  return `${day} · ${timeRange.formatRange(start, end)}`
}
