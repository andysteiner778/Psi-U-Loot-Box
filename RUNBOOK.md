# Party-Night Runbook: House Loot Admin Operations

**Target Audience:** Admin / House Host running the party on a phone.  
**Admin Portal URL:** `http://<domain-or-local-ip>:3000/admin` (or `/admin/players`)  
**Authentication:** Sign in with an admin-designated account (e.g. `Andy` / PIN).

---

## 1. How to Approve a Venmo Deposit

When a player sends money on Venmo:
1. Open `/admin` and tap the **Venmo Ledger** tab.
2. Verify the incoming Venmo payment on your Venmo phone app:
   - Match the **Player Name** and **Amount ($5, $20, $50, etc.)**.
   - Confirm the note contains `#BOX-[Name]`.
3. In `/admin`, find the matching pending row:
   - Tap **[Approve]**: This triggers an atomic PostgreSQL transaction that sets `status = 'approved'` and immediately credits the player's live wallet.
   - Tap **[Reject]**: If the player submitted a false deposit or canceled.
4. *Tip:* The player's balance updates automatically via polling on their screen within 2 seconds.

---

## 2. How to Trigger a Flash Sale

When the room needs excitement or roll volume slows down:
1. Go to `/admin` -> **Emergency Controls** tab.
2. Tap **[Trigger 15-Minute Flash Sale (20% Off)]**.
3. What happens immediately:
   - Tier 1 drops from **$5 -> $4**
   - Tier 2 drops from **$20 -> $16**
   - Tier 3 drops from **$50 -> $40**
   - A pulsing gold **"⚡ FLASH SALE ACTIVE — 20% OFF ALL BOXES"** banner appears across all 30 phones.
   - The countdown timer ticks down synchronously on server time.
4. To stop early: Tap **[Stop Flash Sale]**.

---

## 3. What to Do If a Player Claims the App "Cheated"

If someone claims a reel landed on a monitor but gave them cables or scrap:
1. **Explain the Architecture**:
   - The roll result is determined **authoritatively on the PostgreSQL server before the reel begins spinning**.
   - The client-side Framer Motion reel is purely a visual presentation of the server's cryptographic outcome.
2. **Show the Immutable Roll Receipt**:
   - In Supabase SQL or the player's recent rolls table at `/inventory`:
   - Every single spin writes a permanent row in `public.rolls` with its exact server timestamp, `client_roll_id`, `box_tier`, and full JSON `payload`.
   - Show them the exact server payload:
     ```json
     { "type": "physical", "item_name": "Cable Bundle", "est_value": 4, "roll_id": "..." }
     ```
   - No roll can be manipulated, double-charged, or lost.

---

## 4. How to Rename Players & Reset Forgotten PINs

### Method A: Admin Portal (Fastest on Mobile)
1. In `/admin`, tap the **Players & PINs** tab (or navigate directly to `/admin/players`).
2. **Rename Housemates**: Tap the pencil icon next to any seeded placeholder name (e.g., `Andy` -> `Tyler`), type the real housemate's name, and tap check.
3. **Reset Forgotten PIN**: Tap **[Reset PIN]** next to the player's row. Their PIN is instantly set to `1234` with `must_change = true`. On their next login, the app forces them to choose a new 4-digit PIN.
4. **Promote Co-Admin**: Tap the role badge on a trusted housemate to promote them to `Admin` (avoids single point of failure if host's phone runs out of battery).

### Method B: Direct SQL (Emergency)
Run this query in Supabase SQL Editor:
```sql
UPDATE app_private.profile_secrets
   SET pin_hash = extensions.crypt('1234', extensions.gen_salt('bf', 10)),
       must_change = TRUE,
       failed_attempts = 0,
       locked_until = NULL
 WHERE profile_id = (SELECT id FROM public.profiles WHERE name = 'PlayerName');
```

---

## 5. What to Do When a Tier's High-End Items Empty Out

When high-end prizes (like the $200 Speakers, GPU, or 144Hz Monitor) are unboxed:
1. **The Economy Engine Automatically Rebalances**:
   - The dual-anchor engine continuously detects in-stock items (`stock_qty > 0`).
   - When major items run out, the engine seamlessly scales probabilities into remaining items, respins, and scrap consolation so EV never exceeds the budget.
2. **Restocking Options**:
   - **Option A (AI Item Scanner)**: In `/admin` -> **AI Item Scanner & Loot**, snap a photo of any new item in the house. The AI values it, picks the tier/rarity, and uploads the photo to `item-images` bucket.
   - **Option B (Quick Add & Next ⚡)**: In the Item Entry form, type title, value, and stock without camera, and tap **[Quick Add & Next ⚡]** to rapid-fire add 40 junk items.
   - **Option C (Stock Restock)**: In `/admin` -> **Loot Pool**, tap `[+]` on existing items if you find extra units in the house.

---

## 6. Summary of Host Guardrails

- **Pot Revenue Threshold ($400)**: PC Shard drops stay at 0% until $400 of gross Venmo deposits are approved. You can adjust this slider in `/admin` -> Emergency Controls.
- **Soulbound Shards**: If a player has 2 or 3 shards but wants out, tell them to tap **[Salvage Shards]** in their Shard HUD — they get $20 of wallet credit per shard.
- **Physical Pickup Only**: Remind winners that Purple (Restricted), Pink (Covert), and Gold (PC Shard/Gaming PC) items cannot be scrapped — they must be picked up physically in Room 4.

---

## 7. Vercel Production Deployment Checklist

### A. Required Environment Variables in Vercel Dashboard
Add the following under **Project Settings -> Environment Variables**:

| Variable Name | Exposure | Description / Required Value |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | **Public** (Client + Server) | Your hosted Supabase project URL (e.g. `https://xyz.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Public** (Client + Server) | Supabase anon key (strictly locked down by RLS) |
| `SUPABASE_SERVICE_ROLE_KEY` | **SERVER-ONLY** (Sensitive) | Supabase service_role key. **NEVER add `NEXT_PUBLIC_` prefix!** |
| `SESSION_SECRET` | **SERVER-ONLY** (Sensitive) | 32+ character random string for signing iron-session cookies |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | **SERVER-ONLY** (Optional) | API key for multimodal camera item scanner |

> [!CAUTION]
> Ensure `SUPABASE_SERVICE_ROLE_KEY` does NOT have `NEXT_PUBLIC_` attached to it. The service-role key bypasses all Postgres RLS and must only exist in server-side Node.js runtimes.

### B. Pre-Deployment Verification
Before pushing to production, verify all gates locally:
```bash
npm run verify:sql    # Verify offline Postgres migration & RPC correctness
npm run simulate      # Verify 1,353 economy solvency invariants
npm run tune          # Verify drop rates and playability
npm run build         # Verify Next.js Turbopack build
npx tsc --noEmit      # Verify 0 TypeScript errors
```

### C. Post-Deployment Smoke Test
Once deployed on Vercel:
1. Run the live verification suite:
   ```bash
   npm run verify:live
   ```
   This performs 27 live checks on the production instance:
   - Anon key permission lockdown (`42501` refused on table reads)
   - Realtime WebSocket broadcast delivery to client
   - Storage bucket `item-images` write and read access
   - Atomic `open_box` execution and roll receipt persistence
2. Sign in as Admin (`Andy` / initial PIN) on your mobile browser.
3. Open `/admin/players`, rename the seeded players to your housemates, and you are ready for party night!
