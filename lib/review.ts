import type { ActionName, DecideRequest, EvaluateResponse } from "@/lib/api";
import type { Action } from "@/lib/game";

export interface Decision {
  id: number;
  seat: number;
  street: string;
  position: string;
  name: string;
  isHero: boolean;
  action: Action;
  label: string;
  snapshot: DecideRequest;
  selected: { action: ActionName; amount?: number };
  ev?: EvaluateResponse;
  evError?: string;
}

export const STREETS = ["preflop", "flop", "turn", "river"] as const;
