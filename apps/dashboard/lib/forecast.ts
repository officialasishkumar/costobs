// Lightweight trend projection in pure TypeScript (no heavy deps).
// Fits a linear least-squares trend and an optional exponential trend
// (linear fit on log values) over historical daily totals, then projects
// forward N days. Used by /forecast.

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ForecastPoint {
  date: string;
  actual: number | null;
  linear: number | null;
  exponential: number | null;
}

export interface ForecastResult {
  points: ForecastPoint[];
  /** index in points where projection begins (first projected day) */
  dividerDate: string | null;
  linear: { slope: number; intercept: number; r2: number };
  exponential: { rate: number; base: number; r2: number } | null;
  monthEndEstimate: number; // cumulative actual + projected through end of current month (linear)
}

interface Fit {
  slope: number;
  intercept: number;
  r2: number;
}

function linearFit(xs: number[], ys: number[]): Fit {
  const n = xs.length;
  if (n === 0) return { slope: 0, intercept: 0, r2: 0 };
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2 };
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * @param history daily totals, ordered ascending by date.
 * @param horizon number of future days to project.
 */
export function buildForecast(history: SeriesPoint[], horizon = 30): ForecastResult {
  if (history.length === 0) {
    return {
      points: [],
      dividerDate: null,
      linear: { slope: 0, intercept: 0, r2: 0 },
      exponential: null,
      monthEndEstimate: 0,
    };
  }

  const xs = history.map((_, i) => i);
  const ys = history.map((p) => p.value);
  const lin = linearFit(xs, ys);

  // Exponential fit: regress log(value) on x; only meaningful if all positive.
  let expFit: { rate: number; base: number; r2: number } | null = null;
  if (ys.every((v) => v > 0)) {
    const logYs = ys.map((v) => Math.log(v));
    const f = linearFit(xs, logYs);
    expFit = { rate: f.slope, base: Math.exp(f.intercept), r2: f.r2 };
  }

  const lastDate = history[history.length - 1].date;
  const points: ForecastPoint[] = history.map((p, i) => ({
    date: p.date,
    actual: p.value,
    linear: Math.max(0, lin.intercept + lin.slope * i),
    exponential: expFit ? expFit.base * Math.exp(expFit.rate * i) : null,
  }));

  const startIdx = history.length;
  let dividerDate: string | null = null;
  for (let h = 1; h <= horizon; h++) {
    const idx = startIdx - 1 + h;
    const date = addDays(lastDate, h);
    if (h === 1) dividerDate = date;
    points.push({
      date,
      actual: null,
      linear: Math.max(0, lin.intercept + lin.slope * idx),
      exponential: expFit ? expFit.base * Math.exp(expFit.rate * idx) : null,
    });
  }

  // Month-end estimate (linear): sum actuals for the current month so far +
  // projected linear values for remaining days of the current month.
  const today = new Date();
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const monthEnd = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const monthStart = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  let monthEndEstimate = 0;
  for (const p of points) {
    if (p.date >= monthStart && p.date <= monthEnd) {
      monthEndEstimate += p.actual ?? p.linear ?? 0;
    }
  }

  return {
    points,
    dividerDate,
    linear: lin,
    exponential: expFit,
    monthEndEstimate,
  };
}
