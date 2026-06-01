// Date-range helpers shared across views. Ranges are carried in URL search
// params (?range=7|30|90) and resolved to inclusive [from, to] Date strings.

export type RangeKey = '7' | '30' | '90';
export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
];

export function parseRange(raw: string | undefined): RangeKey {
  return raw === '7' || raw === '90' ? raw : raw === '30' ? '30' : '30';
}

export interface ResolvedRange {
  key: RangeKey;
  days: number;
  /** YYYY-MM-DD inclusive lower bound. */
  from: string;
  /** YYYY-MM-DD inclusive upper bound (today, UTC). */
  to: string;
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function resolveRange(raw: string | undefined): ResolvedRange {
  const key = parseRange(raw);
  const days = Number(key);
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { key, days, from: ymd(from), to: ymd(to) };
}
