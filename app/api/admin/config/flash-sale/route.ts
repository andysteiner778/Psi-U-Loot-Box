import { adminOrError } from '@/app/admin/_lib/guard';
import { updateConfig } from '@/app/admin/_lib/config';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/config/flash-sale   { active: boolean, durationMinutes?: number }
 */
export async function POST(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson<{ active?: boolean; durationMinutes?: number }>(req);
  const active = body?.active ?? true;
  const duration = body?.durationMinutes ?? 15;

  try {
    let endsAt: string | null = null;
    if (active) {
      const d = new Date();
      d.setMinutes(d.getMinutes() + duration);
      endsAt = d.toISOString();
    }

    const next = await updateConfig({
      flash_sale: active,
      flash_sale_ends_at: endsAt,
      flash_sale_pct: 0.2,
    });

    return jsonOk(next);
  } catch (err: any) {
    return jsonErr(500, err?.message || 'Failed to update flash sale');
  }
}
