import 'server-only';

import { VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from './prompt';
import { ScanResultSchema, VisionError, type ImageMediaType, type ScanResult } from './types';
import { BOX_TIERS, RARITIES } from '@/lib/types';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Gemini vision backend.
 *
 * Uses `responseMimeType: 'application/json'` plus a `responseSchema`, which is
 * Gemini's constrained-decoding path — the model cannot emit anything that is
 * not shaped like `ScanResult`. We still run the JSON through the same zod
 * schema afterwards, so both backends fail identically on a malformed payload
 * rather than one of them quietly returning a half-filled object.
 */
export async function scanWithGemini(
  imageBase64: string,
  mediaType: ImageMediaType,
  model: string = process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL
): Promise<ScanResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new VisionError('GEMINI_API_KEY is not set', 'gemini');

  const { GoogleGenAI, Type } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey });

  const responseSchema = {
    type: Type.OBJECT,
    properties: {
      name: { type: Type.STRING, description: 'Short product name a housemate would recognise.' },
      description: { type: Type.STRING, description: 'One sentence: what it is, plus any visible flaw.' },
      condition: { type: Type.STRING, description: 'Condition in a few words.' },
      est_value: { type: Type.NUMBER, description: 'Realistic used resale price in USD. Always > 0.' },
      box_tier: { type: Type.STRING, enum: [...BOX_TIERS], description: 'tier_1 <= 30, tier_2 <= 120, tier_3 > 120.' },
      rarity: { type: Type.STRING, enum: [...RARITIES], description: 'grey < 25, blue 25-89, purple 90-149, pink >= 150.' },
      scrap_value: { type: Type.NUMBER, description: 'est_value * 10 rounded; 0 for purple/pink/gold.' },
      confidence: { type: Type.NUMBER, description: 'Certainty of identification and price, 0 to 1.' },
    },
    required: ['name', 'description', 'condition', 'est_value', 'box_tier', 'rarity', 'scrap_value', 'confidence'],
    propertyOrdering: ['name', 'description', 'condition', 'est_value', 'box_tier', 'rarity', 'scrap_value', 'confidence'],
  };

  let raw: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: mediaType, data: imageBase64 } },
            { text: VISION_USER_PROMPT },
          ],
        },
      ],
      config: {
        systemInstruction: VISION_SYSTEM_PROMPT,
        temperature: 0.2,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema,
      },
    });
    raw = res.text;
  } catch (err) {
    throw new VisionError('Gemini vision call failed: ' + errText(err), 'gemini');
  }

  if (!raw) throw new VisionError('Gemini returned an empty response', 'gemini');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new VisionError('Gemini returned non-JSON despite responseSchema', 'gemini');
  }

  const result = ScanResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new VisionError('Gemini response did not match the scan schema: ' + result.error.message, 'gemini');
  }
  return result.data;
}

function errText(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
