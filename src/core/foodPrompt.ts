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
