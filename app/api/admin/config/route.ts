import { adminOrError } from '@/app/admin/_lib/guard';
import { readConfig, updateConfig, validatePatch } from '@/app/admin/_lib/config';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/config -> EconomyConfig
 */
export async function GET() {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  try {
    const config = await readConfig();
    return jsonOk(config);
  } catch (err: any) {
    return jsonErr(500, err?.message || 'Failed to read config');
  }
}

/**
 * PATCH /api/admin/config   { ...patch } -> EconomyConfig
 */
export async function PATCH(req: Request) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const body = await readJson(req);
  const val = validatePatch(body);
  if (!val.ok) {
    return jsonErr(400, val.errors.join(', '));
  }

  try {
    const next = await updateConfig(val.patch);
    return jsonOk(next);
  } catch (err: any) {
    return jsonErr(err.status || 500, err?.message || 'Failed to update config');
  }
}
