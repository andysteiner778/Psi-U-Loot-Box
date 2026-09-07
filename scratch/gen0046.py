import io

ob = io.open('scratch/ob.sql', encoding='utf-8').read()

OLD = """    IF v_it IS NOT NULL THEN
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'physical', (v_it->>'item_id')::UUID,
              v_it->>'item_name', v_it->>'rarity', 'inventory', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;
      v_result := v_it || jsonb_build_object('type','physical','roll_id',v_roll_id);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      RETURN v_result;
    END IF;"""

NEW = """    IF v_it IS NOT NULL THEN
      INSERT INTO public.rolls (user_id, box_tier, kind, item_id, item_name, item_rarity,
                                status, box_price, client_roll_id)
      VALUES (p_user_id, p_box_tier, 'physical', (v_it->>'item_id')::UUID,
              v_it->>'item_name', v_it->>'rarity', 'inventory', v_price, p_client_roll_id)
      RETURNING id INTO v_roll_id;

      -- The forced drop is a real win and must hand over everything a real win
      -- hands over. This branch returns early with its own payload, so the
      -- bundle logic further down is never reached -- exactly the trap the
      -- reward-row check above this was added to fix. An admin forcing a
      -- bundled item would otherwise get the host and silently no rider,
      -- which is the one case where the forcing is being used to CHECK the
      -- bundle works.
      SELECT bonus_item_id INTO v_bon_item
        FROM public.items WHERE id = (v_it->>'item_id')::UUID;
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
      END IF;

      v_result := v_it || jsonb_build_object('type','physical','roll_id',v_roll_id,
        'bonus_item', CASE WHEN v_bon_item IS NULL THEN NULL ELSE jsonb_build_object(
          'item_id', v_bon_item, 'item_name', v_bi_name, 'rarity', v_bi_rar,
          'est_value', v_bi_val, 'scrap_value', v_bi_scrap,
          'image_url', v_bi_img, 'msrp', v_bi_msrp, 'roll_id', v_bi_roll) END);
      UPDATE public.rolls SET payload = v_result WHERE id = v_roll_id;
      IF v_bi_roll IS NOT NULL THEN
        UPDATE public.rolls SET payload = v_result->'bonus_item' || jsonb_build_object('type','physical')
         WHERE id = v_bi_roll;
      END IF;
      RETURN v_result;
    END IF;"""

assert OLD in ob, 'forced-drop physical branch not found'
ob = ob.replace(OLD, NEW, 1)

HEADER = """-- ---------------------------------------------------------------------------
--  0046 — a forced drop hands over the bundle too
--
--  0045 gave items a `bonus_item_id` rider. The admin forced-drop branch
--  returns early with its own payload, so it never reached that code: forcing a
--  bundled item handed over the host and silently dropped the rider.
--
--  That is the same shape as the bug the reward-row check in this branch was
--  added to fix ("testing a reward by forcing it silently exercised the wrong
--  path"), and it bites hardest here -- forcing a drop is mostly how the bundle
--  gets CHECKED, so the one path used to verify the feature was the one path
--  that did not implement it.
-- ---------------------------------------------------------------------------

"""

io.open('supabase/migrations/0046_forced_drop_bundles.sql', 'w', encoding='utf-8').write(
    HEADER + ob + ';\n')
print('0046 written')
