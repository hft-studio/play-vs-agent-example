import { Card, formatCard, fullDeck, shuffle } from './cards';
import { compareScore, describeScore, evaluateHand } from './handEval';
import {
  Action,
  GameState,
  HandConfig,
  HandResult,
  LegalActions,
  Player,
  PlayerConfig,
  Pot,
  ShowdownEntry,
  Street,
} from './types';

const HOLE_COUNT: Record<HandConfig['variant'], number> = { holdem: 2, omaha: 4 };

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Deal the next card off the top of the deck (mutates state.deck). */
function draw(state: GameState): Card {
  const c = state.deck.shift();
  if (!c) throw new Error('deck exhausted');
  return c;
}

function commit(p: Player, amount: number): number {
  const paid = Math.min(amount, p.stack);
  p.stack -= paid;
  p.streetCommitted += paid;
  p.handCommitted += paid;
  if (p.stack === 0) p.allIn = true;
  return paid;
}

/** Players still in the hand (not folded). */
function livePlayers(state: GameState): Player[] {
  return state.players.filter((p) => !p.folded);
}

/** Players who can still make a betting decision (not folded, not all-in). */
function contestants(state: GameState): Player[] {
  return state.players.filter((p) => !p.folded && !p.allIn);
}

// ---------------------------------------------------------------------------
// Hand setup
// ---------------------------------------------------------------------------

export function startHand(
  config: HandConfig,
  seats: PlayerConfig[],
  buttonIndex: number,
  rng: () => number = Math.random,
): GameState {
  if (seats.length < 2) throw new Error('need at least 2 players');

  const players: Player[] = seats.map((s) => ({
    id: s.id,
    name: s.name,
    isHero: !!s.isHero,
    stack: s.stack,
    hole: [],
    streetCommitted: 0,
    handCommitted: 0,
    folded: false,
    allIn: false,
    hasActed: false,
  }));

  const state: GameState = {
    config,
    players,
    deck: shuffle(fullDeck(), rng),
    board: [],
    buttonIndex: mod(buttonIndex, players.length),
    street: 'preflop',
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    toAct: null,
    log: [],
  };

  const n = players.length;
  // Heads-up: button is the small blind and acts first preflop.
  const sbIndex = n === 2 ? state.buttonIndex : mod(state.buttonIndex + 1, n);
  const bbIndex = n === 2 ? mod(state.buttonIndex + 1, n) : mod(state.buttonIndex + 2, n);

  commit(players[sbIndex], config.smallBlind);
  commit(players[bbIndex], config.bigBlind);
  state.currentBet = config.bigBlind;
  state.log.push(`${players[sbIndex].name} posts SB ${config.smallBlind}`);
  state.log.push(`${players[bbIndex].name} posts BB ${config.bigBlind}`);

  // Deal hole cards one at a time, starting left of the button.
  const holeCount = HOLE_COUNT[config.variant];
  for (let round = 0; round < holeCount; round++) {
    for (let k = 1; k <= n; k++) {
      const idx = mod(state.buttonIndex + k, n);
      players[idx].hole.push(draw(state));
    }
  }

  // First to act preflop is left of the big blind (button in heads-up).
  const firstToAct = mod(bbIndex + 1, n);
  state.toAct = firstToAct;
  return state;
}

// ---------------------------------------------------------------------------
// Legality
// ---------------------------------------------------------------------------

export function legalActions(state: GameState): LegalActions {
  if (state.toAct === null) {
    return { canFold: false, canCheck: false, callAmount: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0 };
  }
  const p = state.players[state.toAct];
  const owed = state.currentBet - p.streetCommitted;
  const callAmount = Math.min(owed, p.stack);
  const canCheck = owed <= 0;

  const allInTo = p.streetCommitted + p.stack;
  let maxRaiseTo: number;
  if (state.config.limit === 'pot-limit') {
    const totalOnTable = state.players.reduce((sum, q) => sum + q.handCommitted, 0);
    const potRaiseTo = state.currentBet + totalOnTable + owed;
    maxRaiseTo = Math.min(potRaiseTo, allInTo);
  } else {
    maxRaiseTo = allInTo; // no-limit: shove
  }

  // Smallest legal raise-to; a bet (currentBet === 0) opens at one big blind.
  const openSize = state.currentBet === 0 ? state.config.bigBlind : state.lastRaiseSize;
  let minRaiseTo = state.currentBet + openSize;
  if (minRaiseTo > allInTo) minRaiseTo = allInTo; // short stack can only shove

  const moreThanOneCanAct = contestants(state).length + (p.allIn ? 0 : 0) > 1;
  const canRaise = p.stack > Math.max(owed, 0) && maxRaiseTo > state.currentBet && moreThanOneCanAct;

  return {
    canFold: true,
    canCheck,
    callAmount,
    canRaise,
    minRaiseTo,
    maxRaiseTo,
  };
}

// ---------------------------------------------------------------------------
// Applying an action
// ---------------------------------------------------------------------------

export function applyAction(prev: GameState, action: Action): GameState {
  const state = clone(prev);
  if (state.toAct === null) throw new Error('no player to act');
  const i = state.toAct;
  const p = state.players[i];
  const legal = legalActions(state);

  switch (action.type) {
    case 'fold': {
      p.folded = true;
      p.hasActed = true;
      state.log.push(`${p.name} folds`);
      break;
    }
    case 'check': {
      if (!legal.canCheck) throw new Error('cannot check facing a bet');
      p.hasActed = true;
      state.log.push(`${p.name} checks`);
      break;
    }
    case 'call': {
      const paid = commit(p, legal.callAmount);
      p.hasActed = true;
      state.log.push(paid > 0 ? `${p.name} calls ${paid}` : `${p.name} checks`);
      break;
    }
    case 'raise': {
      const to = action.amount ?? 0;
      const isShove = to >= legal.maxRaiseTo;
      if (!legal.canRaise) throw new Error('raising is not allowed here');
      if (!isShove && (to < legal.minRaiseTo || to > legal.maxRaiseTo)) {
        throw new Error(`raise ${to} outside [${legal.minRaiseTo}, ${legal.maxRaiseTo}]`);
      }
      const targetTo = Math.min(to, legal.maxRaiseTo);
      const increment = targetTo - state.currentBet;
      const wasFullRaise = increment >= state.lastRaiseSize;
      const verb = state.currentBet === 0 ? 'bets' : 'raises to';
      commit(p, targetTo - p.streetCommitted);
      if (targetTo > state.currentBet) {
        if (wasFullRaise) state.lastRaiseSize = increment;
        state.currentBet = targetTo;
        // A new (full) raise reopens the action for everyone still live.
        for (const q of state.players) {
          if (!q.folded && !q.allIn && q !== p) q.hasActed = false;
        }
      }
      p.hasActed = true;
      state.log.push(`${p.name} ${verb} ${targetTo}${p.allIn ? ' (all-in)' : ''}`);
      break;
    }
  }

  advance(state);
  return state;
}

/** Find the next seat that still owes a decision, or null if the round is closed. */
function nextToAct(state: GameState, from: number): number | null {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = mod(from + step, n);
    const q = state.players[idx];
    if (q.folded || q.allIn) continue;
    const settled = q.streetCommitted === state.currentBet && q.hasActed;
    if (!settled) return idx;
  }
  return null;
}

function firstToActPostflop(state: GameState): number | null {
  return nextToAct(state, state.buttonIndex);
}

function advance(state: GameState): void {
  // End immediately if everyone else folded.
  if (livePlayers(state).length <= 1) {
    goToShowdownOrEnd(state);
    return;
  }
  const next = state.toAct === null ? null : nextToAct(state, state.toAct);
  if (next !== null) {
    state.toAct = next;
    return;
  }
  // Betting round is complete — advance the street.
  nextStreet(state);
}

function nextStreet(state: GameState): void {
  // Fold-collapse: nobody left to contest.
  if (livePlayers(state).length <= 1) {
    goToShowdownOrEnd(state);
    return;
  }

  // Reset per-street betting fields.
  for (const p of state.players) {
    p.streetCommitted = 0;
    if (!p.folded && !p.allIn) p.hasActed = false;
  }
  state.currentBet = 0;
  state.lastRaiseSize = state.config.bigBlind;

  const order: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const nextIdx = order.indexOf(state.street) + 1;
  const next = order[nextIdx];

  if (next === 'flop') {
    draw(state); // burn
    state.board.push(draw(state), draw(state), draw(state));
  } else if (next === 'turn' || next === 'river') {
    draw(state); // burn
    state.board.push(draw(state));
  }
  state.street = next;
  state.log.push(streetHeader(next, state.board));

  if (next === 'showdown') {
    runShowdown(state);
    return;
  }

  const first = firstToActPostflop(state);
  if (first === null) {
    // Everyone is all-in — no betting possible, run out the rest of the board.
    nextStreet(state);
  } else {
    state.toAct = first;
  }
}

function streetHeader(street: Street, board: Card[]): string {
  const b = board.map(formatCard).join(' ');
  switch (street) {
    case 'flop':
      return `— Flop: ${b}`;
    case 'turn':
      return `— Turn: ${b}`;
    case 'river':
      return `— River: ${b}`;
    default:
      return '— Showdown';
  }
}

// ---------------------------------------------------------------------------
// Pots + showdown
// ---------------------------------------------------------------------------

/** Build main + side pots from every player's total hand contribution. */
export function computePots(players: Player[]): Pot[] {
  const contribs = players
    .map((p) => ({ id: p.id, folded: p.folded, amt: p.handCommitted }))
    .filter((c) => c.amt > 0);

  const levels = [...new Set(contribs.map((c) => c.amt))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    const atLevel = contribs.filter((c) => c.amt >= level);
    const amount = (level - prev) * atLevel.length;
    const eligible = atLevel.filter((c) => !c.folded).map((c) => c.id);
    if (amount > 0 && eligible.length > 0) {
      const last = pots[pots.length - 1];
      // Merge adjacent pots that pay out to the same set of players.
      if (last && sameSet(last.eligible, eligible)) last.amount += amount;
      else pots.push({ amount, eligible });
    } else if (amount > 0) {
      // Everyone in this slice folded (dead money) — fold into previous pot.
      const last = pots[pots.length - 1];
      if (last) last.amount += amount;
    }
    prev = level;
  }
  return pots;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
}

/**
 * Collect all contributed chips out of the pot fields once the hand is settled.
 * After this, `stack` is the single source of truth for each player's chips.
 */
function finalize(state: GameState): void {
  for (const p of state.players) {
    p.streetCommitted = 0;
    p.handCommitted = 0;
  }
  state.street = 'complete';
  state.toAct = null;
}

/** Stack delta per player. Must run before `finalize` zeros `handCommitted`. */
function netFromCommitted(players: Player[], winnings: Record<string, number>): Record<string, number> {
  const net: Record<string, number> = {};
  for (const p of players) {
    net[p.id] = (winnings[p.id] ?? 0) - p.handCommitted;
  }
  return net;
}

function goToShowdownOrEnd(state: GameState): void {
  const live = livePlayers(state);
  if (live.length === 1) {
    // Won without a showdown.
    const pots = computePots(state.players);
    const total = pots.reduce((s, p) => s + p.amount, 0);
    const winner = live[0];
    winner.stack += total;
    const winnings = { [winner.id]: total };
    for (const pot of pots) pot.awardedTo = [winner.id];
    state.result = {
      winnings,
      net: netFromCommitted(state.players, winnings),
      pots,
      showdown: [],
      wonByFold: true,
    };
    state.log.push(`${winner.name} wins ${total} (all others folded)`);
    finalize(state);
    return;
  }
  runShowdown(state);
}

function runShowdown(state: GameState): void {
  const live = livePlayers(state);
  const pots = computePots(state.players);

  const scores = new Map<string, ReturnType<typeof evaluateHand>>();
  const showdown: ShowdownEntry[] = [];
  for (const p of live) {
    const score = evaluateHand(state.config.variant, p.hole, state.board);
    scores.set(p.id, score);
    showdown.push({ playerId: p.id, handName: describeScore(score), cards: score.cards });
  }

  const winnings: Record<string, number> = {};
  for (const pot of pots) {
    const eligible = pot.eligible.filter((id) => scores.has(id));
    if (eligible.length === 0) continue;
    let best = eligible[0];
    for (const id of eligible.slice(1)) {
      if (compareScore(scores.get(id)!, scores.get(best)!) > 0) best = id;
    }
    const winners = eligible.filter((id) => compareScore(scores.get(id)!, scores.get(best)!) === 0);
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    // Award the odd chip(s) to the first eligible winner left of the button.
    const ordered = orderFromButton(state, winners);
    pot.awardedTo = ordered;
    for (const id of ordered) {
      const extra = remainder > 0 ? 1 : 0;
      winnings[id] = (winnings[id] ?? 0) + share + extra;
      remainder -= extra;
    }
  }

  for (const p of state.players) {
    if (winnings[p.id]) p.stack += winnings[p.id];
  }

  const winLog = Object.entries(winnings)
    .map(([id, amt]) => `${state.players.find((p) => p.id === id)!.name} wins ${amt}`)
    .join(', ');

  state.result = {
    winnings,
    net: netFromCommitted(state.players, winnings),
    pots,
    showdown,
    wonByFold: false,
  };
  if (winLog) state.log.push(winLog);
  finalize(state);
}

/**
 * Seats that won a pot someone else was also eligible for. Uncalled chips
 * coming back to a shover (a 1-eligible side pot) are not a win — and must
 * not make the strip say "Splits".
 */
export function contestedWinnerIds(result: HandResult): string[] {
  if (result.wonByFold) {
    return Object.entries(result.winnings)
      .filter(([, amt]) => amt > 0)
      .map(([id]) => id);
  }
  const ids = new Set<string>();
  for (const pot of result.pots) {
    if (pot.eligible.length < 2) continue;
    for (const id of pot.awardedTo ?? []) ids.add(id);
  }
  return [...ids];
}

function orderFromButton(state: GameState, ids: string[]): string[] {
  const n = state.players.length;
  const order: string[] = [];
  for (let k = 1; k <= n; k++) {
    const idx = mod(state.buttonIndex + k, n);
    const id = state.players[idx].id;
    if (ids.includes(id)) order.push(id);
  }
  return order;
}

// ---------------------------------------------------------------------------
// Convenience selectors for the UI
// ---------------------------------------------------------------------------

export function totalPot(state: GameState): number {
  return state.players.reduce((s, p) => s + p.handCommitted, 0);
}

export function isHandOver(state: GameState): boolean {
  return state.street === 'complete';
}

export function playerToAct(state: GameState): Player | null {
  return state.toAct === null ? null : state.players[state.toAct];
}
