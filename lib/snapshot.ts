import type { Action, GameState, LegalActions } from "@/lib/game";
import { totalPot } from "@/lib/game";
import type { ActionName, DecideRequest, HistoryAction, ValidAction } from "@/lib/api";
import { bbToChips, chipsToBb } from "@/lib/units";

export interface Taken {
  seat: number;
  street: string;
  action: Action;
  amountTo?: number;
  paid?: number;
  allIn?: boolean;
}

/** Table snapshot in big blinds — pot, stacks, and sizes use `big_blind: 1`. */
export function snapshotFromState(
  state: GameState,
  seat: number,
  legal: LegalActions,
  taken: readonly Taken[],
): DecideRequest {
  const seats = state.players.map((_, i) => i);
  return {
    hole: [...state.players[seat].hole],
    board: [...state.board],
    pot: chipsToBb(totalPot(state)),
    big_blind: 1,
    my_seat: seat,
    dealer_seat: state.buttonIndex,
    seats,
    in_hand: state.players.flatMap((p, i) => (p.folded ? [] : [i])),
    players: state.players.map((p, i) => ({ seat: i, stack: chipsToBb(p.stack) })),
    valid_actions: validActionsFromLegal(legal),
    preflop_actions: historyOf(taken, "preflop"),
    postflop_actions: state.street === "preflop" ? [] : historyOf(taken, state.street),
  };
}

export function validActionsFromLegal(legal: LegalActions): ValidAction[] {
  const out: ValidAction[] = [];
  if (legal.canFold) out.push({ action: "fold" });
  if (legal.canCheck) out.push({ action: "check" });
  if (legal.callAmount > 0) out.push({ action: "call", amount: chipsToBb(legal.callAmount) });
  if (legal.canRaise) {
    out.push({
      action: "raise",
      min: chipsToBb(legal.minRaiseTo),
      max: chipsToBb(legal.maxRaiseTo),
    });
    if (legal.minRaiseTo >= legal.maxRaiseTo) out.push({ action: "all_in" });
  }
  if (!out.some((a) => a.action === "fold" || a.action === "check")) {
    out.push(legal.canCheck ? { action: "check" } : { action: "fold" });
  }
  return out;
}

export function selectedFromAction(action: Action): { action: ActionName; amount?: number } {
  if (action.type === "raise") {
    return { action: "raise", amount: chipsToBb(action.amount ?? 0) };
  }
  return { action: action.type };
}

/** Map an API action (big blinds) onto engine legal sizes (chips). */
export function actionFromResponse(
  name: ActionName,
  amount: number | null,
  legal: LegalActions,
): Action {
  const chips = amount == null ? null : bbToChips(amount);
  if (name === "check" && legal.canCheck) return { type: "check" };
  if (name === "fold" && !legal.canCheck) return { type: "fold" };
  if (name === "fold" && legal.canCheck) return { type: "check" };
  if (name === "call" && legal.callAmount > 0) return { type: "call" };
  if (name === "call" && legal.canCheck) return { type: "check" };
  if (name === "all_in" && legal.canRaise) {
    return { type: "raise", amount: legal.maxRaiseTo };
  }
  if ((name === "raise" || name === "bet") && legal.canRaise) {
    const raw = chips ?? legal.minRaiseTo;
    const to = Math.max(legal.minRaiseTo, Math.min(raw, legal.maxRaiseTo));
    return { type: "raise", amount: to };
  }
  if (legal.canCheck) return { type: "check" };
  if (legal.callAmount > 0) return { type: "call" };
  return { type: "fold" };
}

function historyOf(taken: readonly Taken[], street: string): HistoryAction[] {
  const out: HistoryAction[] = [];
  for (const t of taken) {
    if (t.street !== street) continue;
    const action = historyActionName(t);
    if (!action) continue;
    const raw =
      t.action.type === "raise" ? (t.amountTo ?? t.action.amount ?? null) : (t.paid ?? null);
    out.push({
      seat: t.seat,
      action,
      amount: raw == null ? null : chipsToBb(raw),
    });
  }
  return out;
}

function historyActionName(t: Taken): ActionName | null {
  switch (t.action.type) {
    case "fold":
      return "fold";
    case "check":
      return "check";
    case "call":
      return "call";
    case "raise":
      return t.allIn ? "all_in" : "raise";
    default:
      return null;
  }
}
