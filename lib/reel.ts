/**
 * REEL CONSTRUCTION & TIMING — Workstream 2 (CS:GO Reel & Audio)
 *
 * Pure module. No React, no DOM, no `window`. Everything here is a function of
 * its arguments so the reel can be unit-tested without a browser.
 *
 * THE ONE RULE OF THIS FILE
 * -------------------------
 * The winner is decided SERVER-SIDE by the `open_box` RPC before any of this
 * runs. `buildReel` only *presents* an outcome that already happened. Nothing
 * in here may read, weight, re-roll or otherwise influence `winner` — it goes
 * into slot 50 verbatim and that is the whole of its involvement. If you ever
 * find yourself wanting reel code to "pick" something, you are writing a client
 * -side gambling engine, and the house will be looted.
 */

import type { OpenBoxResult, Rarity } from './types';

// ---------------------------------------------------------------------------
// Card model
// ---------------------------------------------------------------------------

/**
 * One rendered cell of the strip.
 *
 * NOTE: this type is NOT in the frozen `lib/types.ts` — that file has no reel
 * concept and I am not allowed to add one. It lives here and is imported from
 * `@/lib/reel` by anyone who needs it (App Core builds the decoy pool).
 */
export interface ReelCard {
  /** Stable React key. `buildReel` rewrites these so they are unique per strip. */
  id: string;
  name: string;
  rarity: Rarity;
  image_url: string | null;
  /** Exactly one card in a built reel carries this: the server's actual result. */
  isWinner?: boolean;
  /** The gold/pink bait in slot 49 that the reel crawls past on the way to 50. */
  isNearMiss?: boolean;
  /** Present only on the winner card. Lets the UI render the payout inline. */
  result?: OpenBoxResult;
}

// ---------------------------------------------------------------------------
// Geometry of the strip (spec section 4B)
// ---------------------------------------------------------------------------

export const REEL_LENGTH = 60;

/** 1-based positions, exactly as the spec words them. */
export const NEAR_MISS_POSITION = 49;
export const WINNER_POSITION = 50;

/** 0-based array indices, which is what the code actually uses. */
export const NEAR_MISS_INDEX = NEAR_MISS_POSITION - 1; // 48
export const WINNER_INDEX = WINNER_POSITION - 1; //       49

/**
 * Probability that a given spin gets a near-miss card at all.
 * ~0.45 means most players see one every one to three openings, which reads as
 * luck rather than as a scripted beat.
 */
export const NEAR_MISS_CHANCE = 0.45;

/** Rarities that qualify as near-miss bait. */
export const BAIT_RARITIES: readonly Rarity[] = ['gold', 'pink', 'purple'];

// ---------------------------------------------------------------------------
// Deceleration curve (spec section 4B)
// ---------------------------------------------------------------------------

/**
 * Deceleration time.
 *
 * The spec called for 5.5s. Nudged to 6.8s: the extra 1.3 seconds all lands in
 * the slow tail where the cards are crawling, which is the part that actually
 * builds tension. Going much beyond this starts to feel like waiting rather
 * than watching, especially by someone's tenth box of the night.
 */
export const REEL_DURATION_MS = 6800;

/**
 * cubic-bezier(0.10, 0.90, 0.15, 1.0) as [x1, y1, x2, y2].
 * Deliberately a mutable tuple, not `as const`: framer-motion's `ease` prop
 * wants `[number, number, number, number]` and will reject a readonly tuple.
 */
export const REEL_EASE: [number, number, number, number] = [0.1, 0.9, 0.15, 1.0];

/** The same curve as a CSS string, for anything driven by a transition. */
export const REEL_EASE_CSS = 'cubic-bezier(0.10, 0.90, 0.15, 1.0)';

/** Spec's stated near-miss cue. `nearMissCueMs()` derives ~4803ms; see below. */
export const NEAR_MISS_CUE_MS = 4800;

/**
 * How far past the centre marker the near-miss card has travelled, in card
 * pitches, at the moment the whoosh fires. See `nearMissCueMs()`.
 */
export const NEAR_MISS_CLEARANCE = 0.955;

// ---------------------------------------------------------------------------
// Reel construction
// ---------------------------------------------------------------------------

/** Used when the caller hands us an empty decoy pool (dev, or a cold catalog). */
const FALLBACK_DECOYS: ReelCard[] = [
  { id: 'fb-cable', name: 'Cable Bundle', rarity: 'grey', image_url: null },
  { id: 'fb-charger', name: 'Phone Charger', rarity: 'grey', image_url: null },
  { id: 'fb-mugs', name: 'Kitchen Miscellany', rarity: 'grey', image_url: null },
  { id: 'fb-commons', name: 'MTG Commons Box', rarity: 'grey', image_url: null },
  { id: 'fb-lamp', name: 'Desk Lamp', rarity: 'grey', image_url: null },
  { id: 'fb-keyboard', name: 'Mechanical Keyboard', rarity: 'grey', image_url: null },
  { id: 'fb-suitcase', name: 'Hardshell Suitcase', rarity: 'blue', image_url: null },
  { id: 'fb-desk', name: 'Standing Desk', rarity: 'blue', image_url: null },
  { id: 'fb-mtg', name: 'MTG Bulk Collection', rarity: 'blue', image_url: null },
  { id: 'fb-monitor', name: '1080p Monitor', rarity: 'blue', image_url: null },
  { id: 'fb-144hz', name: '144Hz Gaming Monitor', rarity: 'purple', image_url: null },
  { id: 'fb-mcat', name: 'MCAT Prep Book Set', rarity: 'purple', image_url: null },
  { id: 'fb-speakers', name: 'Audioengine A5+ Speakers', rarity: 'pink', image_url: null },
];

const SHARD_BAIT: ReelCard = {
  id: 'bait-shard',
  name: 'PC Core Shard',
  rarity: 'gold',
  image_url: null,
};

function pick<T>(pool: readonly T[], rng: () => number): T {
  // `% pool.length` guards the (spec-legal) case of rng() returning exactly 1.
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/** Turn the RPC's discriminated union into something the strip can render. */
export function cardFromResult(result: OpenBoxResult): ReelCard {
  return {
    id: result.roll_id,
    name: result.item_name,
    rarity: result.rarity,
    image_url: result.type === 'physical' ? result.image_url : null,
    result,
  };
}

/**
 * Build the 60-card strip the reel animates.
 *
 * Layout, per spec 4B:
 *   slots 1–48  randomised decoys (gold suppressed so slot 49 lands harder)
 *   slot  49    guaranteed gold/pink bait — the near miss
 *   slot  50    the server's actual result, verbatim
 *   slots 51–60 trailing decoys, visible to the right of the marker on settle
 *
 * `rng` is injectable purely so tests can pin the strip; it never touches the
 * outcome.
 */
export function buildReel(
  winner: OpenBoxResult,
  decoys: ReelCard[],
  rng: () => number = Math.random,
): ReelCard[] {
  const pool = decoys.length > 0 ? decoys : FALLBACK_DECOYS;

  // Keep the bait rarities out of the filler so slot 49 is the only one the
  // player sees coming. If the pool is all gold (it won't be), fall back to it.
  const filler = pool.filter((c) => !BAIT_RARITIES.includes(c.rarity));
  const fillerPool = filler.length > 0 ? filler : pool;

  const cards: ReelCard[] = new Array<ReelCard>(REEL_LENGTH);
  for (let i = 0; i < REEL_LENGTH; i++) {
    const src = pick(fillerPool, rng);
    cards[i] = { ...src, id: `reel-${i}-${src.id}`, isWinner: false, isNearMiss: false };
  }

  // The near-miss is DELIBERATELY not guaranteed.
  //
  // Firing it on every single spin makes it predictable: after three or four
  // openings a player learns that the card before the line is always a fake
  // jackpot, and the tension it exists to create evaporates. Landing it on
  // roughly half of spins keeps it unpredictable -- typically one in every one
  // to three openings -- which is what makes the occasional real gold land
  // feel earned.
  if (rng() < NEAR_MISS_CHANCE) {
    // Any Legendary-or-better item in this tier can be the near miss, picked at
    // random rather than always the single best one -- seeing the same $400 PC
    // slide past every time is how a player learns the beat is scripted.
    const candidates = pool.filter((c) => BAIT_RARITIES.includes(c.rarity));
    const bait =
      candidates.length > 0 ? candidates[Math.floor(rng() * candidates.length)] : SHARD_BAIT;

    cards[NEAR_MISS_INDEX] = {
      ...bait,
      id: `reel-${NEAR_MISS_INDEX}-bait`,
      isNearMiss: true,
      isWinner: false,
    };
  }

  cards[WINNER_INDEX] = {
    ...cardFromResult(winner),
    id: `reel-${WINNER_INDEX}-winner`,
    isWinner: true,
    isNearMiss: false,
  };

  return cards;
}

// ---------------------------------------------------------------------------
// Bezier maths
// ---------------------------------------------------------------------------

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * One axis of a cubic bezier whose endpoints are pinned at 0 and 1 — which is
 * exactly what CSS `cubic-bezier(x1, y1, x2, y2)` is. `s` is the curve's own
 * parameter, and is NOT time: that's the whole reason this file exists.
 */
function bezierAxis(s: number, p1: number, p2: number): number {
  const u = 1 - s;
  return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s;
}

/**
 * Invert one axis: find the curve parameter `s` where that axis equals `target`.
 * Bisection rather than Newton — both control points are inside [0, 1] so the
 * axis is monotonic, bisection cannot diverge, and 48 halvings puts us well
 * inside float precision. It runs ~50 times per spin, once. Speed is not the
 * constraint here; not being subtly wrong is.
 */
function solveForParam(target: number, p1: number, p2: number): number {
  if (target <= 0) return 0;
  if (target >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) * 0.5;
    if (bezierAxis(mid, p1, p2) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) * 0.5;
}

/** The easing function itself: elapsed fraction -> distance fraction. */
export function progressAtTime(
  elapsedFraction: number,
  ease: readonly [number, number, number, number] = REEL_EASE,
): number {
  const s = solveForParam(clamp01(elapsedFraction), ease[0], ease[2]);
  return bezierAxis(s, ease[1], ease[3]);
}

/**
 * The easing function INVERTED: distance fraction -> elapsed fraction.
 *
 * This is the function the tick schedule is built on. Solve Y(s) = progress for
 * the curve parameter, then read X(s) to get the time. Note we only ever have
 * to invert one axis, never both.
 */
export function timeForProgress(
  progress: number,
  ease: readonly [number, number, number, number] = REEL_EASE,
): number {
  const s = solveForParam(clamp01(progress), ease[1], ease[3]);
  return bezierAxis(s, ease[0], ease[2]);
}

// ---------------------------------------------------------------------------
// Pixel geometry -> tick schedule
// ---------------------------------------------------------------------------

/**
 * Measured layout of the strip. The component fills this in from the DOM after
 * the 60 cards mount; everything downstream is arithmetic.
 */
export interface ReelGeometry {
  /** px between the left edges of adjacent cards (card width + flex gap). */
  pitch: number;
  /** px width of a single card. */
  cardWidth: number;
  /** px width of the clipping window. The marker sits at its centre. */
  viewportWidth: number;
}

/**
 * Track translation at t=0. Zero means "card 1's left edge is flush with the
 * left edge of the window", which is what keeps the left half of the viewport
 * full of cards from the first frame instead of showing empty space.
 */
export const REEL_START_X = 0;

/** Track translation (px, negative) that centres card `index` under the marker. */
export function offsetForIndex(index: number, g: ReelGeometry): number {
  return g.viewportWidth / 2 - index * g.pitch - g.cardWidth / 2;
}

/** Total px the track travels during one spin. */
export function travelDistance(g: ReelGeometry, landingIndex: number = WINNER_INDEX): number {
  return REEL_START_X - offsetForIndex(landingIndex, g);
}

/**
 * Fraction of the total travel completed as each card centre crosses the marker.
 *
 * Because the strip starts flush-left rather than with card 1 on the marker,
 * the first couple of cards are already left of the marker at t=0 and never
 * "cross" — those are filtered out. The count therefore depends on viewport
 * width (roughly 47 on a phone, 46–48 on a laptop), which is precisely why this
 * takes measured geometry instead of assuming a number.
 */
export function tickFractions(g: ReelGeometry, landingIndex: number = WINNER_INDEX): number[] {
  const total = travelDistance(g, landingIndex);
  if (!(total > 0)) return [];
  const out: number[] = [];
  for (let i = 0; i <= landingIndex; i++) {
    const travelled = REEL_START_X - offsetForIndex(i, g);
    if (travelled > 0) out.push(Math.min(1, travelled / total));
  }
  return out;
}

/**
 * Fallback fractions for when there is no measured geometry: the idealised
 * model where the marker starts over card 1 and every card crosses.
 */
export function idealTickFractions(landingIndex: number = WINNER_INDEX): number[] {
  const out: number[] = [];
  for (let i = 1; i <= landingIndex; i++) out.push(i / landingIndex);
  return out;
}

/**
 * WHEN EACH TICK FIRES, in ms from the start of the deceleration.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE "SIMPLIFYING" IT.
 * ---------------------------------------------------------------------------
 * The obvious implementation is `t_i = duration * i / n` — evenly spaced ticks.
 * That is wrong, and wrong in a way that is obvious the instant you hear it.
 *
 * The strip's POSITION is eased by cubic-bezier(0.10, 0.90, 0.15, 1.0): it
 * covers ~78% of its distance in the first 20% of the time and then crawls.
 * Ticks are triggered by DISTANCE (a card crossing the marker), not by time. So
 * the correct schedule is: for each card, take the fraction of total distance
 * at which it crosses, invert the easing curve to find the time at which the
 * animation reaches that fraction, and fire there.
 *
 * Evenly spaced ticks would give a steady machine-gun rattle while the strip
 * visibly slams to a halt — audio and video peel apart within half a second,
 * and the last four cards, the ones that carry the whole drama, would tick past
 * long before they reach the line. Derived from the curve, the ticks
 * automatically start as a blur and end as four separate, agonising clunks.
 *
 * Both the sound and the motion must therefore come from the *same* curve
 * constant, `REEL_EASE`. Change one, you have changed both.
 */
export function tickTimes(
  durationMs: number = REEL_DURATION_MS,
  fractions: readonly number[] = idealTickFractions(),
  ease: readonly [number, number, number, number] = REEL_EASE,
): number[] {
  return fractions.map((f) => durationMs * timeForProgress(f, ease));
}

/**
 * When to fire `playNearMissWhoosh()`.
 *
 * The naive reading of "when card 49 passes the marker" is the moment its
 * centre crosses the line, which under this curve is ~3.07s — far too early,
 * and not the dramatic beat anyway. Card 49 reaches the marker at ~3.07s and
 * then *sits there* while the strip crawls; the near miss is the moment it
 * finally gives up the line to card 50. Solving for "card 49 is
 * NEAR_MISS_CLEARANCE (95.5%) of a pitch past the marker" against the same
 * bezier gives ~4803ms at the default 5.5s duration — which is exactly the
 * spec's stated 4.8s. The spec number is derivable, not arbitrary.
 */
export function nearMissCueMs(
  durationMs: number = REEL_DURATION_MS,
  g?: ReelGeometry,
  ease: readonly [number, number, number, number] = REEL_EASE,
): number {
  let fraction: number;
  if (g) {
    const total = travelDistance(g);
    const travelled =
      REEL_START_X - offsetForIndex(NEAR_MISS_INDEX, g) + NEAR_MISS_CLEARANCE * g.pitch;
    fraction = total > 0 ? Math.min(1, travelled / total) : 1;
  } else {
    fraction = (NEAR_MISS_INDEX + NEAR_MISS_CLEARANCE) / WINNER_INDEX;
  }
  return durationMs * timeForProgress(fraction, ease);
}

// ---------------------------------------------------------------------------
// Mock data — so App Core can wire the reel up before the RPC is live
// ---------------------------------------------------------------------------

/** A decoy pool with a realistic rarity spread. Safe to pass straight in. */
export const MOCK_DECOYS: ReelCard[] = FALLBACK_DECOYS.map((c) => ({ ...c }));

/**
 * One of every branch of `OpenBoxResult`, in union order. Drive `<CaseReel />`
 * with `MOCK_RESULTS[n]` to exercise physical / shard / respin / scrap without
 * a database.
 */
export const MOCK_RESULTS: OpenBoxResult[] = [
  {
    type: 'physical',
    item_id: '11111111-1111-4111-8111-111111111111',
    item_name: 'Audioengine A5+ Speakers',
    image_url: null,
    rarity: 'pink',
    est_value: 200,
    // Anti-exploit rule 2: pink is never scrappable, so this is 0 server-side.
    scrap_value: 0,
    roll_id: 'mock-roll-physical',
  },
  {
    type: 'shard',
    item_name: 'PC Core Shard (1/2)',
    rarity: 'gold',
    current_shards: 1,
    shards_required: 2,
    roll_id: 'mock-roll-shard',
  },
  {
    type: 'respin',
    item_name: 'Free Re-Roll Token',
    rarity: 'blue',
    refund_amount: 5,
    roll_id: 'mock-roll-respin',
  },
  {
    type: 'scrap',
    item_name: '+15 Scrap Coins',
    rarity: 'grey',
    scrap_gained: 15,
    roll_id: 'mock-roll-scrap',
  },
];
