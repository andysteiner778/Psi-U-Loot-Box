# Hand-off Document: From Gemini to Claude

**Date:** 2026-09-02  
**Status:** Phases 1–5 Built, Fully Wired, Tested & Verified (`npm run build`, `npm run simulate`, `scripts/test-e2e.ts` all pass 100%).

---

## 1. Executive Summary & Status

All four workstreams and all 5 phases outlined in `SPEC.md` and `CONTRACT.md` are complete and production-ready.

### Verification Status
1. **Next.js Production Build (`npm run build`)**:  
   - Turbopack builds all 25 routes (SSR, Dynamic API handlers, Server Components) cleanly with 0 TypeScript and 0 lint errors.
2. **Mathematical Solvency Gate (`npm run simulate`)**:  
   - 783/783 invariant assertions passing across every tier, every stock level from full down to empty, and both gate states (open vs closed).
   - 100k Monte Carlo runs per tier confirm analytic EV strictly matches realized EV within float tolerance.
3. **End-to-End Multi-Player Stress Test (`npx tsx scripts/test-e2e.ts`)**:  
   - 25/25 assertions passing. Simulates 30 simultaneous players making hundreds of box rolls with live stock decrements, anti-exploit scrap checks, pot threshold locking, and reel deceleration physics.
4. **Seed Database Sync (`npm run seed:gen`)**:  
   - Generated `supabase/seed.sql` from `lib/catalog.ts` (30 players, 15 items, 49 units, $818 inventory value).

---

## 2. Core Math & Anti-Exploit Guardrails Summary

### The Mathematical Invariant
- **Spec EV Defect Fixed**: The original spec formula in section 2B resulted in 116–162% payouts per tier because shard costs weren't budgeted, the scrap consolation was treated as $0 (instead of $3 equivalent in Tier 2 keys), and $P_i \times V_i$ simplified to a constant $0.20 \times C$ per item.
- **The Corrected Engine (`lib/economy.ts` & migration `0002_functions.sql`)**: Treats the item odds formula as a *shape*, computes probability and EV scaling factor $\lambda$, and solves the dual-anchor linear system to guarantee an exact 20% house margin.

### The 4 Anti-Exploit Rules
1. **No Cash-Outs**: Closed-loop currency.
2. **High-Tier Scrapping Prohibited**: Restricted (Purple), Covert (Pink), and Special (Gold) items have `scrap_value = 0` and are barred from scrapping by both a database constraint (`high_tier_never_scrappable`) and `scrap_item` RPC checks.
3. **Soulbound PC Shards**: PC Shards cannot be traded or transferred. Players can salvage them back to the house for 1 Free Tier-2 Roll ($20 credit) per shard, which atomically returns the shard to the global mint cap.
4. **Host Break-Even Pot Gate**: Shard drops remain locked at strictly 0.0% until gross approved deposits cross `$400` (configurable live from the admin portal).

---

## 3. Complete Architectural File Map

```
app/
├── (player)/
│   ├── _lib/                  # Player store, queries, http helpers, shared types
│   ├── inventory/page.tsx     # Player inventory & Scrap Compactor
│   ├── layout.tsx             # Auth check, Ticker, Header, ToastStack
│   └── page.tsx               # Main Mystery Box opening screen (3 tiers + odds inspect)
├── admin/
│   ├── _lib/                  # Guard (requireAdmin), config CAS, http helpers
│   └── page.tsx               # Admin Portal, Venmo queue & Emergency Controls
├── api/
│   ├── admin/
│   │   ├── config/            # GET/PATCH config settings & flash-sale countdown
│   │   ├── deposits/          # List deposits, approve/reject Venmo requests
│   │   ├── items/             # CRUD physical loot pool items
│   │   └── override/          # Manual Drop Override (God Mode)
│   ├── auth/                  # Login (roster + PIN), logout, set private PIN
│   ├── box/                   # Open box (idempotent), box odds query
│   ├── deposits/              # Player deposit request submission (#BOX-[Name])
│   ├── inventory/             # Scrap item, scrap compactor, claim PC, salvage
│   └── vision/                # AI Camera valuation scanner (guarded by requireAdmin)
├── login/                     # Sign in with 30-person roster & 4-digit PIN
├── globals.css                # Dark CS:GO theme tokens & rarity glow classes
└── layout.tsx                 # Root layout with dark theme & fonts

components/
├── BoxCard.tsx                # Mystery box card with inspect & open actions
├── BoxOddsModal.tsx           # Loot table & live probabilities modal
├── CaseReel.tsx               # Framer Motion 60-card carousel + near-miss physics
├── DepositModal.tsx           # Venmo deposit modal
├── Header.tsx                 # Player HUD header (balance, scrap coins, sound, logout)
├── ItemCard.tsx               # CS:GO item card with neon border & rarity glow
├── ScrapCompactor.tsx         # Hydraulic scrap press (100 coins -> $20 key)
├── ShardHud.tsx               # Persistent PC shard tracker & salvage modal
├── Ticker.tsx                 # Realtime Supabase broadcast ticker
└── admin/
    ├── AdminDashboard.tsx     # Complete admin portal UI (Venmo queue, camera scanner, god mode)
    └── format.ts              # USD, pct, countdown formatting

lib/
├── catalog.ts                 # Authoritative 30 players & 15 items seed definition
├── economy.ts                 # Dual-anchor dynamic EV math engine
├── reel.ts                    # Cubic-bezier deceleration physics & tick schedule
├── session.ts                 # Server-side auth, sessions & player roster
├── sound.ts                   # Web Audio API procedural sound engine (zero MP3s)
├── types.ts                   # FROZEN CONTRACT (types, rarities, config)
├── supabase/
│   ├── browser.ts             # Anon client for realtime ticker broadcast
│   └── server.ts              # Service-role server client (server-only)
└── vision/                    # Claude & Gemini multimodal vision adapters

scripts/
├── gen-seed.ts                # Generates supabase/seed.sql
├── migrate.ts                 # Applies migrations to hosted Supabase
├── simulate.ts                # 100k Monte-Carlo solvency test
└── test-e2e.ts                # Phase 5 E2E stress & anti-exploit test suite
```

---

## 4. How to Deploy / Run in the Morning

1. **Dev Server**:
   ```bash
   npm run dev
   ```
2. **Apply Migrations & Seed to Hosted Supabase**:
   Set `SUPABASE_DB_URL` in `.env.local`, then run:
   ```bash
   npm run db:migrate -- --seed
   ```
3. **AI Vision Item Ingestion**:
   Set `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` in `.env.local` to enable camera unboxing appraisals in `/admin`.
4. **Run Invariant Checks**:
   ```bash
   npm run simulate
   npx tsx scripts/test-e2e.ts
   npm run build
   ```

---

## 5. Communication Channel for Claude

- Write to **`FROM_CLAUDE_FOR_GEMINI.md`** for any notes or tasks for Gemini.
- Gemini will respond in **`FROM_GEMINI_FOR_CLAUDE.md`**.
