// Curated food nouns avoid stemming unrelated words or erasing ingredient qualifiers.
const singulars = new Map(Object.entries({
  apples: "apple",
  aubergines: "aubergine",
  avocados: "avocado",
  bananas: "banana",
  beans: "bean",
  beets: "beet",
  bellies: "belly",
  berries: "berry",
  breasts: "breast",
  carrots: "carrot",
  chickpeas: "chickpea",
  chilies: "chili",
  chillies: "chili",
  cloves: "clove",
  courgettes: "courgette",
  cucumbers: "cucumber",
  drumsticks: "drumstick",
  eggs: "egg",
  eggplants: "eggplant",
  fillets: "fillet",
  fishes: "fish",
  leaves: "leaf",
  lemons: "lemon",
  lentils: "lentil",
  limes: "lime",
  mushrooms: "mushroom",
  noodles: "noodle",
  olives: "olive",
  onions: "onion",
  oranges: "orange",
  peas: "pea",
  peppers: "pepper",
  potatoes: "potato",
  prawns: "prawn",
  scallions: "scallion",
  shallots: "shallot",
  shrimps: "shrimp",
  stalks: "stalk",
  steaks: "steak",
  thighs: "thigh",
  tomatoes: "tomato",
  wings: "wing",
  zucchinis: "zucchini",
}));

const aliases = new Map([
  ["scallion", "green onion"],
  ["aubergine", "eggplant"],
  ["courgette", "zucchini"],
  ["garbanzo bean", "chickpea"],
  ["coriander leaf", "cilantro"],
  ["chilli", "chili"],
]);
const aliasPattern =
  /\b(scallion|aubergine|courgette|garbanzo bean|coriander leaf|chilli)\b/g;

/** Identity is for pantry membership; the first cook-supplied label remains display text. */
export function normalizePantryIngredient(value: string) {
  const label = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  const identity = label.toLowerCase().replace(
    /[a-z]+/g,
    (word) => singulars.get(word) ?? word,
  )
    .replace(aliasPattern, (alias) => aliases.get(alias) ?? alias);
  return { identity, label };
}

export function uniquePantryIngredients(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const { identity, label } = normalizePantryIngredient(value);
    if (!identity || seen.has(identity)) return [];
    seen.add(identity);
    return [label];
  });
}
