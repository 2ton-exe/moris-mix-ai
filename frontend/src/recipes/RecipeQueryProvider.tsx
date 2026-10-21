import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '../auth/context'
import { defaultRecipeSource, RecipeSourceContext } from './source'
import { retryRecipeQuery } from './queryOptions'
import type { RecipeSource } from './types'

function AccountQueries({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, gcTime: 5 * 60_000, retry: retryRecipeQuery },
    },
  }))

  useEffect(() => () => {
    // Also cancels consumed signals. Late completions cannot repopulate a new
    // account's client, even if a transport ignores cancellation.
    void client.cancelQueries()
    client.clear()
  }, [client])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

export function RecipeQueryProvider({ children, source = defaultRecipeSource }: {
  children: ReactNode
  source?: RecipeSource
}) {
  const { user } = useAuth()
  return (
    <RecipeSourceContext.Provider value={source}>
      <AccountQueries key={user?.id ?? 'signed-out'}>{children}</AccountQueries>
    </RecipeSourceContext.Provider>
  )
}
