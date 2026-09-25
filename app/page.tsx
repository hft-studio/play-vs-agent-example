"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { decide, evaluate, type EvaluateResponse } from "@/lib/api";
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
  const [ev, setEv] = useState<EvaluateResponse | null>(null);
  const [evLoading, setEvLoading] = useState(false);
  const [evError, setEvError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewDone, setReviewDone] = useState(0);
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
    setEv(null);
    setEvError(null);
    setReviewing(false);
    setReviewDone(0);
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
  }, [state, taken, apply]);

  useEffect(() => {
    if (!state || state.toAct !== HERO || isHandOver(state)) {
      setEvLoading(false);
      return;
    }
    const legalNow = legalActions(state);
    const selected = legalNow.canCheck
      ? { action: "check" as const }
      : legalNow.callAmount > 0
        ? { action: "call" as const }
        : { action: "fold" as const };
    const run = runRef.current;
    setEv(null);
    setEvError(null);
    setEvLoading(true);
    evaluate(
      { ...snapshotFromState(state, HERO, legalNow, taken), selected, iters: 16 },
      tokenRef.current,
    )
      .then((got) => {
        if (run !== runRef.current) return;
        setEv(got);
      })
      .catch((err) => {
        if (run !== runRef.current) return;
        setEvError((err as Error).message);
      })
      .finally(() => {
        if (run === runRef.current) setEvLoading(false);
      });
  }, [state, taken]);

  useEffect(() => {
    if (!state || !isHandOver(state) || decisions.length === 0) return;
    const run = runRef.current;
    const queue = [
      ...decisions.filter((d) => d.isHero),
      ...decisions.filter((d) => !d.isHero),
    ];
    let cancelled = false;
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
          setDecisions((cur) =>
            cur.map((x) => (x.id === d.id ? { ...x, evError: (err as Error).message } : x)),
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
            <code className="text-emerald-200">POST /api/play/decide</code>. After the hand,
            each decision is scored with{" "}
            <code className="text-emerald-200">POST /api/play/evaluate</code>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Studio token (optional)"
            className="h-9 w-56 rounded-md border border-white/10 bg-black/30 px-3 text-sm outline-none placeholder:text-white/30"
          />
          <button
            type="button"
            onClick={() => {
              setHand((n) => n + 1);
              deal();
            }}
            className="h-9 rounded-md bg-emerald-400 px-4 text-sm font-semibold text-emerald-950"
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
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-emerald-300/70">Expected value</p>
            <h2 className="text-lg font-semibold">{over ? "Hand review" : "This street"}</h2>
          </div>
          {over ? (
            <p className="text-sm text-white/55">
              {reviewing
                ? `Evaluating ${reviewDone}/${decisions.length} decisions…`
                : decisions.every((d) => d.ev || d.evError)
                  ? "Every decision has an evaluate result."
                  : "History is below. Evaluate runs after the hand."}
            </p>
          ) : (
            <>
              {!heroToAct && !ev && (
                <p className="text-sm text-white/55">
                  On your turn this panel shows equity and EV in big blinds. After the
                  hand we evaluate every decision.
                </p>
              )}
              {evLoading && <p className="text-sm text-amber-200">Running bot-playout…</p>}
              {evError && <p className="text-sm text-red-300">{evError}</p>}
              {ev && <EvBlock ev={ev} />}
            </>
          )}

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

      {decisions.length > 0 && state && (
        <HandHistory
          decisions={decisions}
          reviewing={reviewing}
          done={reviewDone}
          button={state.buttonIndex}
        />
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

function EvBlock({ ev }: { ev: EvaluateResponse }) {
  return (
    <div className="space-y-3 text-sm">
      <Row label="Equity" value={`${(ev.equity * 100).toFixed(1)}%`} />
      <Row
        label={`Taken ${ev.selected.action}${ev.selected.amount != null ? ` ${formatBb(ev.selected.amount)}` : ""}`}
        value={formatEv(ev.selected.ev)}
        tone={ev.selected.ev >= 0 ? "good" : "bad"}
      />
      <Row
        label={`Agent ${ev.bot.action}${ev.bot.amount != null ? ` ${formatBb(ev.bot.amount)}` : ""}`}
        value={formatEv(ev.bot.ev)}
        tone={ev.bot.ev >= 0 ? "good" : "bad"}
      />
      <p className="text-xs text-white/45">
        {ev.bot.source} · {ev.model} · {ev.iters} iters
      </p>
    </div>
  );
}

function HandHistory({
  decisions,
  reviewing,
  done,
  button,
}: {
  decisions: Decision[];
  reviewing: boolean;
  done: number;
  button: number;
}) {
  const sb = (button + 1) % SEATS;
  const bb = (button + 2) % SEATS;
  return (
    <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-emerald-300/70">Hand history</p>
          <h2 className="text-lg font-semibold">Every decision · evaluate</h2>
        </div>
        <p className="text-xs text-white/45">
          {reviewing ? `${done}/${decisions.length}` : `${decisions.filter((d) => d.ev).length}/${decisions.length} scored`}
        </p>
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
                    className={`grid gap-1 rounded-lg border px-3 py-2 text-sm sm:grid-cols-[minmax(11rem,1fr)_minmax(12rem,2fr)] ${
                      d.isHero ? "border-amber-300/30 bg-amber-300/5" : "border-white/10 bg-black/20"
                    }`}
                  >
                    <div>
                      <span className="text-white/55">{d.position}</span>{" "}
                      <span className="font-medium">{d.name}</span>{" "}
                      <span>{d.label}</span>
                    </div>
                    <DecisionEv d={d} />
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

function DecisionEv({ d }: { d: Decision }) {
  if (d.evError) return <p className="text-red-300">{d.evError}</p>;
  if (!d.ev) return <p className="text-white/40">Evaluating…</p>;
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

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-2">
      <span className="text-white/60">{label}</span>
      <span
        className={
          tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : "text-white"
        }
      >
        {value}
      </span>
    </div>
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
