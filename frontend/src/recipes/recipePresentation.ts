/** Format the backend's date-only value without shifting it across time zones. */
export function formatCookedDate(value: string, short = false) {
  const date = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(date.valueOf())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', ...(short ? {} : { year: 'numeric' as const }), timeZone: 'UTC',
  }).format(date)
}
