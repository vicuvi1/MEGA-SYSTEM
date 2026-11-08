// The food counter's prompt (the one place it lives). The app has no image AI:
// you copy this, paste it with a meal photo into any free AI app (ChatGPT,
// Gemini, Claude…), then paste the reply back. core/foodParse.ts reads the
// reply with plain code. Keep it short, plain English and model-agnostic.

/** The fields every item in the reply has (the parser reads these names first). */
export const FOOD_FIELDS = ['name', 'grams', 'protein_g', 'carbs_g', 'fat_g', 'kcal', 'confidence'] as const

export const FOOD_PROMPT = `Look at the meal in my photo and estimate what is on the plate.

Rules:
- List each food separately (for example rice, chicken and sauce are 3 items).
- Estimate portions from the plate, the cutlery or a hand in the photo.
- Give cooked weights in grams.
- confidence is "sure", "roughly" or "guess".
- If something important is unclear (for example oil or a hidden sauce), ask ONE short question in "question". Otherwise leave it out.

Reply ONLY with this block, no other text:

\`\`\`json
{"items":[{"name":"chicken breast","grams":150,"protein_g":46,"carbs_g":0,"fat_g":5,"kcal":230,"confidence":"roughly"}],"question":"Was it cooked in oil?"}
\`\`\``

/**
 * For packaged food: send a photo of the nutrition label and say how much you ate.
 * Same reply format as FOOD_PROMPT, so the same parser and draft are used.
 */
export const LABEL_PROMPT = `Read the nutrition label in my photo (the table of values per 100 g).

My portion: ____ g (fill this in before you send; if I leave it empty, use the serving size on the label).

Rules:
- Take the values per 100 g from the label, then work out the numbers for MY portion in grams.
- Reply with ONE item: the product name, grams = my portion, and the protein, carbs, fat and kcal for that portion (not per 100 g).
- If the label has only per-serving values, use the serving size to get per 100 g first.
- confidence is "sure" when the label is clear, otherwise "roughly".
- If the portion or a value is unclear, ask ONE short question in "question". Otherwise leave it out.

Reply ONLY with this block, no other text:

\`\`\`json
{"items":[{"name":"protein bar","grams":60,"protein_g":20,"carbs_g":22,"fat_g":8,"kcal":232,"confidence":"sure"}],"question":"How much did you eat?"}
\`\`\``
