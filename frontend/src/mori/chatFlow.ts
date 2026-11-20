import { splitPastedPantryText } from '../ai-chef/pantry'
import type { ExtractedRecipe } from '../quick-ai/extractRecipe'

export type MoriWorkflow = 'create' | 'suggest'
type MoriNavigation = { path: string; message: string; focus?: 'notes' | 'pantry' }

export function requestedNavigation(text: string): MoriNavigation | null {
  const value = text.toLowerCase()
  if (/\b(?:open|show|go to|take me to)\b.*\b(?:recipe editor|new recipe)\b/.test(value)) {
    return { path: '/app/recipes/new', message: 'Opening a new recipe.' }
  }
  if (/^(?:please\s+)?open recipes[.!]?$/.test(value) || /\b(?:show|open|go to|take me to)\b.*\b(?:my recipes|recipe collection|journal)\b/.test(value)) {
    return { path: '/app/recipes', message: 'Opening your recipe collection.' }
  }
  if (/\b(?:where|how(?: do i)?|help|open|show|go to|take me to|point me to|point to)\b.*\b(?:pantry|ingredient field|ingredients field|(?:add|enter|type|put) ingredients?)\b/.test(value)) {
    return { path: '/app/chef', focus: 'pantry', message: 'Opening the pantry field.' }
  }
  if (/\b(?:where|how|help|open|show|go to|take me to)\b.*\b(?:cooking notes|recipe notes|quick entry)\b/.test(value)) {
    return { path: '/app/quick-entry', focus: 'notes', message: 'Opening the cooking notes field.' }
  }
  return null
}

export function requestedRecipeTitle(text: string) {
  const query = text.match(/^(?:find|look up|search for) my[ \t]+([^\r\n]+)$/i)?.[1]?.trim()
  const title = query?.match(/^"(.+)"[?]?$/)?.[1] ?? query?.replace(/\?$/, '')
  return title?.trim() || null
}

export function requestedReview(text: string): MoriWorkflow | 'any' | { title: string; alias?: string } | null {
  const value = text.trim().replace(/[?!.]+$/, '')
  const request = value.match(/^(?:please\s+)?review\s+(.+)$/i)?.[1] ??
    value.match(/^(?:please\s+)?(?:open|show)\s+(?:me\s+)?(.+)\s+review$/i)?.[1]
  const target = request?.replace(/^(?:the|my|this|that)\s+/i, '').trim()
  if (!target) return null
  if (/^(?:AI Chef(?: (?:idea|recipe|draft))?|pantry (?:idea|recipe|draft))$/i.test(target)) return 'suggest'
  if (/^(?:Quick AI Entry|Cooking Notes)(?: (?:recipe|draft))?$/i.test(target)) return 'create'
  if (/^(?:draft|recipe|it|idea|recipe draft)$/i.test(target)) return 'any'
  const quoted = target.match(/^["“](.+)["”](?: (?:draft|recipe|idea))?$/i)?.[1]
  if (quoted) return { title: quoted.trim().toLowerCase() }
  const title = target.toLowerCase()
  return { title, alias: title.replace(/ (?:draft|recipe|idea)$/, '') }
}

export function requestedWorkflow(text: string, pendingCreateFollowUp = false): MoriWorkflow | null {
  if (/\b(?:what can i (?:cook|make)|what should i (?:cook|make)|find something to cook|meal idea|suggest\b)\b/i.test(text) ||
    (!pendingCreateFollowUp && /\b(?:i have|we have)\b/i.test(text))) return 'suggest'
  if (/\b(?:i (?:made|cooked)|we (?:made|cooked)|write (?:a )?recipe|record (?:a )?recipe|organize (?:my )?notes|recipe notes)\b/i.test(text)) return 'create'
  return null
}

export function missingRecipeDetails(recipe: ExtractedRecipe) {
  return [
    ...(recipe.title.trim() ? [] : ['a recipe name']),
    ...(recipe.ingredients.some((ingredient) => ingredient.name.trim()) ? [] : ['the ingredients']),
    ...(recipe.instructions.some((step) => step.text.trim()) ? [] : ['the cooking steps']),
  ]
}

export function parsePantryPrompt(value: string) {
  const separator = value.indexOf(';')
  const ingredientText = (separator < 0 ? value : value.slice(0, separator)).trim()
  const preferenceText = separator < 0 ? '' : value.slice(separator + 1).trim()
  const withIngredients = ingredientText.match(/\b(?:with|using|have|got)\s+([\s\S]+)$/i)?.[1] ??
    (/^(?:what can i (?:cook|make)|what should i (?:cook|make)|find something to cook|meal idea|suggest\b|i have\b|we have\b)/i.test(ingredientText) ? '' : ingredientText)
  // shortcut: split "and" as a list separator; use a structured pantry picker if compound ingredient names need exact handling.
  const list = withIngredients.replace(/\s+and\s+/gi, ',').replace(/[?!.]+\s*$/, '')
  return {
    pantryItems: splitPastedPantryText(list).map((item) => item.trim().replace(/[?!.]+\s*$/, '')).filter(Boolean),
    preferences: preferenceText.trim(),
  }
}
