import io
p='scripts/rebase-scrap.ts'
s=io.open(p,encoding='utf-8').read()

s = s.replace(
  "import type { EconomyConfig } from '../lib/types';",
  "import { scrapValueCoins, RETAIL_RATE, CAP_OF_BOX } from '../lib/scrap';\n"
  "import type { EconomyConfig, BoxTier, Rarity } from '../lib/types';", 1)

# retire the local copies of the two constants
old = s[s.index('/**\n * Dollars returned per dollar of retail'):s.index("const HIGH = ['purple', 'pink', 'gold'];")]
s = s.replace(old,
  "/*\n"
  " * RETAIL_RATE and CAP_OF_BOX now come from lib/scrap, which is also what the\n"
  " * admin create and edit forms call. They used to be declared here, and this\n"
  " * script was the only place the retail rule existed -- so an item added\n"
  " * through the form was priced by a different rule until someone remembered to\n"
  " * re-run this. Two copies of one formula is the bug that has already produced\n"
  " * a ten-times-wrong coin in this codebase four separate times.\n"
  " */\n", 1)

OLD = """    else if (BASIS === 'retail') {
      const boxCap = (prices[i.box_tier] ?? 0) * CAP_OF_BOX;
      const payout = Math.min(retail * RETAIL_RATE, boxCap);
      /*
       * FLOOR, not round. A $0.25 cap against a $0.10 coin rounds 2.5 up to 3
       * coins = $0.30, which quietly breaks the very cap it is applying — and
       * the cap is the only thing standing between this and a farm loop.
       * Rounding down costs a few cents and keeps the guarantee exact.
       *
       * No 1-coin floor here either: below one coin of value the item is simply
       * not worth scrapping, which the inventory already words properly.
       */
      want = payout <= 0 ? 0 : Math.floor(payout / coin);
    } else {"""
NEW = """    else if (BASIS === 'retail') {
      // The shared rule, byte for byte the one the admin forms apply.
      want = scrapValueCoins(
        {
          est_value: val,
          msrp: retail,
          rarity: i.rarity as Rarity,
          box_tier: i.box_tier as BoxTier,
          shard_cost: i.shard_cost,
          reward_credit: i.reward_credit,
          reward_voucher_tier: i.reward_voucher_tier as BoxTier | null,
        },
        fullCfg
      );
    } else {"""
assert OLD in s
s = s.replace(OLD, NEW, 1)

s = s.replace(
  "  const coin = scrapCoinUsd({ ...DEFAULT_CONFIG, ...(cfg as Partial<EconomyConfig>) } as EconomyConfig);",
  "  const fullCfg = { ...DEFAULT_CONFIG, ...(cfg as Partial<EconomyConfig>) } as EconomyConfig;\n"
  "  const coin = scrapCoinUsd(fullCfg);", 1)

io.open(p,'w',encoding='utf-8').write(s)
