export type ExtractRecipeInput = { rawText: string };
export type ExtractedRecipe = { title: string; ingredients: any[]; instructions: any[] };

export type GenerateRecipeInput = { pantryItems: string[]; preferences?: string };
export type GeneratedRecipe = { recipe: any; parentRecipeIds: string[] };

export interface AIProvider {
  extractRecipe(input: ExtractRecipeInput): Promise<ExtractedRecipe>;
  generateRecipe(input: GenerateRecipeInput): Promise<GeneratedRecipe>;
  testConnection(): Promise<string>; 
}