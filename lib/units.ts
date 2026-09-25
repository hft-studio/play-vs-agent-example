/** Engine uses integer chips. One big blind is 20 chips. */
export const CHIPS_PER_BB = 20;
export const START_STACK_CHIPS = 100 * CHIPS_PER_BB;

export function chipsToBb(chips: number) {
  return Math.round((chips / CHIPS_PER_BB) * 100) / 100;
}

export function bbToChips(bb: number) {
  return Math.round(bb * CHIPS_PER_BB);
}

export function formatBb(bb: number) {
  const n = Math.round(bb * 10) / 10;
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}bb`;
}

export function formatEv(bb: number) {
  const n = Math.round(bb * 10) / 10;
  const sign = n > 0 ? "+" : "";
  const body = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${sign}${body}bb`;
}

export function formatChipsAsBb(chips: number) {
  return formatBb(chipsToBb(chips));
}
