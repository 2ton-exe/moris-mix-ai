import type { ReactNode } from 'react'
import { useAuth } from '../auth/context'
import './recipe-form.css'

export function RecipeEditorFrame({ mode, connected, children }: {
  mode: 'create' | 'edit'; connected: boolean; children: ReactNode
}) {
  const { user } = useAuth()
  return <main className="page-shell recipe-form-shell">
    <div className="eyebrow"><span className="status-dot" /> Mori’s Mix</div>
    <h1>{mode === 'create' ? 'A recipe of your own.' : 'Make it your own.'}</h1>
    <p className="intro">{mode === 'create' ? 'Keep the ingredients, the method, and the little discoveries along the way.' : 'A small adjustment today, a new favorite tomorrow.'}</p>
    {!connected && <p className="recipe-form-notice" role="note">Recipe saving is not connected yet. Nothing on this page is saved to your journal.</p>}
    <div className="recipe-form-content" key={user?.id ?? 'signed-out'}>{children}</div>
  </main>
}
