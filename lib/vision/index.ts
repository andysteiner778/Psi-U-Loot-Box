import 'server-only';

import { rarityForValue, tierForValue } from '@/lib/economy';
import { isScrappable } from '@/lib/types';
import {
  NoVisionProviderError,
  VisionInputError,
  isSupportedMediaType,
  type ImageMediaType,
  type ScanResult,
  type VisionProviderName,
} from './types';

export {
  NoVisionProviderError,
  ScanResultSchema,
  VisionError,
  VisionInputError,
  isSupportedMediaType,
  SUPPORTED_MEDIA_TYPES,
} from './types';
export type { ImageMediaType, ScanResult, VisionProviderName } from './types';

/** Base64 payload cap. The client downscales to ~1024px, which lands well under this. */
export const MAX_IMAGE_BASE64_CHARS = 6_000_000; // ~4.5 MB of image bytes

export interface VisionBackend {
  provider: VisionProviderName;
  model: string;
}

export interface VisionStatus {
  available: boolean;
  provider: VisionProviderName | null;
  model: string | null;
  /** Every provider that has a key, in the order we would try them. */
  candidates: VisionBackend[];
  reason: string | null;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

function claudeBackend(): VisionBackend | null {
  return env('ANTHROPIC_API_KEY')
    ? { provider: 'claude', model: env('VISION_MODEL') ?? 'claude-opus-5' }
    : null;
}

function geminiBackend(): VisionBackend | null {
  return env('GEMINI_API_KEY')
    ? { provider: 'gemini', model: env('GEMINI_MODEL') ?? 'gemini-2.5-flash' }
    : null;
}

/**
 * Pick a backend from VISION_PROVIDER, falling back to whichever key exists.
 *
 * An explicit `VISION_PROVIDER=claude` with no Anthropic key still falls back
 * to Gemini rather than failing: at 1am on moving-out night, a scanner that
 * works beats a scanner that is technically correct about its configuration.
 */
export function resolveVisionProvider(): VisionBackend | null {
  const pref = process.env.VISION_PROVIDER?.trim().toLowerCase();
  const claude = claudeBackend();
  const gemini = geminiBackend();

  const order: (VisionBackend | null)[] =
    pref === 'gemini' ? [gemini, claude] : [claude, gemini]; // 'claude' and 'auto' both prefer Claude

  return order.find((b): b is VisionBackend => b !== null) ?? null;
}

export function visionStatus(): VisionStatus {
  const pref = process.env.VISION_PROVIDER?.trim().toLowerCase();
  const claude = claudeBackend();
  const gemini = geminiBackend();
  const candidates = (pref === 'gemini' ? [gemini, claude] : [claude, gemini]).filter(
    (b): b is VisionBackend => b !== null
  );
  const chosen = candidates[0] ?? null;

  return {
    available: chosen !== null,
    provider: chosen?.provider ?? null,
    model: chosen?.model ?? null,
    candidates,
    reason: chosen
      ? null
      : 'Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set. Add one to .env.local and restart, or enter items by hand.',
  };
}

/**
 * Re-derive everything the house has a rule for.
 *
 * The model proposes a PRICE. Rarity, tier and scrap value are consequences of
 * that price, and they are computed here with the same functions the seed
 * catalog and the odds engine use. Trusting the model's own arithmetic would
 * eventually produce a pink item carrying a scrap value, which the database
 * rejects outright (`high_tier_never_scrappable`) — a 500 at the worst moment
 * instead of a correct row.
 */
export function normalizeScan(raw: ScanResult): ScanResult {
  const est = Math.round(Math.max(0.01, Number(raw.est_value) || 0) * 100) / 100;
  const rarity = rarityForValue(est);
  const box_tier = tierForValue(est);
  const scrap_value = isScrappable(rarity) ? Math.max(0, Math.round(est * 10)) : 0;

  const confRaw = Number(raw.confidence);
  const confidence = Number.isFinite(confRaw) ? Math.min(1, Math.max(0, confRaw)) : 0.5;

  return {
    name: clip(raw.name, 120) || 'Unidentified item',
    description: clip(raw.description, 400),
    condition: clip(raw.condition, 120),
    est_value: est,
    box_tier,
    rarity,
    scrap_value,
    confidence,
  };
}

function clip(s: unknown, max: number): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Scan one photo and return house-normalised item fields.
 *
 * Throws `NoVisionProviderError` when no key is configured — the caller is
 * expected to catch that and fall back to manual entry.
 */
export async function scanItem(imageBase64: string, mediaType: string): Promise<ScanResult> {
  if (!isSupportedMediaType(mediaType)) {
    throw new VisionInputError('Unsupported image type: ' + String(mediaType));
  }

  const data = stripDataUrl(imageBase64);
  if (!data) throw new VisionInputError('Empty image payload');
  if (data.length > MAX_IMAGE_BASE64_CHARS) {
    throw new VisionInputError('Image too large — downscale before uploading');
  }

  const backend = resolveVisionProvider();
  if (!backend) throw new NoVisionProviderError();

  const raw: ScanResult =
    backend.provider === 'claude'
      ? await (await import('./claude')).scanWithClaude(data, mediaType, backend.model)
      : await (await import('./gemini')).scanWithGemini(data, mediaType, backend.model);

  return normalizeScan(raw);
}

/** Accepts either a bare base64 string or a full `data:image/jpeg;base64,...` URL. */
export function stripDataUrl(input: string): string {
  const s = String(input ?? '').trim();
  const comma = s.startsWith('data:') ? s.indexOf(',') : -1;
  return (comma >= 0 ? s.slice(comma + 1) : s).replace(/\s/g, '');
}

/** The adapter's public signature, so a caller can be typed against it. */
export type ScanItemFn = (imageBase64: string, mediaType: ImageMediaType) => Promise<ScanResult>;
