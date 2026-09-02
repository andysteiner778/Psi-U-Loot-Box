'use client';
import { createClient } from '@supabase/supabase-js';

/**
 * Anon client. Deliberately near-powerless: every table is deny-all to this
 * key and every RPC has EXECUTE revoked from it, so leaking it costs nothing.
 *
 * Its only job is subscribing to the public `house_ticker` broadcast topic.
 * The ticker payload is composed by a database trigger, so no table is
 * readable from the browser at all.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, anonKey, {
  auth: { persistSession: false },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const TICKER_TOPIC = 'house_ticker';
