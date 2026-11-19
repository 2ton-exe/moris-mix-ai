export const categories = ['Recipes', 'Pantry', 'Meal ideas', 'Cooking help', 'Discovery', 'Notes'] as const
export type SuggestionContext = 'general' | 'collection' | 'reading' | 'writing' | 'notes' | 'pantry'
export type Suggestion = { id: string; category: typeof categories[number]; label: string; message: string; contexts: SuggestionContext[]; workflow: 'create' | 'suggest' }

// Every template stays within cooking-note extraction or pantry generation.
const groups: { category: Suggestion['category']; contexts: SuggestionContext[]; workflow: Suggestion['workflow']; labels: string[]; messages: string[] }[] = [
  { category: 'Recipes', contexts: ['writing'], workflow: 'create', labels: ['Record a recipe', 'Write breakfast', 'Save dinner notes', 'Write a soup', 'Record a bake'], messages: ['Write a recipe from these cooking notes: ', 'Write a recipe for the breakfast I cooked: ', 'Write a recipe from my dinner notes: ', 'Write a recipe for the soup I cooked: ', 'Write a recipe from my baking notes: '] },
  { category: 'Pantry', contexts: ['pantry'], workflow: 'suggest', labels: ['Use my ingredients', 'Cook with leftovers', 'Use fewer ingredients', 'Quick pantry meal', 'Use vegetables'], messages: ['What can I cook with ', 'What can I cook with ; use leftovers', 'What can I cook with ; use few ingredients', 'What can I cook with ; quick meal', 'What can I cook with ; vegetable-focused'] },
  { category: 'Meal ideas', contexts: ['collection', 'pantry'], workflow: 'suggest', labels: ['Dinner idea', 'Easy breakfast', 'Lunch idea', 'One-pot dinner', 'Quick supper'], messages: ['What can I cook with ; dinner', 'What can I cook with ; easy breakfast', 'What can I cook with ; lunch', 'What can I cook with ; one-pot dinner', 'What can I cook with ; quick supper'] },
  { category: 'Cooking help', contexts: ['reading', 'writing'], workflow: 'suggest', labels: ['Try an alternative', 'Simpler cooking', 'No-oven idea', 'Fewer cooking steps', 'Gentle cooking'], messages: ['What can I cook with ; suggest alternative ingredients', 'What can I cook with ; simple cooking method', 'What can I cook with ; no oven', 'What can I cook with ; fewer cooking steps', 'What can I cook with ; gentle cooking method'] },
  { category: 'Discovery', contexts: ['collection', 'reading'], workflow: 'suggest', labels: ['Try something new', 'Budget meal', 'Vegetarian idea', 'Lighter meal', 'Seasonal idea'], messages: ['What can I cook with ; something new', 'What can I cook with ; budget-friendly', 'What can I cook with ; vegetarian', 'What can I cook with ; lighter meal', 'What can I cook with ; seasonal meal'] },
  { category: 'Notes', contexts: ['notes', 'writing'], workflow: 'create', labels: ['Organize my notes', 'Record cooking steps', 'Finish recipe notes', 'Save family notes', 'Write leftover notes'], messages: ['Organize my notes into a recipe: ', 'Write a recipe from these steps I cooked: ', 'Write a recipe from these incomplete cooking notes: ', 'Write a recipe from these family cooking notes: ', 'Write a recipe from these leftover cooking notes: '] },
]
export const promptLibrary: Suggestion[] = groups.flatMap(group => group.labels.map((label, i) => ({ id: `${group.category}-${i}`, category: group.category, contexts: group.contexts, workflow: group.workflow, label, message: group.messages[i]! })))

export function suggestionContext(path: string): SuggestionContext {
  if (path.includes('/quick-entry')) return 'notes'
  if (path.includes('/chef')) return 'pantry'
  if (/\/recipes\/(?:new|[^/]+\/edit)$/.test(path)) return 'writing'
  if (/\/recipes\/[^/]+$/.test(path)) return 'reading'
  if (path === '/app' || path === '/app/recipes') return 'collection'
  return 'general'
}

export function selectSuggestions(context: SuggestionContext, previous: readonly string[] = [], random = Math.random): Suggestion[] {
  const shuffle = (items: Suggestion[]) => {
    for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [items[i], items[j]] = [items[j]!, items[i]!] }
    return items
  }
  const fresh = promptLibrary.filter(prompt => !previous.includes(prompt.id))
  const pool = shuffle(fresh.length >= 5 ? fresh : [...promptLibrary])
  const selected: Suggestion[] = []
  const pick = (eligible: Suggestion[]) => {
    const next = eligible.find(p => !selected.includes(p) && !selected.some(s => s.category === p.category)) ?? eligible.find(p => !selected.includes(p))
    if (next) selected.push(next)
  }
  if (context !== 'general') for (let i = 0; i < 3; i++) pick(pool.filter(p => p.contexts.includes(context)))
  while (selected.length < 5) pick(pool)
  return selected
}

export function promptCaret(message: string): number {
  const separator = message.indexOf(';')
  return separator < 0 ? message.length : separator
}
