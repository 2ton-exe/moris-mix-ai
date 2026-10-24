import { useContext, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useAuth } from '../auth/context'
import { DeleteRecipeDialog } from './DeleteRecipeDialog'
import { presentDeleteError } from './deleteErrors'
import { RecipeSourceContext } from './source'
import { useDeleteRecipe } from './useDeleteRecipe'

export function RecipeDeletionControl({ recipeId, recipeTitle }: { recipeId: string; recipeTitle: string }) {
  const { user, isAuthenticated } = useAuth()
  const source = useContext(RecipeSourceContext)
  const { mutation, isAvailable, requestFor } = useDeleteRecipe()
  const navigate = useNavigate()
  const [isOpen, setOpen] = useState(false)
  const submitLocked = useRef(false)
  const error = presentDeleteError(mutation.error)

  if (!isAuthenticated || !user) return null

  function confirmDelete() {
    const request = requestFor(recipeId)
    if (!request || submitLocked.current || mutation.isPending || (error && !error.canRetry)) return
    submitLocked.current = true
    mutation.mutate(request, {
      onSuccess: () => {
        submitLocked.current = false
        setOpen(false)
        navigate('/app/recipes', { state: { recipeDeleted: true, accountId: request.userId } })
      },
      onError: () => { submitLocked.current = false },
    })
  }

  return (
    <div className="recipe-delete-control">
      {isAvailable ? (
        <button className="button button-danger" type="button" onClick={(event) => { event.currentTarget.focus(); setOpen(true) }}>Delete recipe</button>
      ) : (
        <div className="recipe-delete-unavailable">
          <button className="button button-danger" type="button" disabled>Delete unavailable</button>
          <p role="status">Recipe deletion is not connected yet.</p>
        </div>
      )}
      {isOpen && isAvailable && source.deleteRecipe && <DeleteRecipeDialog
        recipeTitle={recipeTitle}
        isPending={mutation.isPending}
        errorMessage={error?.message}
        canRetry={error?.canRetry ?? true}
        onCancel={() => { if (!mutation.isPending) setOpen(false) }}
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
