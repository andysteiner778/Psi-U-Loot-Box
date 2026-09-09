/**
 * WHAT A CLEARANCE ITEM COSTS
 *
 * One definition, used by the buy route, the custom-box spin route and the
 * clearance UI. Three copies of a price is how a screen ends up quoting a
 * number the server does not charge — which has already happened here with the
 * scrap coin (four copies) and the box price.
 *
 * The rule: an item never sells below HALF ITS RETAIL, even when the value the
 * owner typed is lower. Most of the catalogue is deliberately priced at $0.01
 * to be given away in boxes, but a direct buy-now is not a box — it is someone
 * choosing exactly the thing they want, and handing over a $40 mouse for a cent
 * because its box value is a cent is not a sale, it is a giveaway with extra
 * steps.
 *
 * Whichever is HIGHER wins, so an item the owner has deliberately priced ABOVE
 * half its retail keeps that price.
 */

/** The fraction of retail an item may never be sold below. */
export const CLEARANCE_RETAIL_FLOOR = 0.5;

export interface ClearancePriceable {
  est_value: number | string;
  msrp?: number | string | null;
}

export function clearanceUnitPrice(
  item: ClearancePriceable,
  retailFloor: number = CLEARANCE_RETAIL_FLOOR
): number {
  const est = Number(item.est_value) || 0;
  const retail = Number(item.msrp ?? 0) || 0;
  const floor = retail * retailFloor;
  // Round to the cent AFTER taking the max, or the two sides can disagree by a
  // rounding step and the UI quotes a price the charge rejects.
  return Math.round(Math.max(est, floor) * 100) / 100;
}
