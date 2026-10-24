import type { ReactNode } from 'react'

export function RecipeFormField({ id, label, error, hint, children }: {
  id: string; label: string; error?: string; hint?: string; children: ReactNode
}) {
  return <div className="recipe-form-field">
    <label htmlFor={id}>{label}</label>
    {hint && <p className="field-hint" id={`${id}-hint`}>{hint}</p>}
    {children}
    {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
  </div>
}
