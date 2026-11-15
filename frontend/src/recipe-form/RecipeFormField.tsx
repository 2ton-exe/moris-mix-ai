import type { ReactNode } from 'react'

export function RecipeFormField({ id, label, error, hint, children }: {
  id: string; label: ReactNode; error?: string; hint?: string; children: ReactNode
}) {
  return <div className="recipe-form-field">
    <label htmlFor={id}>{label}</label>
    {children}
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>
}
