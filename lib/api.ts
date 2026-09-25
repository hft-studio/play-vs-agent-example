export type ActionName = "fold" | "check" | "call" | "raise" | "bet" | "all_in";

export interface ValidAction {
  action: ActionName;
  amount?: number;
  min?: number;
  max?: number;
}

export interface HistoryAction {
  seat: number;
  action: ActionName;
  amount?: number | null;
}

export interface DecideRequest {
  hole: string[];
  board: string[];
  pot: number;
  big_blind: number;
  my_seat: number;
  dealer_seat: number;
  seats: number[];
  in_hand: number[];
  players: { seat: number; stack: number }[];
  valid_actions: ValidAction[];
  preflop_actions?: HistoryAction[];
  postflop_actions?: HistoryAction[];
  selected?: { action: ActionName; amount?: number };
  iters?: number;
}

export interface DecideResponse {
  action: ActionName;
  amount: number | null;
  source: string;
  position?: string;
}

export interface EvaluateResponse {
  equity: number;
  model: string;
  iters: number;
  opponents: number;
  selected: { action: ActionName; amount: number | null; ev: number };
  bot: {
    action: ActionName;
    amount: number | null;
    ev: number;
    source: string;
    position?: string;
  };
}

export class PlayApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "PlayApiError";
  }
}

async function post<T>(path: string, body: unknown, token?: string | null): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new PlayApiError(res.status, `${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : text.slice(0, 200);
    throw new PlayApiError(res.status, err);
  }
  return parsed as T;
}

export function decide(body: DecideRequest, token?: string | null) {
  return post<DecideResponse>("/api/decide", body, token);
}

export function evaluate(body: DecideRequest, token?: string | null) {
  return post<EvaluateResponse>("/api/evaluate", body, token);
}
