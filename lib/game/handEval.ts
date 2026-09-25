import { Card, rankValue, suitOf } from './cards';

// Hand-category ranks, high = better.
export enum HandCategory {
  HighCard = 0,
  Pair = 1,
  TwoPair = 2,
  Trips = 3,
  Straight = 4,
  Flush = 5,
  FullHouse = 6,
  Quads = 7,
  StraightFlush = 8,
}

export const CATEGORY_NAME: Record<HandCategory, string> = {
  [HandCategory.HighCard]: 'High Card',
  [HandCategory.Pair]: 'Pair',
  [HandCategory.TwoPair]: 'Two Pair',
  [HandCategory.Trips]: 'Three of a Kind',
  [HandCategory.Straight]: 'Straight',
  [HandCategory.Flush]: 'Flush',
  [HandCategory.FullHouse]: 'Full House',
  [HandCategory.Quads]: 'Four of a Kind',
  [HandCategory.StraightFlush]: 'Straight Flush',
};

/**
 * A hand's strength as a comparable score: [category, ...tiebreakers].
 * Compare two scores lexicographically; larger wins.
 */
export type HandScore = {
  category: HandCategory;
  ranks: number[]; // tiebreak kickers, most significant first
  cards: Card[]; // the exact 5 cards making the hand
};

export function compareScore(a: HandScore, b: HandScore): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.ranks.length, b.ranks.length);
  for (let i = 0; i < len; i++) {
    const av = a.ranks[i] ?? 0;
    const bv = b.ranks[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

/** Evaluate exactly five cards. */
export function eval5(cards: Card[]): HandScore {
  if (cards.length !== 5) throw new Error(`eval5 expects 5 cards, got ${cards.length}`);

  const vals = cards.map(rankValue).sort((a, b) => b - a); // desc
  const suits = cards.map(suitOf);
  const isFlush = suits.every((s) => s === suits[0]);

  // Count rank multiplicities.
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  // Sort ranks by (count desc, rank desc) — this is the natural kicker order.
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const countPattern = byCount.map(([, c]) => c); // e.g. [3,2] full house

  const straightHigh = straightHighCard(vals);

  if (isFlush && straightHigh) {
    return { category: HandCategory.StraightFlush, ranks: [straightHigh], cards };
  }
  if (countPattern[0] === 4) {
    return { category: HandCategory.Quads, ranks: byCount.map(([r]) => r), cards };
  }
  if (countPattern[0] === 3 && countPattern[1] === 2) {
    return { category: HandCategory.FullHouse, ranks: byCount.map(([r]) => r), cards };
  }
  if (isFlush) {
    return { category: HandCategory.Flush, ranks: vals, cards };
  }
  if (straightHigh) {
    return { category: HandCategory.Straight, ranks: [straightHigh], cards };
  }
  if (countPattern[0] === 3) {
    return { category: HandCategory.Trips, ranks: byCount.map(([r]) => r), cards };
  }
  if (countPattern[0] === 2 && countPattern[1] === 2) {
    return { category: HandCategory.TwoPair, ranks: byCount.map(([r]) => r), cards };
  }
  if (countPattern[0] === 2) {
    return { category: HandCategory.Pair, ranks: byCount.map(([r]) => r), cards };
  }
  return { category: HandCategory.HighCard, ranks: vals, cards };
}

/**
 * If the five distinct ranks form a straight, return its high card value.
 * Handles the wheel (A-2-3-4-5), whose high card is the 5.
 */
function straightHighCard(descVals: number[]): number | null {
  const uniq = [...new Set(descVals)];
  if (uniq.length !== 5) return null;
  if (uniq[0] - uniq[4] === 4) return uniq[0];
  // Wheel: A,5,4,3,2 -> treated as 5-high straight.
  if (uniq[0] === 14 && uniq[1] === 5 && uniq[2] === 4 && uniq[3] === 3 && uniq[4] === 2) {
    return 5;
  }
  return null;
}

function* combinations<T>(arr: T[], k: number): Generator<T[]> {
  const n = arr.length;
  if (k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx.map((i) => arr[i]);
    let i = k - 1;
    while (i >= 0 && idx[i] === i + n - k) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** Best 5-card hand from any 5+ cards (Texas Hold'em: hole + board). */
export function bestOfMany(cards: Card[]): HandScore {
  if (cards.length < 5) throw new Error('need at least 5 cards');
  let best: HandScore | null = null;
  for (const combo of combinations(cards, 5)) {
    const s = eval5(combo);
    if (!best || compareScore(s, best) > 0) best = s;
  }
  return best!;
}

/**
 * Omaha rule: use *exactly two* of the four hole cards plus *exactly three*
 * of the five board cards.
 */
export function bestOmaha(hole: Card[], board: Card[]): HandScore {
  if (hole.length < 2 || board.length < 3) throw new Error('omaha needs 2 hole + 3 board');
  let best: HandScore | null = null;
  for (const h2 of combinations(hole, 2)) {
    for (const b3 of combinations(board, 3)) {
      const s = eval5([...h2, ...b3]);
      if (!best || compareScore(s, best) > 0) best = s;
    }
  }
  return best!;
}

export type Variant = 'holdem' | 'omaha';

/** Evaluate a player's hole cards against the board for the given variant. */
export function evaluateHand(variant: Variant, hole: Card[], board: Card[]): HandScore {
  if (variant === 'omaha') return bestOmaha(hole, board);
  return bestOfMany([...hole, ...board]);
}

export function describeScore(score: HandScore): string {
  return CATEGORY_NAME[score.category];
}
