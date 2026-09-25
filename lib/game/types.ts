import { Card } from './cards';
import { Variant } from './handEval';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type BettingLimit = 'no-limit' | 'pot-limit';

export interface PlayerConfig {
  id: string;
  name: string;
  stack: number;
  /** Human on this device vs a stub/remote opponent — UI + turn-passing only. */
  isHero?: boolean;
}

export interface Player {
  id: string;
  name: string;
  isHero: boolean;
  stack: number;
  hole: Card[];
  /** Chips put in on the current street. */
  streetCommitted: number;
  /** Chips put in across the whole hand (drives side-pot math). */
  handCommitted: number;
  folded: boolean;
  allIn: boolean;
  /** Has this player acted since the last bet/raise on this street? */
  hasActed: boolean;
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise';

export interface Action {
  type: ActionType;
  /** For `raise`: the total amount this player is betting *to* on this street. */
  amount?: number;
  /** Attribution — which player took the action (defaults to the to-act seat). */
  playerId?: string;
}

export interface HandConfig {
  variant: Variant;
  limit: BettingLimit;
  smallBlind: number;
  bigBlind: number;
}

export interface Pot {
  amount: number;
  /** Player ids eligible to win this (side) pot. */
  eligible: string[];
  /** Who was paid this pot after showdown (or the leftover player on a fold). */
  awardedTo?: string[];
}

export interface ShowdownEntry {
  playerId: string;
  handName: string;
  cards: Card[];
}

export interface HandResult {
  /** playerId -> chips won from the pots (gross, before subtracting their own bets). */
  winnings: Record<string, number>;
  /** playerId -> stack change this hand (winnings minus chips they put in). */
  net: Record<string, number>;
  pots: Pot[];
  showdown: ShowdownEntry[];
  /** True when everyone folded to one player (no cards shown). */
  wonByFold: boolean;
}

export interface GameState {
  config: HandConfig;
  players: Player[];
  /** Undealt cards, in deal order. */
  deck: Card[];
  board: Card[];
  buttonIndex: number;
  street: Street;
  /** Highest street-committed amount any player has posted this street. */
  currentBet: number;
  /** Size of the last full raise increment (for min-raise enforcement). */
  lastRaiseSize: number;
  /** Seat index to act, or null when the street/hand is settled. */
  toAct: number | null;
  result?: HandResult;
  /** Human-readable log of every action, for the hand history. */
  log: string[];
}

/** What the to-act player may legally do right now. */
export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  /** Chips required to call (0 when checking is free). Capped at stack (all-in). */
  callAmount: number;
  canRaise: boolean;
  /** Smallest legal total to raise *to*. */
  minRaiseTo: number;
  /** Largest legal total to raise *to* (all-in, or the pot cap in pot-limit). */
  maxRaiseTo: number;
}
