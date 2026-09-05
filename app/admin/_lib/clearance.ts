import 'server-only';

import { z } from 'zod';
import { db } from '@/lib/supabase/server';

export interface ClearanceConfig {
  enabled: boolean;
  spin_discount_rate: number; // e.g. 0.75 (75% of average est_value)
  allow_venmo_reserve: boolean;
}

export const DEFAULT_CLEARANCE_CONFIG: ClearanceConfig = {
  enabled: false,
  spin_discount_rate: 0.75,
  allow_venmo_reserve: true,
};

export const ClearancePatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    spin_discount_rate: z.number().min(0.1).max(1.0).optional(),
    allow_venmo_reserve: z.boolean().optional(),
  })
  .strict();

export type ClearancePatch = z.infer<typeof ClearancePatchSchema>;

export async function readClearanceConfig(): Promise<ClearanceConfig> {
  const { data, error } = await db
    .from('config')
    .select('value')
    .eq('key', 'clearance')
    .maybeSingle();

  if (error || !data?.value) {
    return DEFAULT_CLEARANCE_CONFIG;
  }

  const raw = data.value as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  return {
    enabled: raw.enabled === true,
    spin_discount_rate: num(raw.spin_discount_rate, DEFAULT_CLEARANCE_CONFIG.spin_discount_rate),
    allow_venmo_reserve: raw.allow_venmo_reserve !== false,
  };
}

export async function updateClearanceConfig(patch: ClearancePatch): Promise<ClearanceConfig> {
  const current = await readClearanceConfig();
  const next: ClearanceConfig = {
    ...current,
    ...patch,
  };

  const { error } = await db.from('config').upsert({
    key: 'clearance',
    value: next,
  });

  if (error) {
    throw new Error('Failed to update clearance config: ' + error.message);
  }

  return next;
}
