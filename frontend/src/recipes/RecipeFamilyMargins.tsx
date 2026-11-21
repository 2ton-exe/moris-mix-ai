import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { lineageApi } from '../ai-chef/lineage'
import { useRecipe } from './queries'
import { recipeKeys } from './queryOptions'
import { isRecipeAccessError } from './errors'

export function RecipeFamilyMargins({ recipeId, userId, journalReturn }: {
  recipeId: string; userId: string; journalReturn: string
}) {
  const lineage = useQuery({
    queryKey: [...recipeKeys.detail(userId, recipeId), 'lineage'],
    queryFn: async ({ signal }) => {
      const { lineage } = await lineageApi.get(recipeId, { userId, signal })
      signal.throwIfAborted()
      return [...new Set(lineage.map(({ parent_recipe_id }) => parent_recipe_id))]
        .filter((id) => id !== recipeId).slice(0, 10)
    },
    retry: false,
  })

  return <div className="mm-journal-tool">
    {lineage.isPending ? <p role="status">{lineage.isPaused ? 'Waiting for a connection.' : 'Checking saved parent recipes…'}</p>
      : lineage.isError ? <>
        <p role="status">Could not check saved parent recipes.</p>
        <button type="button" onClick={() => void lineage.refetch()}>Retry parent recipes</button>
      </> : lineage.data.length === 0 ? <p>No parent recipes are recorded.</p>
        : <ul>{lineage.data.map((id) => <RecipeParent key={id} id={id} journalReturn={journalReturn} />)}</ul>}
  </div>
}

function RecipeParent({ id, journalReturn }: { id: string; journalReturn: string }) {
  const query = useRecipe(id)
  if (query.isPending) return <li>{query.isPaused ? 'Waiting for a connection.' : 'Checking a parent recipe…'}</li>
  if (isRecipeAccessError(query.error)) return <li>A parent recipe is unavailable.</li>
  if (!query.data) return <li>
    A parent recipe could not be loaded.{' '}
    <button type="button" onClick={() => void query.refetch()}>Retry loading parent</button>
  </li>
  return <li><Link state={{ journalReturn }} to={`/app/recipes/${encodeURIComponent(id)}`}>Based on {query.data.title}</Link></li>
}
