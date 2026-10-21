export function intendedDestination(state: unknown) {
  const from = typeof state === 'object' && state !== null && 'from' in state ? state.from : null
  if (typeof from !== 'string' || !from.startsWith('/') || from.startsWith('//') || /[\\\s]/.test(from)) return '/app'
  const url = new URL(from, 'https://local.invalid')
  // Normalize dot segments and restrict return paths to the protected app tree.
  return /^\/app(?:\/|$)/.test(url.pathname) ? url.pathname + url.search + url.hash : '/app'
}
