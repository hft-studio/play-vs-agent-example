"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { decide, evaluate } from "@/lib/api";
import { DEPLOY_URL } from "@/lib/deploy";
import { handEvalEnabled } from "@/lib/flags";
import {
  applyAction,
  formatCard,
  isHandOver,
  legalActions,
  startHand,
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
import { CHIPS_PER_BB, START_STACK_CHIPS, chipsToBb, formatBb, formatChipsAsBb, formatEv } from "@/lib/units";

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

function formatTableBb(chips: number) {
  const n = Math.round(chipsToBb(chips) * 10) / 10;
  return `${n.toFixed(1)} BB`;
}

const BET_PCTS = [0.25, 0.33, 0.75, 1.33];

function potSizedTo(streetCommitted: number, callAmount: number, pot: number, pct: number, min: number, max: number) {
  const extra = Math.max(0, Math.round((pot + callAmount) * pct));
  const to = streetCommitted + callAmount + extra;
  return Math.max(min, Math.min(max, to));
}

function cardSrc(card?: string, hidden?: boolean) {
  if (hidden || !card) return "/kit/cards/back.png";
  const rank = card[0] === "T" ? "10" : card[0];
  return `/kit/cards/${card[1].toUpperCase()}-${rank}.png`;
}

function CardView({ card, hidden, size = "sm" }: { card?: string; hidden?: boolean; size?: "sm" | "md" | "lg" }) {
  const box = size === "lg" ? "h-16" : size === "md" ? "h-14" : "h-8";
  return (
    <img
      src={cardSrc(card, hidden || !card)}
      alt={hidden || !card ? "" : formatCard(card)}
      draggable={false}
      className={`${box} w-auto shrink-0 drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)]`}
    />
  );
}

function ChipBet({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  const n = amount >= 10 * CHIPS_PER_BB ? 3 : amount >= 2 * CHIPS_PER_BB ? 2 : 1;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="relative inline-block h-5 w-5">
        {Array.from({ length: n }, (_, i) => (
          <img
            key={i}
            src="/kit/chip.png"
            alt=""
            draggable={false}
            className="absolute left-0 h-5 w-5"
            style={{ bottom: i * 3 }}
          />
        ))}
      </span>
      <span className="text-[11px] font-semibold text-white drop-shadow">{formatTableBb(amount)}</span>
    </span>
  );
}

function polar(seat: number, rx: number, ry: number): CSSProperties {
  const angle = (seat / SEATS) * Math.PI * 2 + Math.PI / 2;
  return {
    left: `${50 + Math.cos(angle) * rx}%`,
    top: `${44 + Math.sin(angle) * ry}%`,
  };
}

function seatStyle(seat: number) {
  return polar(seat, seat === HERO ? 26 : 28, seat === HERO ? 30 : 23);
}

function dealerStyle(seat: number) {
  return polar(seat, 22, 18);
}

function betStyle(seat: number) {
  return polar(seat, 17, 14);
}

export default function Page() {
  const [stacks, setStacks] = useState(() => Array.from({ length: SEATS }, () => START_STACK_CHIPS));
  const [button, setButton] = useState(8);
  const [state, setState] = useState<GameState | null>(null);
  const [taken, setTaken] = useState<Taken[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [lastActs, setLastActs] = useState<string[]>(() => Array(SEATS).fill(""));
  const [thinking, setThinking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewDone, setReviewDone] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [betTo, setBetTo] = useState(0);
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const runRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ready")
      .then((res) => res.json())
      .then((body: { ready?: boolean }) => {
        if (cancelled) return;
        const ok = Boolean(body.ready);
        setReady(ok);
      })
      .catch(() => {
        if (!cancelled) setReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const nextDecisionId = useRef(0);

  const legal = state && state.toAct !== null ? legalActions(state) : null;
  const heroToAct = Boolean(state && state.toAct === HERO && !isHandOver(state));
  const over = Boolean(state && isHandOver(state));

  const deal = useCallback(() => {
    if (!readyRef.current) return;
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
  }, [stacks, button]);

  const started = useRef(false);
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    deal();
  }, [ready, deal]);

  const finish = useCallback((next: GameState) => {
    if (!next.result) return;
    setStacks(next.players.map((p) => p.stack));
    setButton((b) => (b + 1) % SEATS);
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
    if (!readyRef.current) {
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
        const res = await decide(snapshotFromState(state, seat, legalNow, taken));
        if (run !== runRef.current) return;
        apply(state, actionFromResponse(res.action, res.amount, legalNow), seat, taken);
      } catch (err) {
        if (run !== runRef.current) return;
        const fallback: Action = legalNow.canCheck ? { type: "check" } : { type: "fold" };
        apply(state, fallback, seat, taken);
      }
    }, 420);
    return () => window.clearTimeout(timer);
  }, [state, taken, apply, ready]);

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
          const got = await evaluate({ ...d.snapshot, selected: d.selected, iters: 12 });
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

  const spotKey = state && legal?.canRaise ? `${state.street}:${state.toAct}:${state.currentBet}:${pot}` : "";
  useEffect(() => {
    if (!spotKey || !legal?.canRaise || !state) return;
    const hero = state.players[HERO];
    setBetTo(potSizedTo(hero.streetCommitted, legal.callAmount, pot, 0.75, legal.minRaiseTo, legal.maxRaiseTo));
  }, [spotKey]);

  return (
    <>
    <main className="mx-auto flex w-full max-w-7xl flex-col items-start gap-4 px-4 pt-4 pb-24 lg:flex-row">
      <div className="flex min-w-0 w-full flex-1 flex-col gap-3">
        <div className="relative overflow-hidden rounded-xl">
          <img src="/kit/table.jpg" alt="" draggable={false} className="block w-full select-none" />
          <div className="absolute inset-0">
          <div className="absolute left-1/2 top-[38%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
            <ChipBet amount={pot} />
            <div className="mt-1 flex flex-nowrap items-end justify-center gap-1">
              {board.map((c) => (
                <CardView key={c} card={c} size="md" />
              ))}
            </div>
          </div>

          {state && (
            <span
              style={dealerStyle(state.buttonIndex)}
              className="absolute z-10 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-yellow-300 text-[10px] font-bold text-black"
            >
              D
            </span>
          )}

          {Array.from({ length: SEATS }, (_, seat) => {
            const player = state?.players[seat];
            const acting = state?.toAct === seat && !over;
            const showCards = Boolean(player && (seat === HERO ? false : over) && !player.folded);
            const name = seat === HERO ? "You" : `Agent ${seat}`;
            return (
              <div
                key={seat}
                style={seatStyle(seat)}
                className="absolute w-28 -translate-x-1/2 -translate-y-1/2 text-center"
              >
                {seat !== HERO && (
                  <img
                    src={`/api/avatar/${seat}`}
                    alt=""
                    width={40}
                    height={40}
                    className="mx-auto mb-0.5 h-8 w-8 rounded-full border border-white/20 object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                {player && !player.folded && seat !== HERO && (
                  <div className="mb-1 flex justify-center gap-0.5">
                    <CardView card={player.hole[0]} hidden={!showCards} />
                    <CardView card={player.hole[1]} hidden={!showCards} />
                  </div>
                )}
                <div
                  className={`rounded-md border px-2 py-1 ${
                    acting ? "border-amber-300 bg-black/70" : "border-white/10 bg-black/55"
                  } ${player?.folded ? "opacity-40" : ""}`}
                >
                  <p className="truncate text-[11px] font-medium text-white">{name}</p>
                  <p className="text-[11px] text-amber-100/90">{formatTableBb(player?.stack ?? stacks[seat])}</p>
                  <p className="text-[10px] text-white/45">
                    {positionOf(seat, state?.buttonIndex ?? button)}
                    {thinking === seat ? " · …" : lastActs[seat] ? ` · ${lastActs[seat]}` : ""}
                  </p>
                </div>
            </div>
          );
          })}

          {state?.players.map((player, seat) =>
            player.streetCommitted > 0 && !player.folded ? (
              <div key={`bet-${seat}`} style={betStyle(seat)} className="absolute z-10 -translate-x-1/2 -translate-y-1/2">
                <ChipBet amount={player.streetCommitted} />
              </div>
            ) : null,
          )}

          {state?.players[HERO] && !state.players[HERO].folded && (
            <div className="absolute left-1/2 top-[56%] flex -translate-x-1/2 flex-nowrap gap-1">
              <CardView card={state.players[HERO].hole[0]} size="lg" />
              <CardView card={state.players[HERO].hole[1]} size="lg" />
            </div>
          )}
          </div>
        </div>

        {heroToAct && legal && (
          <div className="flex flex-wrap items-end justify-end gap-3">
              {legal.canRaise && (
                <div className="mr-auto flex min-w-[240px] flex-1 flex-col gap-1">
                  <div className="flex items-center gap-1">
                    {BET_PCTS.map((pct) => {
                      const hero = state!.players[HERO];
                      const to = potSizedTo(hero.streetCommitted, legal.callAmount, pot, pct, legal.minRaiseTo, legal.maxRaiseTo);
                      const on = Math.abs(to - betTo) <= 1;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setBetTo(to)}
                          className={`rounded px-2 py-0.5 text-[11px] ${on ? "bg-amber-300 text-black" : "bg-black/40 text-white/70"}`}
                        >
                          {Math.round(pct * 100)}%
                        </button>
                      );
                    })}
                    <span className="ml-auto text-xs text-amber-100">{formatTableBb(Math.max(0, betTo - (state?.players[HERO].streetCommitted ?? 0)))}</span>
                  </div>
                  <input
                    type="range"
                    min={legal.minRaiseTo}
                    max={legal.maxRaiseTo}
                    step={1}
                    value={Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, betTo || legal.minRaiseTo))}
                    onChange={(e) => setBetTo(Number(e.target.value))}
                    className="w-full accent-amber-300"
                  />
                </div>
              )}
              <div className="flex gap-2">
                {legal.canFold && !legal.canCheck && (
                  <GgAct tone="fold" onClick={() => heroAct({ type: "fold" })}>
                    Fold
                  </GgAct>
                )}
                {legal.canCheck && (
                  <GgAct tone="check" onClick={() => heroAct({ type: "check" })}>
                    Check
                  </GgAct>
                )}
                {legal.callAmount > 0 && (
                  <GgAct tone="call" onClick={() => heroAct({ type: "call" })}>
                    Call
                    <span className="block text-[11px] font-normal">{formatTableBb(legal.callAmount)}</span>
                  </GgAct>
                )}
                {legal.canRaise && (
                  <GgAct
                    tone="bet"
                    onClick={() => heroAct({ type: "raise", amount: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, betTo)) })}
                  >
                    {betTo >= legal.maxRaiseTo ? "All-in" : legal.canCheck ? "Bet" : "Raise"}
                    <span className="block text-[11px] font-normal">
                      {formatTableBb(Math.max(0, (betTo || legal.minRaiseTo) - (state?.players[HERO].streetCommitted ?? 0)))}
                    </span>
                  </GgAct>
                )}
              </div>
          </div>
        )}
      </div>

      {handEvalEnabled && reviewOpen && (
        <ReviewModal
          decisions={decisions.filter((d) => d.isHero)}
          reviewing={reviewing}
          done={reviewDone}
          onClose={() => setReviewOpen(false)}
        />
      )}

      {state && (
        <aside className="w-full shrink-0 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-6.5rem)] lg:w-80 lg:overflow-y-auto">
          <HandHistory decisions={decisions} button={state.buttonIndex} />
        </aside>
      )}

    </main>
      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-[#07140c]">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-[13px] text-white/50">
          <span className="font-medium text-white">HFT Labs</span>
          <span>30 N Gould St, Ste N, Sheridan, WY 82801</span>
          <a className="transition-colors hover:text-white/85" href="mailto:michael@hftlabs.xyz">
            michael@hftlabs.xyz
          </a>
          <a className="transition-colors hover:text-white/85" href="https://x.com/HftStudio">
            X
          </a>
          <a className="transition-colors hover:text-white/85" href="https://www.linkedin.com/company/hft-labs">
            LinkedIn
          </a>
          <a className="transition-colors hover:text-white/85" href="https://github.com/hft-studio">
            GitHub
          </a>
          <span className="ml-auto font-mono text-[11px] text-white/40">© {new Date().getFullYear()}</span>
          <a href={DEPLOY_URL} className="inline-flex">
            <img alt="Deploy with Vercel" src="https://vercel.com/button" height={32} />
          </a>
        </div>
      </footer>
    </>
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

function GgAct({
  children,
  onClick,
  tone,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone: "fold" | "check" | "call" | "bet";
}) {
  const color =
    tone === "fold"
      ? "bg-[#8d3a32] hover:bg-[#a3483e]"
      : tone === "check"
        ? "bg-[#6a4038] hover:bg-[#7d4d44]"
        : "bg-[#c0453a] hover:bg-[#d35246]";
  return (
    <button type="button" onClick={onClick} className={`min-w-[5.5rem] rounded-md px-4 py-2 text-sm font-semibold text-white ${color}`}>
      {children}
    </button>
  );
}
