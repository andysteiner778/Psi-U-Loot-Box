import { adminOrError } from '@/app/admin/_lib/guard';
import {
  ClearancePatchSchema,
  readClearanceConfig,
  updateClearanceConfig,
} from '@/app/admin/_lib/clearance';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import { db } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/clearance -> { config, unitsRemaining, totalEstValue }
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  try {
    const config = await readClearanceConfig();

    const { data: items, error } = await db
      .from('items')
      .select('est_value, stock_qty, reward_credit, reward_voucher_tier')
      .gt('stock_qty', 0)
      .eq('is_active', true);

    if (error) throw error;

    const physical = (items ?? []).filter(
      (i) => i.reward_credit === null && i.reward_voucher_tier === null
    );

    const unitsRemaining = physical.reduce((sum, i) => sum + (Number(i.stock_qty) || 0), 0);
    const totalEstValue = physical.reduce(
      (sum, i) => sum + (Number(i.est_value) || 0) * (Number(i.stock_qty) || 0),
      0
    );

    return jsonOk({ config, unitsRemaining, totalEstValue });
  } catch (err: any) {
    return jsonErr(500, err?.message || 'Failed to read clearance status');
  }
}

/**
 * PATCH /api/admin/clearance   { enabled, spin_discount_rate, allow_venmo_reserve }
 */
export async function PATCH(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson(req);
  const parsed = ClearancePatchSchema.safeParse(body);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => (i.path.join('.') || 'value') + ': ' + i.message);
    return jsonErr(400, errors.join(', '));
  }

  try {
    const next = await updateClearanceConfig(parsed.data);
    return jsonOk({ ok: true, config: next });
  } catch (err: any) {
    return jsonErr(500, err?.message || 'Failed to update clearance config');
  }
}
