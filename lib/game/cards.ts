// Pure card model — no React Native imports so this runs under Vitest in Node.

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

/** A card is encoded as a two-char string, e.g. "As", "Td", "2c". */
export type Card = string;

/** Numeric rank value, 2..14 (Ace high). */
export function rankValue(card: Card): number {
  return RANKS.indexOf(card[0] as Rank) + 2;
}

export function suitOf(card: Card): Suit {
  return card[1] as Suit;
}

/** A fresh, ordered 52-card deck. */
export function fullDeck(): Card[] {
  const deck: Card[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/**
 * Deterministic shuffle driven by an injectable RNG so tests can seed it.
 * Fisher–Yates. `rng()` must return a float in [0, 1).
 */
export function shuffle(deck: Card[], rng: () => number = Math.random): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Mulberry32 — a tiny seedable PRNG, handy for reproducible deals/tests. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SUIT_SYMBOL: Record<Suit, string> = { c: '♣', d: '♦', h: '♥', s: '♠' };

/** Human-facing rendering, e.g. "A♠". */
export function formatCard(card: Card): string {
  return card[0] + SUIT_SYMBOL[suitOf(card)];
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'd' || suit === 'h';
}
