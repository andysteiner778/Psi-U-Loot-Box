import 'server-only';

import { adminOrError } from '@/app/admin/_lib/guard';
import { db } from '@/lib/supabase/server';
import { jsonErr, jsonOk, readJson } from '@/app/admin/_lib/http';
import type { Profile } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchPlayerBody {
  name?: string;
  role?: 'player' | 'admin';
  reset_pin?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/admin/players/[id]
 *
 * Allows an admin to:
 *   1. Rename a player (e.g. from seeded 'Andy' to real housemate name).
 *   2. Reset a forgotten PIN to '1234' with must_change = true.
 *   3. Promote/demote admin role.
 */
export async function PATCH(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  const gate = await adminOrError();
  if (gate instanceof Response) return gate;

  const { id } = await props.params;
  if (!UUID_RE.test(id)) {
    return jsonErr(400, 'Invalid player ID format');
  }

  const body = await readJson<PatchPlayerBody>(req);
  if (!body) {
    return jsonErr(400, 'Invalid JSON body');
  }

  // 1. Handle PIN Reset if requested
  if (body.reset_pin) {
    const { error: pinErr } = await db.rpc('auth_set_pin', {
      p_profile_id: id,
      p_pin: '1234',
    });

    if (pinErr) {
      return jsonErr(400, `Failed to reset PIN: ${pinErr.message}`);
    }

    // Force must_change = TRUE so player must pick their own PIN on next login
    // and clear lockout attempts.
    await db
      .schema('app_private')
      .from('profile_secrets')
      .update({
        must_change: true,
        failed_attempts: 0,
        locked_until: null,
      })
      .eq('profile_id', id);
  }

  // 2. Handle Profile updates (Name and/or Role)
  const updates: Partial<{ name: string; role: 'player' | 'admin' }> = {};

  if (body.name !== undefined) {
    const trimmed = String(body.name).trim();
    if (trimmed.length === 0 || trimmed.length > 50) {
      return jsonErr(400, 'Player name must be between 1 and 50 characters');
    }

    // Check name collision
    const { data: existing } = await db
      .from('profiles')
      .select('id')
      .eq('name', trimmed)
      .neq('id', id)
      .maybeSingle();

    if (existing) {
      return jsonErr(409, `A player named "${trimmed}" already exists`);
    }

    updates.name = trimmed;
  }

  if (body.role !== undefined) {
    if (body.role !== 'player' && body.role !== 'admin') {
      return jsonErr(400, 'Role must be "player" or "admin"');
    }
    updates.role = body.role;
  }

  if (Object.keys(updates).length > 0) {
    const { data: updated, error: updateErr } = await db
      .from('profiles')
      .update(updates)
      .eq('id', id)
      .select('id, name, balance, scrap_coins, pc_shards, role, created_at')
      .single();

    if (updateErr) {
      return jsonErr(400, updateErr.message);
    }

    return jsonOk(updated as Profile);
  }

  // If only PIN was reset without profile field changes, fetch current profile
  const { data: current, error: getErr } = await db
    .from('profiles')
    .select('id, name, balance, scrap_coins, pc_shards, role, created_at')
    .eq('id', id)
    .single();

  if (getErr) {
    return jsonErr(404, 'Player not found');
  }

  return jsonOk(current as Profile);
}
