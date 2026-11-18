import { describe, expect, it } from 'vitest'
import { missingRecipeDetails, parsePantryPrompt, requestedNavigation, requestedWorkflow } from './chatFlow'

describe('Mori chat intent and recipe details', () => {
  it('maps only supported recipe navigation requests', () => {
    expect(requestedNavigation('Please open my recipes')).toMatchObject({ path: '/app/recipes' })
    expect(requestedNavigation('Show me the pantry field')).toMatchObject({ path: '/app/chef', focus: 'pantry' })
    expect(requestedNavigation('Point me to where I can add ingredients')).toMatchObject({ path: '/app/chef', focus: 'pantry' })
    expect(requestedNavigation('Where are my cooking notes?')).toMatchObject({ path: '/app/quick-entry', focus: 'notes' })
    expect(requestedNavigation('Open a blank recipe form')).toMatchObject({ path: '/app/recipes/new' })
    expect(requestedNavigation('Click delete on my account')).toBeNull()
  })

  it('recognizes recipe creation and cooking suggestions', () => {
    expect(requestedWorkflow('I cooked this last night')).toBe('create')
    expect(requestedWorkflow('What can I make with lentils?')).toBe('suggest')
    expect(requestedWorkflow('I have rice and eggs')).toBe('suggest')
    expect(requestedWorkflow('Tell me a joke')).toBeNull()
  })

  it('parses pantry items separately from optional preferences', () => {
    expect(parsePantryPrompt('What can I cook with rice and eggs; quick and spicy')).toEqual({
      pantryItems: ['rice', 'eggs'],
      preferences: 'quick and spicy',
    })
    expect(parsePantryPrompt('What can I cook?')).toEqual({ pantryItems: [], preferences: '' })
    expect(parsePantryPrompt('I have rice and eggs')).toEqual({ pantryItems: ['rice', 'eggs'], preferences: '' })
    expect(parsePantryPrompt('rice; quick; no dairy')).toEqual({ pantryItems: ['rice'], preferences: 'quick; no dairy' })
  })

  it('reports only required recipe fields that are missing', () => {
    expect(missingRecipeDetails({
      title: 'Tomato soup',
      ingredients: [],
      instructions: [],
    })).toEqual(['the ingredients', 'the cooking steps'])
    expect(missingRecipeDetails({
      title: '',
      ingredients: [{ name: 'tomatoes', quantity: null, unit: null, inferred: false }],
      instructions: [{ step: 1, text: 'Simmer.' }],
    })).toEqual(['a recipe name'])
  })
})
