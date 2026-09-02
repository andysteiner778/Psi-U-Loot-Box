# MISSION BRIEF: FRAT MOVING-OUT CS:GO MYSTERY BOX APP ("HOUSE LOOT")

You are a principal full-stack engineer and casino math designer. You will build and deploy a complete, production-ready, mobile-responsive mystery box web application called **"House Loot"** for a house of 30 people moving out.

---

### CORE DIRECTIVE FOR CLAUDE CODE SUBAGENTS
To build this one-shot without context drift, divide execution into four parallel specialized workstreams:
1. **Agent Database & Math:** Supabase schema, RLS, atomic `open_box` PL/pgSQL RPC, and dynamic EV calculations.
2. **Agent CS:GO Reel & Audio:** Framer Motion horizontal carousel, near-miss deceleration physics, Web Audio API procedural sound engine, and particle VFX.
3. **Agent App Core & Gamification:** Player inventory, soulbound shard tracker, Scrap Compactor, and Supabase Realtime live ticker.
4. **Agent Admin & Vision:** Admin dashboard, one-tap Venmo deposit approvals, and multimodal vision API integration for item valuation.

---

## 1. TECH STACK & SYSTEM ARCHITECTURE
- **Frontend:** Next.js (App Router), Tailwind CSS, Lucide Icons, Canvas-Confetti.
- **Animations:** Framer Motion (custom cubic-bezier deceleration).
- **Audio Engine:** Web Audio API (procedural synthesized sounds—zero external MP3 dependencies).
- **Backend & Database:** Supabase (PostgreSQL, Row-Level Security, Realtime websockets, Atomic RPC functions).
- **Vision AI:** Multimodal API route (`/api/vision/scan-item`) using Gemini or Claude Vision.
- **Styling Theme:** Dark CS:GO Case Opening aesthetic (deep gunmetal `#0f1117`, neon borders, card glows).

---

## 2. MATHEMATICAL ENGINE & GAME ECONOMY

### A. The Anti-Exploit Rules (STRICT GUARDRAILS)
1. **No Cash-Outs:** Credits and scrap are closed-loop virtual currency.
2. **No Scrapping High-End Wins:** Items ranked **Purple (Restricted), Pink (Covert), or Gold (Special)** CANNOT be scrapped for coins. They can ONLY be claimed physically. This prevents a lucky player from winning a $200 speaker and recycling it into infinite spins to clear the rest of the house.
3. **Soulbound PC Shards:** PC Shards are bound to `user_id`. They cannot be transferred, sold peer-to-peer, or pooled between players. If a player abandons their shards, they can only salvage them back to the house for **1 Free Tier 2 Roll per Shard** (cost to house: ~$16 EV).
4. **The Host Break-Even Floor:** PC Shard drops remain locked at 0% until the total house pot crosses `$400` in gross deposits (configurable via admin toggle).

### B. Dual-Anchor Dynamic EV Engine
Box prices remain static. As physical items are won, odds dynamically rebalance using two virtual anchors:
- **Floor Anchor (Scrap Junk):** Value = $0. Absorbs excess probability mass.
- **Ceiling Anchor (Free Respin Token):** Value = Box Cost ($C$).
- **Dynamic Formula:**
  $$\text{Target EV} = C \times (1 - \text{House Margin}) \quad (\text{Default House Margin} = 20\%)$$
  For physical items $i$ with remaining stock $Q_i > 0$:
  $$P_i = \min\left(0.10, \; \frac{C \times 0.20}{V_i}\right)$$
  $$\text{EV}_{\text{phys}} = \sum (P_i \times V_i)$$
  $$\text{Remaining EV} = \text{Target EV} - \text{EV}_{\text{phys}}$$
  $$P_{\text{respin}} = \max\left(0.0, \; \frac{\text{Remaining EV}}{C}\right)$$
  $$P_{\text{scrap}} = 1.0 - \left(\sum P_i + P_{\text{respin}} + P_{\text{shard}}\right)$$

### C. Box Tiers
- **Tier 1: "Dorm Scraps" ($5):** Cables, random games, drone parts, MTG bulk. PC Shard chance: 1.5%.
- **Tier 2: "Living Room Gear" ($20):** 144Hz monitors, TV, MCAT prep books, audio peripherals. PC Shard chance: 6.0%.
- **Tier 3: "High Roller" ($50):** Audioengine A5+ speakers, premium electronics. PC Shard chance: 20.0%.

---

## 3. SUPABASE DATABASE SCHEMA & ATOMIC RPC

Execute this migration in Supabase:

> **NOTE — this SQL is the original brief and has known defects.**
> The authoritative, corrected implementation lives in `supabase/migrations/`.
> Fixed there: an unassigned-RECORD dereference that threw on every non-winning
> roll; unnormalized probability mass; a client-supplied box price; and an EV
> formula that pays out 116-136% of every box. See `lib/economy.ts` for the
> corrected math and `npm run simulate` for the proof.

```sql
-- Profiles & Balances
CREATE TABLE profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  pin TEXT NOT NULL DEFAULT '1234',
  balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  scrap_coins INT NOT NULL DEFAULT 0,
  pc_shards INT NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Items Inventory
CREATE TABLE items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  image_url TEXT NOT NULL,
  est_value NUMERIC(10, 2) NOT NULL,
  rarity TEXT NOT NULL CHECK (rarity IN ('grey', 'blue', 'purple', 'pink', 'gold')),
  scrap_value INT NOT NULL, -- 0 for purple/pink/gold
  stock_qty INT NOT NULL DEFAULT 1,
  box_tier TEXT NOT NULL CHECK (box_tier IN ('tier_1', 'tier_2', 'tier_3')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_shard BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Box Roll History
CREATE TABLE rolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  box_tier TEXT NOT NULL,
  item_id UUID REFERENCES items(id),
  item_name TEXT NOT NULL,
  item_rarity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inventory' CHECK (status IN ('inventory', 'scrapped', 'claimed', 'respin')),
  rolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deposits Queue
CREATE TABLE deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  venmo_note TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Global System Config
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
INSERT INTO config (key, value) VALUES 
  ('settings', '{"house_margin": 0.20, "pot_revenue_threshold": 400.00, "flash_sale": false}');

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rolls;
ALTER PUBLICATION supabase_realtime ADD TABLE deposits;

-- ATOMIC BOX OPENING FUNCTION
CREATE OR REPLACE FUNCTION open_box(
  p_user_id UUID,
  p_box_tier TEXT,
  p_box_price NUMERIC
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $
DECLARE   v_balance NUMERIC;
  v_shards INT;
  v_total_pot NUMERIC;
  v_threshold NUMERIC;
  v_rand FLOAT := random();
  v_cum_prob FLOAT := 0.0;
  v_shard_prob FLOAT := 0.0;
  v_item RECORD;
  v_winning_item RECORD;
  v_is_respin BOOLEAN := FALSE;
  v_is_shard BOOLEAN := FALSE;
  v_is_scrap BOOLEAN := FALSE;
BEGIN

  -- 1. Lock user profile & verify funds
  SELECT balance, pc_shards INTO v_balance, v_shards    FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF v_balance < p_box_price THEN     RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- 2. Deduct box price
  UPDATE profiles SET balance = balance - p_box_price WHERE id = p_user_id;

  -- 3. Check PC Pot Gate Threshold
  SELECT COALESCE(SUM(amount), 0) INTO v_total_pot FROM deposits WHERE status = 'approved';
  v_threshold := ((SELECT value->>'pot_revenue_threshold' FROM config WHERE key = 'settings'))::NUMERIC;
  IF v_total_pot >= v_threshold THEN
  IF p_box_tier = 'tier_1' THEN v_shard_prob := 0.015;
  ELSIF p_box_tier = 'tier_2' THEN v_shard_prob := 0.06;
  ELSIF p_box_tier = 'tier_3' THEN v_shard_prob := 0.20;
  END IF;
  END IF;

  -- 4. Determine if player hits PC Shard
  IF v_rand < v_shard_prob THEN
  UPDATE profiles SET pc_shards = pc_shards + 1 WHERE id = p_user_id;
  INSERT INTO rolls (user_id, box_tier, item_name, item_rarity, status)
  VALUES (p_user_id, p_box_tier, 'PC Core Shard (' || (v_shards + 1) || '/5)', 'gold', 'inventory');
  RETURN jsonb_build_object(       'type', 'shard',       'item_name', 'PC Core Shard (' || (v_shards + 1) || '/5)',       'rarity', 'gold',       'current_shards', v_shards + 1     );
  END IF;

  -- 5. Roll from Physical Inventory
  FOR v_item IN
  SELECT * FROM items      WHERE box_tier = p_box_tier AND stock_qty > 0 AND is_active = TRUE      ORDER BY est_value DESC
  FOR UPDATE
  LOOP

  -- Base calculation: 20% factor scaled by price
  DECLARE       v_p FLOAT := LEAST(0.10, (p_box_price * 0.20) / v_item.est_value);
  BEGIN       v_cum_prob := v_cum_prob + v_p;
  IF v_rand < (v_shard_prob + v_cum_prob) THEN         v_winning_item := v_item;
  EXIT;
  END IF;
  END;
  END LOOP;

  -- 6. If physical item won, decrement stock and log
  IF v_winning_item.id IS NOT NULL THEN
  UPDATE items SET stock_qty = stock_qty - 1 WHERE id = v_winning_item.id;
  INSERT INTO rolls (user_id, box_tier, item_id, item_name, item_rarity, status)
  VALUES (p_user_id, p_box_tier, v_winning_item.id, v_winning_item.name, v_winning_item.rarity, 'inventory');
  RETURN jsonb_build_object(       'type', 'physical',       'item_id', v_winning_item.id,       'item_name', v_winning_item.name,       'image_url', v_winning_item.image_url,       'rarity', v_winning_item.rarity,       'scrap_value', v_winning_item.scrap_value     );
  END IF;

  -- 7. Virtual Anchors (Respin vs Scrap)

  -- 10\% chance of free respin, otherwise Trade Scrap
  IF v_rand < (v_shard_prob + v_cum_prob + 0.10) THEN
  UPDATE profiles SET balance = balance + p_box_price WHERE id = p_user_id;
  INSERT INTO rolls (user_id, box_tier, item_name, item_rarity, status)
  VALUES (p_user_id, p_box_tier, 'Free Re-Roll Token', 'blue', 'respin');
  RETURN jsonb_build_object(       'type', 'respin',       'item_name', 'Free Re-Roll Token',       'rarity', 'blue',       'refund_amount', p_box_price     );
  ELSE
  UPDATE profiles SET scrap_coins = scrap_coins + 15 WHERE id = p_user_id;
  INSERT INTO rolls (user_id, box_tier, item_name, item_rarity, status)
  VALUES (p_user_id, p_box_tier, '+15 Scrap Coins', 'grey', 'scrapped');
  RETURN jsonb_build_object(       'type', 'scrap',       'item_name', '+15 Scrap Coins',       'rarity', 'grey',       'scrap_gained', 15     );
  END IF;
END;
$;
```

## 4. CS:GO Reel Spinner & Sound Engine
### A. Procedural Web Audio API Synthesizer (`lib/sound.ts`)
Zero external MP3 dependencies. Implement a lightweight audio engine:

```typescript
class SoundEffects {
  private ctx: AudioContext | null = null;

  private init() {
    if (!this.ctx) this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  }

  // High-passed tick sound on reel passage
  playTick() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, this.ctx.currentTime + 0.015);
    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.015);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.015);
  }

  // Low bass tension rumble during deceleration
  playNearMissWhoosh() {
    this.init();
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(65, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, this.ctx.currentTime + 0.4);
    gain.gain.setValueAtTime(0.6, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);
  }

  // Celebratory fanfare on Gold/Shard win
  playGoldFanfare() {
    this.init();
    if (!this.ctx) return;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99]; // C Major Arpeggio
    notes.forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, this.ctx!.currentTime + idx * 0.08);
      gain.gain.linearRampToValueAtTime(0.3, this.ctx!.currentTime + idx * 0.08 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx!.currentTime + idx * 0.08 + 0.6);
      osc.connect(gain);
      gain.connect(this.ctx!.destination);
      osc.start(this.ctx!.currentTime + idx * 0.08);
      osc.stop(this.ctx!.currentTime + idx * 0.08 + 0.6);
    });
  }
}
export const sfx = new SoundEffects();
```
### B. Framer Motion Reel Spinner with Near-Miss Logic
The reel consists of 60 rendered item cards horizontally.

Each item card displays: item image, title, and a glowing neon border matching rarity:

Grey: #4b5563 | Blue: #2563eb | Purple: #9333ea | Pink: #ec4899 | Gold: #eab308

Near-Miss Injection:

Card 49 is guaranteed to be a Gold item or PC Shard bait.

Card 50 is the winning item received from the open_box RPC.

Cards 51–60 are trailing items.

Physics: Deceleration lasts 5.5 seconds using cubic-bezier(0.10, 0.90, 0.15, 1.0).

At 4.8 seconds, trigger sfx.playNearMissWhoosh() as Card 49 passes under the center marker. When Card 50 stops precisely under the vertical indicator, fire canvas-confetti and sfx.playGoldFanfare().

## 5. User Inventory & Scrap Compactor
Inventory Page (/inventory):

Displays cards for all unboxed items.

For Grey and Blue items: Shows a glowing [Scrap Item for +X Coins] button.

For Purple, Pink, Gold items: Displays "Physical Pickup Only - Room 4" (No scrap option).

The Scrap Compactor:

When a user accumulates 100 Scrap Coins, display an interactive [Crush Scrap into Tier 2 Key] button with a metal-crunching animation and sound.

PC Core Forge Progress:

A persistent HUD bar displaying PC Shards: [X/5].

When 5/5 shards are collected, reveal the [Claim $800 Gaming PC] button and trigger a full-screen gold celebration.

## 6. Admin Portal & Vision Ingestion (`/admin`)
Protect /admin with a simple PIN prompt.

AI Item Scanner (/api/vision/scan-item):

Direct camera upload component on the phone.

Endpoint sends the image buffer to Gemini/Claude Vision:

"Identify this item, condition, realistic used market price (USD), recommended box tier (tier_1 <=$30, tier_2 <=$120, tier_3 >$120), CSGO rarity color, and scrap coin value (price * 10, or 0 if purple/pink/gold). Return JSON."

Auto-populates the "Create Item" form with Title, Estimated Value, Box Tier, Rarity, and Stock Qty.

Venmo Approval Queue:

Realtime table of deposit requests showing Player Name, Amount, and Venmo Note (#BOX-NAME).

One-tap [Approve] button updates player balance immediately via Postgres transaction.

Emergency House Controls:

Master toggle: Pot Gate Threshold ($400).

Flash Sale Trigger: 15-minute countdown slashing box prices by 20% across all clients.

Manual Drop Override: Force the next roll for a user to hit a specific item.

## 7. Realtime Social Feed (Ticker Banner)
Add a persistent scrolling banner across the header of the app:

Listens to Supabase Realtime INSERT events on the rolls table.

Formats events dynamically:

🏆 "[Name] just pulled [Item]! (Covert Pink)"

⚡ "[Name] found a PC Core Shard! (4/5)"

💀 "[Name] scrapped an HDMI cable for 15 coins."

## 8. Step-by-Step Verification & Execution Order
Execute the following implementation phases sequentially:

Phase 1: Project Scaffolding & Database Migration

Initialize Next.js with Tailwind CSS, Lucide, Canvas-Confetti, and Supabase client libraries.

Apply the Supabase SQL schema, create the open_box RPC function, and configure RLS.

Phase 2: Sound & Reel Physics Prototype

Implement lib/sound.ts with Web Audio API.

Build components/CaseReel.tsx with Framer Motion, test deceleration, tick audio synchronization, and near-miss placement.

Phase 3: Core Game Loops & State

Implement player login (name selection + 4-digit PIN).

Build box purchase flow connected to open_box RPC.

Implement /inventory with the anti-exploit scrap rules and shard progress bar.

Phase 4: Admin Dashboard & Multimodal Vision

Build /admin with Venmo ledger approvals and camera upload item scanner.

Set up Supabase Realtime subscriptions for the live house ticker.

Phase 5: End-to-End Stress Test

Simulate simultaneous rolls from multiple players.

Verify that physical items decrement correctly and that only Grey/Blue items can be scrapped.

Verify that PC Shards remain locked until the $400 threshold is reached.

Build the application completely with clean, modular, and error-handled code.