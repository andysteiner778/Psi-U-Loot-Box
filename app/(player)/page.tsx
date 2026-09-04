import { fetchAllOdds, fetchGameConfig, fetchShardPrizes, fetchWelcomeSpinsLeft } from './_lib/queries';
import { ShardHud } from '@/components/ShardHud';
import { BoxCard } from '@/components/BoxCard';
import { PrizeShowcase } from '@/components/PrizeShowcase';
import { Flame, ShieldCheck, Zap, Coins } from 'lucide-react';
import { getSession } from '@/lib/session';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function PlayerBoxesPage() {
  const session = await getSession();
  const [oddsList, config, shardPrizes, welcomeLeft] = await Promise.all([
    fetchAllOdds(),
    fetchGameConfig(),
    fetchShardPrizes(),
    session ? fetchWelcomeSpinsLeft(session.id) : Promise.resolve(0),
  ]);

  // Read config settings row for flash sale state
  const { data: configRow } = await db
    .from('config')
    .select('value')
    .eq('key', 'settings')
    .maybeSingle();

  const cfg = configRow?.value as Record<string, unknown> | undefined;

  // A sale is only live if the flag is set AND the window has not closed.
  // Reading the raw `flash_sale` boolean left the banner and the "20% OFF"
  // badges up for an hour after the countdown ended, while box_odds had
  // correctly reverted prices -- so the app was advertising a discount it was
  // no longer giving.
  const saleEndsAt = typeof cfg?.flash_sale_ends_at === 'string' ? cfg.flash_sale_ends_at : null;
  const isFlashSale =
    Boolean(cfg?.flash_sale) && (!saleEndsAt || new Date(saleEndsAt).getTime() > Date.now());

  const potThreshold = Number(cfg?.pot_revenue_threshold ?? 150);

  // Read pot total
  const { data: potData } = await db
    .from('deposits')
    .select('amount')
    .eq('status', 'approved');

  const potTotal = (potData ?? []).reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const potGateMet = potTotal >= potThreshold;

  return (
    <div className="space-y-6">
      {/* Flash Sale Banner if Active */}
      {isFlashSale && (
        <div className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-red-950 via-red-900 to-amber-950 border border-red-500/50 p-4 shadow-xl text-white">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/20 text-red-400 animate-pulse">
              <Flame className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-wide">FLASH SALE ACTIVE!</h2>
              <p className="text-xs text-red-200">
                All mystery box prices slashed by 20% for the next 15 minutes.
              </p>
            </div>
          </div>
          <span className="rounded-xl bg-red-500 px-3 py-1 font-mono text-xs font-bold text-black uppercase">
            Limited Time
          </span>
        </div>
      )}

      {/* Persistent Shard HUD Tracker */}
      <ShardHud
        potTotal={potTotal}
        potThreshold={potThreshold}
        potGateMet={potGateMet}
      />

      {welcomeLeft > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-lg">
            🎁
          </span>
          <div>
            <p className="text-sm font-bold text-emerald-300">
              Your next {welcomeLeft} {welcomeLeft === 1 ? 'spin is' : 'spins are'} guaranteed a real prize
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-emerald-200/70">
              No coins, no empty pulls — on the $1 and $5 boxes you will get
              something you can take home. Better than the odds below say.
            </p>
          </div>
        </div>
      )}

      {/* The good stuff, drifting past, before anyone has to tap anything. */}
      <PrizeShowcase oddsList={oddsList} shardPrizes={shardPrizes} />

      {/* Box Cards Section */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-black tracking-tight text-white">CASE OPENINGS</h2>
            <p className="text-xs font-mono text-gun-400">
              Pick your tier. Odds dynamically rebalance as physical items are won.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {oddsList.map((odds) => (
            <BoxCard
              key={odds.tier}
              odds={odds}
              isFlashSale={isFlashSale}
              allowHighRarityScrap={config.allow_high_rarity_scrap}
              compactCoins={config.scrap_coins_per_key}
              compactUsd={config.scrap_key_usd}
              listPrice={config.box_list_prices?.[odds.tier]}
            />
          ))}
        </div>
      </div>

      {/* Anti-Exploit Guardrails Reminder */}
      <div className="rounded-2xl border border-gun-800 bg-gun-900/60 p-4 text-xs text-gun-400 font-mono flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            {config.allow_high_rarity_scrap
              ? 'Legendary, Mythic and Exotic items are picked up from Andy in Japan — or scrapped for 40% of their value if you would rather have the credit.'
              : 'Legendary (purple), Mythic (pink) and Exotic (gold) items are physical pickup only — they cannot be scrapped.'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-gun-300">
          <span className="flex items-center gap-1">
            <Zap className="h-3.5 w-3.5 text-yellow-400" /> Soulbound Shards
          </span>
          <span className="flex items-center gap-1">
            <Coins className="h-3.5 w-3.5 text-cyan-400" /> Closed Loop
          </span>
        </div>
      </div>
    </div>
  );
}
