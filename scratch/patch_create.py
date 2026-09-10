import io

p = 'app/api/admin/items/route.ts'
s = io.open(p, encoding='utf-8').read()

start = s.index('  // Scrap recovery, in 10-cent coins (migration 0015).')
end = s.index('  // Adding the same name twice splits one pile into two entries')

NEW = """  /*
   * Scrap value and box tier both come from lib/scrap.ts, the one place either
   * rule is written down.
   *
   * They used to be derived here from est_value: scrap as a percentage of it,
   * tier via tierForValue. The catalogue is now priced off RETAIL — junk is
   * deliberately worth $0.01 so it can be given away, while msrp carries what a
   * player thinks it is worth — so an est_value basis produced items that
   * arrived unscrappable (floor($0.01 / $0.10) = 0 coins) and all piled into the
   * cheapest box. Every item added had to be fixed afterwards by running
   * `npm run rebase-scrap` and `npm run retier`, and nothing said so.
   */
  const cfg = await readConfig();

"""

s = s[:start] + NEW + s[end:]

# tier + rarity: retail decides the box, value still decides the rarity band
OLD_TIER = """  const box_tier: BoxTier = BOX_TIERS.includes(body.box_tier)
    ? body.box_tier
    : tierForValue(est_value);"""
NEW_TIER = """  /*
   * Retail decides the box. An explicit choice from the form still wins — the
   * owner overriding a tier by hand is a deliberate act, not a mistake.
   */
  const box_tier: BoxTier = BOX_TIERS.includes(body.box_tier)
    ? body.box_tier
    : msrp
      ? tierForRetail(msrp)
      : tierForValue(est_value);"""
assert OLD_TIER in s, 'tier assignment not found'
s = s.replace(OLD_TIER, NEW_TIER, 1)

# insert the scrap computation right after box_tier is known
anchor = s.index(NEW_TIER) + len(NEW_TIER)
SCRAP = """

  /*
   * Needs box_tier, because the payout is capped at half the price of the box
   * the item can drop from — the cap is the only thing stopping a $40-retail
   * item in a $0.50 box from being farmed.
   *
   * An explicit scrap_value from the form still wins, clamped to the same cap.
   */
  const autoScrap = scrapValueCoins(
    { est_value, msrp, rarity, box_tier, reward_credit: null, reward_voucher_tier: null },
    cfg
  );
  const scrap_value =
    body.scrap_value === undefined || body.scrap_value === null
      ? autoScrap
      : Math.min(Math.max(0, parseInt(String(body.scrap_value), 10) || 0), Math.max(autoScrap, 0));
"""
s = s[:anchor] + SCRAP + s[anchor:]

# imports
s = s.replace(
    "import { rarityForValue, tierForValue, scrapCoinUsd } from '@/lib/economy';",
    "import { rarityForValue, tierForValue } from '@/lib/economy';\n"
    "import { scrapValueCoins, tierForRetail } from '@/lib/scrap';",
    1)

io.open(p, 'w', encoding='utf-8').write(s)
print('create route uses the retail rules')
