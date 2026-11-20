export function aiRateLimitReason(code: string | undefined): string | undefined {
  switch (code) {
    case 'AI_REQUEST_RATE_LIMITED':
      return 'You sent too many AI requests in a short time.'
    case 'AI_CAPACITY_EXCEEDED':
      return 'Mori’s shared AI capacity is full.'
  }
}
