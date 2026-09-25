"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { decide, evaluate } from "@/lib/api";
import { handEvalEnabled } from "@/lib/flags";
import {
  applyAction,
  formatCard,
  isHandOver,
  isRedSuit,
  legalActions,
  startHand,
  suitOf,
  totalPot,
  type Action,
  type GameState,
} from "@/lib/game";
import type { Decision } from "@/lib/review";
import { STREETS } from "@/lib/review";
import {
  actionFromResponse,
  selectedFromAction,
  snapshotFromState,
  type Taken,
} from "@/lib/snapshot";
import { CHIPS_PER_BB, START_STACK_CHIPS, formatBb, formatChipsAsBb, formatEv } from "@/lib/units";

const SEATS = 9;
const HERO = 0;
const POS = ["BTN", "SB", "BB", "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO"] as const;

function positionOf(seat: number, button: number) {
  return POS[(seat - button + SEATS) % SEATS];
}

function describeAction(action: Action, paid?: number) {
  if (action.type === "raise") return `raise ${formatChipsAsBb(action.amount ?? 0)}`;
  if (action.type === "call") return `call ${formatChipsAsBb(paid ?? 0)}`;
  return action.type;
}

function CardView({ card, hidden }: { card?: string; hidden?: boolean }) {
  if (hidden || !card) {
    return <span className="card-back inline-block h-11 w-8 rounded-[5px] border border-slate-700" />;
  }
  const red = isRedSuit(suitOf(card));
  return (
    <span
      className={`card-face inline-flex h-11 w-8 items-center justify-center rounded-[5px] border border-black/10 text-[13px] font-semibold ${
        red ? "text-red-600" : "text-neutral-900"
      }`}
    >
      {formatCard(card)}
    </span>
  );
}

function seatStyle(seat: number): CSSProperties {
  const angle = (seat / SEATS) * Math.PI * 2 + Math.PI / 2;
  const x = 50 + Math.cos(angle) * 42;
  const y = 50 + Math.sin(angle) * 38;
  return { left: `${x}%`, top: `${y}%` };
}

export default function Page() {
  const [stacks, setStacks] = useState(() => Array.from({ length: SEATS }, () => START_STACK_CHIPS));
  const [button, setButton] = useState(8);
  const [hand, setHand] = useState(0);
  const [state, setState] = useState<GameState | null>(null);
  const [taken, setTaken] = useState<Taken[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [lastActs, setLastActs] = useState<string[]>(() => Array(SEATS).fill(""));
  const [thinking, setThinking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewDone, setReviewDone] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Deal a 9-max hand. Eight seats are the agent.");
  const tokenRef = useRef(token);
  tokenRef.current = token;
  const runRef = useRef(0);
  const nextDecisionId = useRef(0);

  const legal = state && state.toAct !== null ? legalActions(state) : null;
  const heroToAct = Boolean(state && state.toAct === HERO && !isHandOver(state));
  const over = Boolean(state && isHandOver(state));

  const deal = useCallback(() => {
    if (!tokenRef.current.trim()) {
      setStatus("A Studio token is required.");
      return;
    }
    runRef.current += 1;
    nextDecisionId.current = 0;
    const next = startHand(
      { variant: "holdem", limit: "no-limit", smallBlind: CHIPS_PER_BB / 2, bigBlind: CHIPS_PER_BB },
      stacks.map((stack, i) => ({
        id: String(i),
        name: i === HERO ? "You" : `Agent ${i}`,
        stack: Math.max(stack, CHIPS_PER_BB),
        isHero: i === HERO,
      })),
      button,
    );
    setState(next);
    setTaken([]);
    setDecisions([]);
    setLastActs(Array(SEATS).fill(""));
    setReviewing(false);
    setReviewDone(0);
    setReviewOpen(false);
    setStatus("Hand dealt.");
  }, [stacks, button]);

  const finish = useCallback((next: GameState) => {
    if (!next.result) return;
    setStacks(next.players.map((p) => p.stack));
    setButton((b) => (b + 1) % SEATS);
    const heroNet = next.result.net["0"] ?? 0;
    setStatus(heroNet >= 0 ? `You win ${formatChipsAsBb(heroNet)}.` : `You lose ${formatChipsAsBb(-heroNet)}.`);
  }, []);

  const apply = useCallback(
    (prev: GameState, action: Action, seat: number, alreadyTaken: Taken[]) => {
      const legalNow = legalActions(prev);
      const before = prev.players[seat];
      const next = applyAction(prev, action);
      const after = next.players[seat];
      const paid = after.handCommitted - before.handCommitted;
      const record: Taken = {
        seat,
        street: prev.street,
        action,
        amountTo: action.type === "raise" ? action.amount : undefined,
        paid,
        allIn: after.allIn,
      };
      const label = describeAction(action, paid);
      const decision: Decision = {
        id: nextDecisionId.current++,
        seat,
        street: prev.street,
        position: positionOf(seat, prev.buttonIndex),
        name: seat === HERO ? "You" : `Agent ${seat}`,
        isHero: seat === HERO,
        action,
        label,
        snapshot: snapshotFromState(prev, seat, legalNow, alreadyTaken),
        selected: selectedFromAction(action),
      };
      setLastActs((cur) => {
        const copy = [...cur];
        copy[seat] = label;
        return copy;
      });
      setTaken([...alreadyTaken, record]);
      setDecisions((cur) => [...cur, decision]);
      setState(next);
      if (isHandOver(next)) finish(next);
      return { next, taken: [...alreadyTaken, record] };
    },
    [finish],
  );

  useEffect(() => {
    if (!state || isHandOver(state) || state.toAct === null || state.toAct === HERO) {
      setThinking(null);
      setBusy(false);
      return;
    }
    if (!tokenRef.current.trim()) {
      setThinking(null);
      setBusy(false);
      setStatus("A Studio token is required.");
      return;
    }
    const seat = state.toAct;
    const run = runRef.current;
    const legalNow = legalActions(state);
    setThinking(seat);
    setBusy(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await decide(snapshotFromState(state, seat, legalNow, taken), tokenRef.current);
        if (run !== runRef.current) return;
        apply(state, actionFromResponse(res.action, res.amount, legalNow), seat, taken);
      } catch (err) {
        if (run !== runRef.current) return;
        const fallback: Action = legalNow.canCheck ? { type: "check" } : { type: "fold" };
        apply(state, fallback, seat, taken);
        setStatus((err as Error).message);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [state, taken, apply, token]);

  useEffect(() => {
    if (!handEvalEnabled || !state || !isHandOver(state) || decisions.length === 0) return;
    const queue = decisions.filter((d) => d.isHero);
    if (queue.length === 0) return;
    const run = runRef.current;
    let cancelled = false;
    setReviewOpen(true);
    setReviewing(true);
    setReviewDone(0);
    void (async () => {
      for (let i = 0; i < queue.length; i++) {
        if (cancelled || run !== runRef.current) return;
        const d = queue[i];
        try {
          const got = await evaluate(
            { ...d.snapshot, selected: d.selected, iters: 12 },
            tokenRef.current,
          );
          if (run !== runRef.current) return;
          setDecisions((cur) => cur.map((x) => (x.id === d.id ? { ...x, ev: got } : x)));
        } catch (err) {
          if (run !== runRef.current) return;
          const timedOut = err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError");
          setDecisions((cur) =>
            cur.map((x) =>
              x.id === d.id ? { ...x, evError: timedOut ? "evaluate timed out" : (err as Error).message } : x,
            ),
          );
        }
        setReviewDone(i + 1);
      }
      if (run === runRef.current) setReviewing(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [state, decisions.length]);

  const heroAct = (action: Action) => {
    if (!state || state.toAct !== HERO) return;
    apply(state, action, HERO, taken);
  };

  const pot = state ? totalPot(state) : 0;
  const board = state?.board ?? [];

  const raiseTo = useMemo(() => {
    if (!legal?.canRaise) return [];
    const potRaise = Math.min(legal.maxRaiseTo, legal.minRaiseTo + pot);
    const sizes = [legal.minRaiseTo, potRaise, legal.maxRaiseTo];
    return [...new Set(sizes)].filter((n) => n >= legal.minRaiseTo && n <= legal.maxRaiseTo);
  }, [legal, pot]);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-5 px-4 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-emerald-300/80">Play vs Agent</p>
          <h1 className="text-2xl font-semibold tracking-tight">9-max NLHE</h1>
          <p className="mt-1 max-w-xl text-sm text-emerald-100/70">
            Amounts are big blinds. Villains call{" "}
            <code className="text-emerald-200">POST /api/play/decide</code>.
            {handEvalEnabled && (
              <>
                {" "}
                After the hand, your decisions are scored with{" "}
                <code className="text-emerald-200">POST /api/play/evaluate</code>.
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Studio token"
            className="h-9 w-56 rounded-md border border-white/10 bg-black/30 px-3 text-sm outline-none placeholder:text-white/30"
          />
          <button
            type="button"
            disabled={!token.trim()}
            onClick={() => {
              setHand((n) => n + 1);
              deal();
            }}
            className="h-9 rounded-md bg-emerald-400 px-4 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {state ? "Next hand" : "Deal"}
          </button>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <section className="table-felt relative min-h-[540px] w-full overflow-hidden rounded-[46%]">
          <div className="absolute left-1/2 top-[42%] w-56 -translate-x-1/2 -translate-y-1/2 text-center">
            <p className="text-[11px] uppercase tracking-wider text-emerald-100/60">
              Pot {formatChipsAsBb(pot)}
            </p>
            <div className="mt-2 flex justify-center gap-1">
              {board.length === 0 ? (
                <span className="text-sm text-emerald-100/40">Preflop</span>
              ) : (
                board.map((c) => <CardView key={c} card={c} />)
              )}
            </div>
            <p className="mt-3 text-xs text-emerald-50/80">{status}</p>
          </div>

          {Array.from({ length: SEATS }, (_, seat) => {
            const player = state?.players[seat];
            const acting = state?.toAct === seat && !over;
            const showCards = Boolean(player && (seat === HERO || over || player.folded));
            return (
              <div
                key={seat}
                style={seatStyle(seat)}
                className="absolute w-36 -translate-x-1/2 -translate-y-1/2 text-center"
              >
                <div
                  className={`rounded-2xl border px-2 py-2 ${
                    acting
                      ? "border-amber-300 bg-amber-300/15"
                      : "border-white/10 bg-black/35"
                  }`}
                >
                  <div className="flex justify-center gap-1">
                    {player ? (
                      player.folded ? (
                        <span className="text-xs text-white/40">Fold</span>
                      ) : (
                        <>
                          <CardView card={player.hole[0]} hidden={!showCards} />
                          <CardView card={player.hole[1]} hidden={!showCards} />
                        </>
                      )
                    ) : (
                      <>
                        <CardView hidden />
                        <CardView hidden />
                      </>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] font-medium">
                    {seat === HERO ? "You" : `Agent ${seat}`} · {positionOf(seat, state?.buttonIndex ?? button)}
                  </p>
                  <p className="text-[11px] text-emerald-100/70">
                    {formatChipsAsBb(player?.stack ?? stacks[seat])}
                    {thinking === seat ? " · thinking" : lastActs[seat] ? ` · ${lastActs[seat]}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </section>

        <aside className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="mt-auto space-y-2">
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-300/70">Your action</p>
            {heroToAct && legal ? (
              <div className="flex flex-wrap gap-2">
                {legal.canFold && !legal.canCheck && (
                  <Act onClick={() => heroAct({ type: "fold" })}>Fold</Act>
                )}
                {legal.canCheck && <Act onClick={() => heroAct({ type: "check" })}>Check</Act>}
                {legal.callAmount > 0 && (
                  <Act onClick={() => heroAct({ type: "call" })}>
                    Call {formatChipsAsBb(legal.callAmount)}
                  </Act>
                )}
                {raiseTo.map((amt) => (
                  <Act key={amt} onClick={() => heroAct({ type: "raise", amount: amt })}>
                    {amt >= (legal.maxRaiseTo ?? 0)
                      ? `All-in ${formatChipsAsBb(amt)}`
                      : `Raise ${formatChipsAsBb(amt)}`}
                  </Act>
                ))}
              </div>
            ) : (
              <p className="text-sm text-white/45">
                {over ? "Hand over." : busy ? "Agents acting…" : "Deal to start."}
              </p>
            )}
          </div>
        </aside>
      </div>

      {handEvalEnabled && reviewOpen && (
        <ReviewModal
          decisions={decisions.filter((d) => d.isHero)}
          reviewing={reviewing}
          done={reviewDone}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {decisions.length > 0 && state && (
        <HandHistory decisions={decisions} button={state.buttonIndex} />
      )}

      <p className="text-center text-xs text-white/35">
        Hand {hand || 0} · 100bb · example client for{" "}
        <a className="underline" href="https://www.pokerstudy.ai/docs#play-vs-agent">
          pokerstudy.ai/docs
        </a>
      </p>
    </main>
  );
}

function ReviewModal({
  decisions,
  reviewing,
  done,
  onClose,
}: {
  decisions: Decision[];
  reviewing: boolean;
  done: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-neutral-950 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-300/70">Expected value</p>
            <h2 className="text-lg font-semibold">Your decisions</h2>
            <p className="mt-1 text-sm text-white/55">
              {reviewing
                ? `Evaluating ${done}/${decisions.length}…`
                : "Scored after the hand. Villain actions are not priced."}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-white/50">
            Close
          </button>
        </div>
        <ol className="flex flex-col gap-3">
          {decisions.map((d) => (
            <li key={d.id} className="rounded-lg border border-amber-300/30 bg-amber-300/5 px-3 py-2">
              <p className="text-sm">
                <span className="text-white/55">{d.position}</span> {d.label}
              </p>
              <DecisionEv d={d} pending={reviewing && !d.ev && !d.evError} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function HandHistory({
  decisions,
  button,
}: {
  decisions: Decision[];
  button: number;
}) {
  const sb = (button + 1) % SEATS;
  const bb = (button + 2) % SEATS;
  return (
    <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <div className="mb-3">
        <p className="text-xs uppercase tracking-[0.16em] text-emerald-300/70">Hand history</p>
        <h2 className="text-lg font-semibold">Action</h2>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-emerald-200/70">blinds</p>
          <p className="text-sm text-white/70">
            SB {sb === HERO ? "You" : `Agent ${sb}`} posts {formatBb(0.5)}
            <span className="text-white/35"> · </span>
            BB {bb === HERO ? "You" : `Agent ${bb}`} posts {formatBb(1)}
          </p>
        </div>
        {STREETS.map((street) => {
          const rows = decisions.filter((d) => d.street === street);
          if (rows.length === 0) return null;
          return (
            <div key={street}>
              <p className="mb-2 text-xs uppercase tracking-[0.16em] text-emerald-200/70">{street}</p>
              <ol className="flex flex-col gap-2">
                {rows.map((d) => (
                  <li
                    key={d.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      d.isHero ? "border-amber-300/30 bg-amber-300/5" : "border-white/10 bg-black/20"
                    }`}
                  >
                    <span className="text-white/55">{d.position}</span>{" "}
                    <span className="font-medium">{d.name}</span>{" "}
                    <span>{d.label}</span>
                  </li>
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function DecisionEv({ d, pending }: { d: Decision; pending: boolean }) {
  if (d.evError) return <p className="text-red-300">{d.evError}</p>;
  if (!d.ev) {
    return <p className="mt-1 text-sm text-white/40">{pending ? "Evaluating…" : "Waiting"}</p>;
  }
  const taken = `${d.ev.selected.action}${d.ev.selected.amount != null ? ` ${formatBb(d.ev.selected.amount)}` : ""}`;
  const bot = `${d.ev.bot.action}${d.ev.bot.amount != null ? ` ${formatBb(d.ev.bot.amount)}` : ""}`;
  return (
    <p className="text-white/70">
      <span className={d.ev.selected.ev >= 0 ? "text-emerald-300" : "text-red-300"}>
        {taken} {formatEv(d.ev.selected.ev)}
      </span>
      <span className="text-white/35"> · </span>
      <span>
        agent {bot} {formatEv(d.ev.bot.ev)}
      </span>
      <span className="text-white/35"> · {(d.ev.equity * 100).toFixed(0)}% eq</span>
    </p>
  );
}

function Act({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20"
    >
      {children}
    </button>
  );
}
