import io

bo = io.open('scratch/bo.sql', encoding='utf-8').read()
ob = io.open('scratch/ob.sql', encoding='utf-8').read()

# ---------------------------------------------------------------- box_odds
VOUCHER_EXPR = """COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)"""
BUNDLE_EXPR = """(COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)
           + COALESCE((SELECT b.est_value FROM public.items b WHERE b.id = t.bonus_item_id), 0))"""

n = bo.count(VOUCHER_EXPR)
assert n == 3, 'expected 3 bundled-value expressions, found %d' % n
bo = bo.replace(VOUCHER_EXPR, BUNDLE_EXPR)

# the filler SUM uses the expression inline with different surrounding parens
OLD_SUM = """COALESCE(SUM((t.est_value + (COALESCE(
           (cfg->'box_prices'->>t.bonus_voucher_tier)::NUMERIC * t.bonus_voucher_pct, 0)
           + COALESCE((SELECT b.est_value FROM public.items b WHERE b.id = t.bonus_item_id), 0)))
           * t.stock_qty), 0),"""
assert OLD_SUM in bo, 'filler SUM shape changed'

# bundle-only rows never drop on their own
EXCLUDE = """     -- A bundle-only row is a rider, not a prize: it reaches a player attached
     -- to something else (bonus_item_id) and must never be drawn by itself.
     AND NOT COALESCE(t.bundle_only, FALSE)
     AND COALESCE(t.shard_cost, 0) = 0"""
assert bo.count('     AND COALESCE(t.shard_cost, 0) = 0') == 2
bo = bo.replace('     AND COALESCE(t.shard_cost, 0) = 0', EXCLUDE)

# ---------------------------------------------------------------- open_box
# Grant the bundled item alongside the physical win, wherever a bonus voucher
# is already granted from a real object.
OLD_BONUS = """      SELECT bonus_voucher_tier, bonus_voucher_pct INTO v_bon_tier, v_bon_pct
        FROM public.items WHERE id = (v_it->>'item_id')::UUID;
      IF v_bon_tier IS NOT NULL THEN
        INSERT INTO public.vouchers (user_id, box_tier, discount_pct, source_roll_id)
        VALUES (p_user_id, v_bon_tier, v_bon_pct, v_roll_id);
      END IF;"""
NEW_BONUS = """      SELECT bonus_voucher_tier, bonus_voucher_pct, bonus_item_id
        INTO v_bon_tier, v_bon_pct, v_bon_item
        FROM public.items WHERE id = (v_it->>'item_id')::UUID;
      IF v_bon_tier IS NOT NULL THEN
        INSERT INTO public.vouchers (user_id, box_tier, discount_pct, source_roll_id)
        VALUES (p_user_id, v_bon_tier, v_bon_pct, v_roll_id);
      END IF;

      -- ---- BUNDLED ITEM ---------------------------------------------------
      -- A second object rides along with this one. Favors used to sit in the
      -- pool as standalone drops, so winning one moved no stock at all; as a
      -- rider, every win still clears something off the shelf and the favor is
      -- the bit that makes it feel good.
      --
      -- Conditional decrement, exactly like the main award: if the last one has
      -- gone the base item is still won and the rider is simply absent. Its
      -- value is already charged to the budget in box_odds, so this is paid for.
      IF v_bon_item IS NOT NULL THEN
        UPDATE public.items SET stock_qty = stock_qty - 1
         WHERE id = v_bon_item AND stock_qty > 0;
        GET DIAGNOSTICS v_bon_hit = ROW_COUNT;
        IF v_bon_hit = 1 THEN
          SELECT name, rarity, est_value, scrap_value, image_url, msrp
            INTO v_bi_name, v_bi_rar, v_bi_val, v_bi_scrap, v_bi_img, v_bi_msrp
            FROM public.items WHERE id = v_bon_item;
          INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name,
                                    item_rarity, status, box_price, client_roll_id)
          VALUES (p_user_id, p_box_tier, 'physical', v_bon_item, v_bi_name,
                  v_bi_rar, 'inventory', 0, NULL)
          RETURNING id INTO v_bi_roll;
        ELSE
          v_bon_item := NULL;
        END IF;
      END IF;"""
assert OLD_BONUS in ob, 'bonus voucher award site not found in open_box'
ob = ob.replace(OLD_BONUS, NEW_BONUS, 1)

# carry the rider into the payload
OLD_PAYLOAD = """        'bonus_tier', v_bon_tier, 'bonus_pct', v_bon_pct,
        'roll_id', v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;
    -- Lost the race for the last unit. Refund rather than silently charge."""
NEW_PAYLOAD = """        'bonus_tier', v_bon_tier, 'bonus_pct', v_bon_pct,
        'bonus_item', CASE WHEN v_bon_item IS NULL THEN NULL ELSE jsonb_build_object(
          'item_id', v_bon_item, 'item_name', v_bi_name, 'rarity', v_bi_rar,
          'est_value', v_bi_val, 'scrap_value', v_bi_scrap,
          'image_url', v_bi_img, 'msrp', v_bi_msrp, 'roll_id', v_bi_roll) END,
        'roll_id', v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      IF v_bi_roll IS NOT NULL THEN
        UPDATE public.rolls SET payload = v_result->'bonus_item' || jsonb_build_object('type','physical')
         WHERE id = v_bi_roll;
      END IF;
      RETURN v_result;
    END IF;
    -- Lost the race for the last unit. Refund rather than silently charge."""
assert OLD_PAYLOAD in ob, 'physical payload site not found'
ob = ob.replace(OLD_PAYLOAD, NEW_PAYLOAD, 1)

# declare the new locals
OLD_DECL = "  v_bon_tier  TEXT;"
assert OLD_DECL in ob, 'v_bon_tier declaration not found'
ob = ob.replace(OLD_DECL,
    "  v_bon_tier  TEXT;\n"
    "  v_bon_item  UUID;\n"
    "  v_bon_hit   INT;\n"
    "  v_bi_roll   UUID;\n"
    "  v_bi_name   TEXT;\n"
    "  v_bi_rar    TEXT;\n"
    "  v_bi_val    NUMERIC;\n"
    "  v_bi_scrap  INT;\n"
    "  v_bi_img    TEXT;\n"
    "  v_bi_msrp   NUMERIC;", 1)

HEADER = """-- ---------------------------------------------------------------------------
--  0045 — FAVORS RIDE ALONG WITH JUNK INSTEAD OF REPLACING IT
--
--  A favor sitting in the pool as its own row is a drop that moves no stock:
--  the player wins "$50 Favor", the shelf is exactly as full as before, and the
--  point of the night was to empty the shelf. On tier_3 that was 10.7% of every
--  roll, on tier_2 9.4%.
--
--  `items.bonus_item_id` makes any row able to carry a second object, the same
--  way `bonus_voucher_tier` already lets one carry a free spin. Winning the
--  junk hands over the junk AND the favor, so every win clears something.
--
--  `items.bundle_only` keeps the rider out of the draw. Without it a favor
--  would be both a rider and a standalone prize, which is the thing being
--  fixed. box_odds excludes bundle_only rows from the prize pool and the filler
--  pool; tier_lock_state excludes them too, or a tier holding nothing but
--  riders would look stocked.
--
--  PRICING. The rider's est_value is added to the same `bvals` array that
--  already prices bundled vouchers, so it does two jobs at once: the weight
--  formula makes a bundled item rarer, and the EV solve pays for it. Doing only
--  one of the two silently overspends -- the comment already in box_odds says
--  so, and it is just as true for an item as for a voucher.
--
--  STOCK. The rider is decremented conditionally, exactly like the main award.
--  If the last one has gone the base item is still won and the rider is simply
--  absent, rather than the roll failing or handing over something that is not
--  there. It gets its own `rolls` row so inventory, reconcile and the scrap
--  path all treat it as the ordinary object it is.
-- ---------------------------------------------------------------------------

ALTER TABLE public.items
  ADD COLUMN IF NOT EXISTS bonus_item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS bundle_only   BOOLEAN NOT NULL DEFAULT FALSE;

-- A row cannot carry itself, which would decrement the same unit twice.
ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_bonus_not_self;
ALTER TABLE public.items ADD CONSTRAINT items_bonus_not_self
  CHECK (bonus_item_id IS NULL OR bonus_item_id <> id);

CREATE INDEX IF NOT EXISTS items_bundle_only_idx ON public.items (bundle_only)
  WHERE bundle_only;

"""

LOCK = """
-- ---------------------------------------------------------------------------
--  tier_lock_state: a shelf of riders is not a stocked shelf.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tier_lock_state(p_box_tier TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  cfg JSONB; v_rank INT; v_fmax NUMERIC; v_fmin NUMERIC; v_c NUMERIC; v_real INT;
BEGIN
  SELECT value INTO cfg FROM public.config WHERE key = 'settings';
  v_rank := array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], p_box_tier);
  v_c    := (cfg->'box_prices'->>p_box_tier)::NUMERIC;
  v_fmax := COALESCE((cfg->>'filler_max_value')::NUMERIC, 15);
  v_fmin := COALESCE((cfg->>'filler_min_frac')::NUMERIC, 0) * v_c;

  SELECT COUNT(*) INTO v_real
    FROM public.items i
   WHERE i.is_active
     AND i.stock_qty > 0
     AND i.est_value > 0
     AND COALESCE(i.shard_cost, 0) = 0
     AND NOT COALESCE(i.bundle_only, FALSE)
     AND i.reward_credit IS NULL
     AND i.reward_voucher_tier IS NULL
     AND (
       i.box_tier = p_box_tier
       OR i.est_value > v_fmax
       OR (array_position(ARRAY['tier_0','tier_1','tier_2','tier_3'], i.box_tier) < v_rank
           AND i.est_value <= v_fmax AND i.est_value >= v_fmin)
     );

  RETURN jsonb_build_object(
    'tier', p_box_tier,
    'locked', v_real = 0,
    'real_items_left', v_real,
    'reason', CASE WHEN v_real = 0
                   THEN 'Everything worth winning in this box has been claimed.'
                   ELSE NULL END);
END;
$fn$;
"""

io.open('supabase/migrations/0045_bundled_items.sql', 'w', encoding='utf-8').write(
    HEADER + bo + ';\n\n' + ob + ';\n' + LOCK)
print('0045 written')
