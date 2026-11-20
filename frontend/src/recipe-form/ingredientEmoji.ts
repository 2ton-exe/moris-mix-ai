const ingredientAliases: Record<string, string> = {
  avocados: 'avocado', bananas: 'banana', pancetta: 'bacon', steak: 'beef',
  'black beans': 'beans', 'fresh basil': 'basil', 'unsalted butter': 'butter', 'salted butter': 'butter',
  'ground beef': 'beef', 'minced beef': 'beef', 'bell peppers': 'bell pepper', capsicum: 'bell pepper',
  'red bell pepper': 'bell pepper', 'red bell peppers': 'bell pepper',
  'green bell pepper': 'bell pepper', 'green bell peppers': 'bell pepper',
  'yellow bell pepper': 'bell pepper', 'yellow bell peppers': 'bell pepper',
  chickpeas: 'chickpea', 'kidney beans': 'beans', lentils: 'lentil',
  blueberries: 'blueberry', breadcrumbs: 'bread', 'bread crumbs': 'bread', 'broccoli florets': 'broccoli',
  'bok choy': 'cabbage', kale: 'cabbage', lettuce: 'cabbage', spinach: 'cabbage', carrots: 'carrot',
  cheddar: 'cheese', feta: 'cheese', mozzarella: 'cheese', parmesan: 'cheese',
  'cherry tomatoes': 'cherry tomato', 'chicken breast': 'chicken', 'chicken breasts': 'chicken', 'cinnamon': 'spice', 'cocoa': 'chocolate',
  'chicken thigh': 'chicken', 'chicken thighs': 'chicken', turkey: 'chicken',
  chilies: 'chili', chilli: 'chili', chillies: 'chili', 'chili peppers': 'chili',
  'chilli pepper': 'chili', 'chilli peppers': 'chili', cumin: 'spice', paprika: 'spice',
  'black pepper': 'spice', 'white pepper': 'spice', cilantro: 'herb', coriander: 'herb',
  'bay leaf': 'herb', 'bay leaves': 'herb',
  'fresh coriander': 'herb', parsley: 'herb', mint: 'herb', rosemary: 'herb', thyme: 'herb',
  oregano: 'herb', dill: 'herb', 'cocoa powder': 'chocolate', chocolate: 'chocolate',
  'chocolate chips': 'chocolate', 'coconut milk': 'coconut', 'sweet corn': 'corn', 'corn kernels': 'corn',
  'heavy cream': 'cream', milk: 'cream', 'whole milk': 'cream', yogurt: 'cream', yoghurt: 'cream', cucumbers: 'cucumber',
  eggs: 'egg', 'large egg': 'egg', 'large eggs': 'egg', eggplants: 'eggplant', aubergine: 'eggplant',
  aubergines: 'eggplant', 'all-purpose flour': 'flour', 'all purpose flour': 'flour',
  'self-rising flour': 'flour', 'self rising flour': 'flour', 'garlic clove': 'garlic',
  'garlic cloves': 'garlic', 'minced garlic': 'garlic', 'garlic powder': 'garlic', grapes: 'grape',
  'green onion': 'onion', 'green onions': 'onion', 'spring onion': 'onion', 'spring onions': 'onion',
  'red onion': 'onion', 'red onions': 'onion', 'yellow onion': 'onion', 'yellow onions': 'onion',
  peas: 'pea', ham: 'bacon', jalapeno: 'chili', 'jalapeño': 'chili', lemons: 'lemon', mangoes: 'mango',
  mushrooms: 'mushroom', 'button mushrooms': 'mushroom', olives: 'olive', 'olive oil': 'olive',
  'extra virgin olive oil': 'olive', 'extra-virgin olive oil': 'olive', onions: 'onion', oranges: 'orange',
  spaghetti: 'pasta', noodles: 'pasta', peaches: 'peach', pears: 'pear', pineapples: 'pineapple',
  pork: 'meat', sausage: 'meat', sausages: 'meat', potatoes: 'potato', 'sweet potato': 'potato',
  'sweet potatoes': 'potato', 'red pepper flakes': 'chili', 'chili flakes': 'chili',
  'brown rice': 'rice', 'white rice': 'rice', 'jasmine rice': 'rice', 'basmati rice': 'rice',
  'sea salt': 'salt', 'kosher salt': 'salt', salmon: 'fish', tuna: 'fish', cod: 'fish',
  shrimps: 'shrimp', prawn: 'shrimp', prawns: 'shrimp', oysters: 'oyster', strawberries: 'strawberry',
  'brown sugar': 'sugar', 'white sugar': 'sugar', 'superfine sugar': 'sugar', tomatoes: 'tomato',
  'tomato paste': 'tomato', 'tomato puree': 'tomato', 'tomato purée': 'tomato', 'tomato sauce': 'tomato',
  'crushed tomatoes': 'tomato', 'diced tomatoes': 'tomato', 'vanilla extract': 'vanilla', apples: 'apple',
  'green apples': 'green apple',
}

const emojiByIngredient: Record<string, string> = {
  avocado: '🥑', bacon: '🥓', banana: '🍌', basil: '🌿', beef: '🥩', 'bell pepper': '🫑',
  beans: '🫘', blueberry: '🫐', bread: '🍞', broccoli: '🥦', butter: '🧈', cabbage: '🥬',
  carrot: '🥕', cheese: '🧀', 'cherry tomato': '🍅', chicken: '🍗', chili: '🌶️', spice: '🧂',
  herb: '🌿', chocolate: '🍫', coconut: '🥥', corn: '🌽', cream: '🥛', cucumber: '🥒', egg: '🥚',
  eggplant: '🍆', flour: '🌾', garlic: '🧄', grape: '🍇', honey: '🍯', lemon: '🍋', mango: '🥭',
  mushroom: '🍄', olive: '🫒', onion: '🧅', orange: '🍊', pasta: '🍝', pea: '🫛', peach: '🍑',
  pear: '🍐', pineapple: '🍍', meat: '🥩', potato: '🥔', rice: '🍚', salt: '🧂', fish: '🐟',
  shrimp: '🦐', crab: '🦀', lobster: '🦞', oyster: '🦪', strawberry: '🍓', sugar: '🍬',
  tomato: '🍅', vanilla: '🍨', watermelon: '🍉', apple: '🍎', 'green apple': '🍏',
}

export const genericIngredientEmoji = '🍽️'

export function ingredientEmojiFor(name: string) {
  const phrase = name.trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ')
  return emojiByIngredient[ingredientAliases[phrase] ?? phrase] ?? genericIngredientEmoji
}
