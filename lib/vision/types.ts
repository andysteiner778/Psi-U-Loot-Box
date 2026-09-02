/**
 * Vision adapter — shared types.
 *
 * Deliberately free of `server-only`: client components need `ScanResult` as a
 * TYPE. They must never import the backends or `scanItem` itself, which do
 * carry `server-only` and hold the API keys.
 */

import { z } from 'zod';
import { BOX_TIERS, RARITIES } from '@/lib/types';

/**
 * The schema the model is held to.
 *
 * No `.min()` / `.max()` / `.int()` refinements: several structured-output
 * backends reject unsupported JSON-Schema keywords outright, and range
 * enforcement belongs to us anyway — see `normalizeScan()`, which recomputes
 * every derived field from the house's own rules rather than trusting the
 * model's arithmetic.
 */
export const ScanResultSchema = z.object({
  name: z
    .string()
    .describe('Short product name a housemate would recognise, e.g. "Audioengine A5+ Speakers". No marketing copy.'),
  description: z
    .string()
    .describe('One sentence: what it is, plus any visible flaw or missing accessory.'),
  condition: z
    .string()
    .describe('Condition in a few words, e.g. "good, light scuffs on the corner".'),
  est_value: z
    .number()
    .describe('Realistic USED resale price in USD as a plain number, e.g. 45.5. Never 0 and never a range.'),
  box_tier: z
    .enum(BOX_TIERS)
    .describe('tier_1 if est_value <= 30, tier_2 if <= 120, tier_3 if > 120.'),
  rarity: z
    .enum(RARITIES)
    .describe('CS:GO rarity band by est_value: grey < 25, blue 25-89, purple 90-149, pink >= 150.'),
  scrap_value: z
    .number()
    .describe('Scrap coins: est_value * 10, rounded. Exactly 0 when rarity is purple, pink or gold.'),
  confidence: z
    .number()
    .describe('How sure you are of the identification and price, 0 to 1.'),
});

export type ScanResult = z.infer<typeof ScanResultSchema>;

/** The image formats every supported backend accepts. */
export const SUPPORTED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export type ImageMediaType = (typeof SUPPORTED_MEDIA_TYPES)[number];

export function isSupportedMediaType(v: unknown): v is ImageMediaType {
  return typeof v === 'string' && (SUPPORTED_MEDIA_TYPES as readonly string[]).includes(v);
}

export type VisionProviderName = 'claude' | 'gemini';

/**
 * Neither key is configured. The scanner is a luxury: the caller catches this
 * and shows the manual "Create Item" form instead of failing the page.
 */
export class NoVisionProviderError extends Error {
  readonly code = 'NO_VISION_PROVIDER';
  readonly status = 501;
  constructor(message = 'No vision provider configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY.') {
    super(message);
    this.name = 'NoVisionProviderError';
  }
}

/** The provider was reachable but the call or the parse failed. */
export class VisionError extends Error {
  readonly code = 'VISION_FAILED';
  readonly status = 502;
  constructor(
    message: string,
    readonly provider?: VisionProviderName
  ) {
    super(message);
    this.name = 'VisionError';
  }
}

/** Rejected before we spend a single token. */
export class VisionInputError extends Error {
  readonly code = 'VISION_BAD_INPUT';
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'VisionInputError';
  }
}
