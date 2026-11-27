import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { aiUsageKey, getAIUsage, subscribeAIUsageChanged } from '../api/aiUsage'

export function useAIUsage(userId: string, active: boolean) {
  const client = useQueryClient()
  const query = useQuery({
    queryKey: aiUsageKey(userId),
    queryFn: ({ signal }) => getAIUsage({ userId, signal }),
    enabled: active,
    staleTime: 30_000,
    retry: false,
  })

  useEffect(() => subscribeAIUsageChanged((changedUserId) => {
    if (changedUserId !== userId) return
    const filter = { queryKey: aiUsageKey(userId), exact: true }
    // A pending first read would otherwise swallow invalidation and return pre-operation usage.
    void client.cancelQueries(filter).then(() => client.invalidateQueries(filter))
  }), [client, userId])

  useEffect(() => {
    if (active) void client.refetchQueries({ queryKey: aiUsageKey(userId), type: 'active' }, { cancelRefetch: false })
  }, [active, client, userId])

  useEffect(() => {
    if (!active || !query.data || query.isError) return
    const deadlines = [query.data.daily.resetAt, query.data.shortTerm.nextChangeAt]
      .filter((value): value is string => value !== null).map(Date.parse)
    const elapsed = Date.now() - query.dataUpdatedAt
    const delay = Math.max(100, Math.min(...deadlines) - Date.parse(query.data.observedAt) - elapsed)
    const timer = window.setTimeout(() => {
      void client.invalidateQueries({ queryKey: aiUsageKey(userId) })
    }, Math.min(delay, 2_147_483_647))
    return () => window.clearTimeout(timer)
  }, [active, client, query.data, query.dataUpdatedAt, query.isError, userId])

  return query
}
