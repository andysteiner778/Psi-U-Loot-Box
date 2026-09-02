import 'server-only';

import { z } from 'zod';
import { DEFAULT_CONFIG } from '@/lib/economy';
import { db } from '@/lib/supabase/server';
import { BOX_TIERS, type BoxTier, type EconomyConfig } from '@/lib/types';

/**
 * The `config.settings` JSONB row: every economy knob, hot-editable mid-party.
 *
 * Two things matter here beyond CRUD:
 *
 *  1. VALIDATION BEFORE WRITE. This is a live economy with real Venmo money in
 *     it. A negative `house_margin` or a `shard_probs` above 1 does not throw —
 *     it quietly makes the house insolvent for every roll until someone
 *     notices. The ranges below are the guardrails; the odds preview is the
 *     second line of defence.
 *
 *  2. `pc_shards_minted` is written by `open_box` concurrently. A naive
 *     read-modify-write of the whole JSONB row would silently roll back a mint
 *     that landed between our read and our write — i.e. print a PC. Every save
 *     therefore goes through a compare-and-set on that field.
 */

const tierNumbers = (schema: z.ZodNumber) =>
  z.object({ tier_1: schema, tier_2: schema, tier_3: schema });

/**
 * The knobs an admin may set directly.
 *
 * `flash_sale` and `flash_sale_ends_at` are deliberately absent: a sale window
 * is a server-clock decision, set only through /api/admin/config/flash-sale.
 * Letting a browser post its own `ends_at` is letting a browser decide when
 * prices go back up.
 */
export const ConfigPatchSchema = z
  .strictObject({
    house_margin: z.number().min(0).max(0.9),
    pot_revenue_threshold: z.number().min(0).max(1_000_000),
    box_prices: tierNumbers(z.number().gt(0).max(10_000)),
    shard_probs: tierNumbers(z.number().min(0).max(1)),
    pc_value: z.number().gt(0).max(100_000),
    shards_required: z.number().int().min(1).max(50),
    pc_total_supply: z.number().int().min(0).max(100),
    pc_shards_minted: z.number().int().min(0).max(100_000),
    max_item_prob: z.number().gt(0).max(1),
    ev_weight_factor: z.number().min(0).max(1),
    scrap_ev_frac: z.number().min(0).max(0.5),
    filler_max_value: z.number().min(0).max(1000),
    scrap_coins_per_key: z.number().int().min(1).max(100_000),
    scrap_key_tier: z.enum(BOX_TIERS),
    flash_sale_pct: z.number().min(0).max(0.9),
  })
  .partial();

export type ConfigPatch = z.infer<typeof ConfigPatchSchema>;

export interface PatchValidation {
  ok: boolean;
  errors: string[];
  patch: ConfigPatch;
}

/** Range-check a patch and return readable messages instead of a zod dump. */
export function validatePatch(input: unknown): PatchValidation {
  const parsed = ConfigPatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      patch: {},
      errors: parsed.error.issues.map((i) => (i.path.join('.') || 'value') + ': ' + i.message),
    };
  }
  if (Object.keys(parsed.data).length === 0) {
    return { ok: false, patch: {}, errors: ['Nothing to change'] };
  }
  return { ok: true, patch: parsed.data, errors: [] };
}

/** Coerce a raw JSONB row into a complete config, filling gaps from defaults. */
export function coerceConfig(raw: unknown): EconomyConfig {
  const r = (raw ?? {}) as Partial<Record<keyof EconomyConfig, unknown>>;
  const n = (v: unknown, d: number) => {
    const x = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(x) ? x : d;
  };
  const tiers = (v: unknown, d: Record<BoxTier, number>): Record<BoxTier, number> => {
    const o = (v ?? {}) as Record<string, unknown>;
    return { tier_1: n(o.tier_1, d.tier_1), tier_2: n(o.tier_2, d.tier_2), tier_3: n(o.tier_3, d.tier_3) };
  };
  const ends = r.flash_sale_ends_at;

  return {
    house_margin: n(r.house_margin, DEFAULT_CONFIG.house_margin),
    pot_revenue_threshold: n(r.pot_revenue_threshold, DEFAULT_CONFIG.pot_revenue_threshold),
    box_prices: tiers(r.box_prices, DEFAULT_CONFIG.box_prices),
    shard_probs: tiers(r.shard_probs, DEFAULT_CONFIG.shard_probs),
    pc_value: n(r.pc_value, DEFAULT_CONFIG.pc_value),
    shards_required: n(r.shards_required, DEFAULT_CONFIG.shards_required),
    pc_total_supply: n(r.pc_total_supply, DEFAULT_CONFIG.pc_total_supply),
    pc_shards_minted: n(r.pc_shards_minted, DEFAULT_CONFIG.pc_shards_minted),
    max_item_prob: n(r.max_item_prob, DEFAULT_CONFIG.max_item_prob),
    ev_weight_factor: n(r.ev_weight_factor, DEFAULT_CONFIG.ev_weight_factor),
    scrap_ev_frac: n(r.scrap_ev_frac, DEFAULT_CONFIG.scrap_ev_frac),
    filler_max_value: n(r.filler_max_value, DEFAULT_CONFIG.filler_max_value),
    scrap_coins_per_key: n(r.scrap_coins_per_key, DEFAULT_CONFIG.scrap_coins_per_key),
    scrap_key_tier: (BOX_TIERS as readonly string[]).includes(String(r.scrap_key_tier))
      ? (r.scrap_key_tier as BoxTier)
      : DEFAULT_CONFIG.scrap_key_tier,
    flash_sale: r.flash_sale === true,
    flash_sale_pct: n(r.flash_sale_pct, DEFAULT_CONFIG.flash_sale_pct),
    flash_sale_ends_at: typeof ends === 'string' && ends.trim() ? ends : null,
  };
}

export async function readConfig(): Promise<EconomyConfig> {
  return coerceConfig(await readRawConfig());
}

/**
 * The settings row EXACTLY as stored, including keys `coerceConfig` does not
 * model.
 *
 * This matters more than it looks. `updateConfig` used to write back the
 * COERCED object, which is rebuilt from a fixed list of fields — so every key
 * the coercer did not know about was silently destroyed the first time an admin
 * saved anything in House Controls. That quietly wiped `pc_shard_mint_cap`,
 * `pc_display_value`, `scrap_recovery_frac` and `allow_high_rarity_scrap`, and
 * the symptom (shards stopped dropping entirely) surfaced much later and looked
 * like a completely different bug.
 *
 * Anything written back must be layered ON TOP of this, never instead of it.
 */
export async function readRawConfig(): Promise<Record<string, unknown>> {
  const { data, error } = await db.from('config').select('value').eq('key', 'settings').maybeSingle();
  if (error) throw new Error('Could not read config: ' + error.message);
  if (!data) throw new Error('Missing config row — has migration 0001 been applied?');
  return (data.value ?? {}) as Record<string, unknown>;
}

/** Merge a patch into the live config. Tier maps merge per-tier, not wholesale. */
export function mergeConfig(current: EconomyConfig, patch: Partial<EconomyConfig>): EconomyConfig {
  return {
    ...current,
    ...patch,
    box_prices: { ...current.box_prices, ...(patch.box_prices ?? {}) },
    shard_probs: { ...current.shard_probs, ...(patch.shard_probs ?? {}) },
  };
}

export class ConfigConflictError extends Error {
  readonly status = 409;
  constructor(message = 'Config changed while you were editing — reload and try again') {
    super(message);
    this.name = 'ConfigConflictError';
  }
}

/**
 * Apply a patch with a compare-and-set on `pc_shards_minted`.
 *
 * If the CAS matches nothing we re-read: when the mint counter really did move
 * we retry against the new value; when it did not, the filter itself is the
 * problem (an older PostgREST, say) and we fall through to a plain update that
 * still carries the freshly-read counter. Either way a concurrent mint is never
 * rolled back.
 */
export async function updateConfig(patch: Partial<EconomyConfig>): Promise<EconomyConfig> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await readRawConfig();
    const current = coerceConfig(raw);
    // Layer the merged known fields over the RAW row so unmodelled keys survive.
    const next = { ...raw, ...mergeConfig(current, patch) };

    const cas = await db
      .from('config')
      .update({ value: next })
      .eq('key', 'settings')
      .eq('value->>pc_shards_minted', String(current.pc_shards_minted))
      .select('value');

    if (!cas.error && cas.data && cas.data.length > 0) return coerceConfig(cas.data[0].value);

    const after = await readConfig();
    if (after.pc_shards_minted !== current.pc_shards_minted) continue; // real race — retry

    // The counter did not move, so the CAS filter is not doing what we expect.
    // `next` already carries the value we just read, so a plain update is safe.
    const plain = await db.from('config').update({ value: next }).eq('key', 'settings').select('value');
    if (plain.error) throw new Error('Could not save config: ' + plain.error.message);
    if (plain.data && plain.data.length > 0) return coerceConfig(plain.data[0].value);
    throw new Error('Config row disappeared during save');
  }
  throw new ConfigConflictError();
}

/** True while a sale is live on the SERVER clock. Never ask the browser. */
export function flashSaleActive(cfg: EconomyConfig, now = new Date()): boolean {
  if (!cfg.flash_sale) return false;
  if (!cfg.flash_sale_ends_at) return true;
  return new Date(cfg.flash_sale_ends_at) > now;
}
