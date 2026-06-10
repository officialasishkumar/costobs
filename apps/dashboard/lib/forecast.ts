// Lightweight trend projection in pure TypeScript (no heavy deps, no LLM).
// Three fully-offline, closed-form models over historical daily totals:
//   - linear least-squares trend
//   - exponential trend (linear fit on log values)
//   - additive Holt-Winters with weekly seasonality (period 7) — captures the
//     weekday/weekend cycle that a straight line smears out
// Used by /forecast.

export interface SeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ForecastPoint {
  date: string;
  actual: number | null;
  linear: number | null;
  exponential: number | null;
  seasonal: number | null;
}

export interface SeasonalFit {
  /** One-step-ahead R² over the history (in-sample). */
  r2: number;
  /** Final smoothed level and per-day trend. */
  level: number;
  trend: number;
  /** Additive weekday offsets, indexed by position in the series mod 7. */
  seasonals: number[];
}

export interface ForecastResult {
  points: ForecastPoint[];
  /** index in points where projection begins (first projected day) */
  dividerDate: string | null;
  linear: { slope: number; intercept: number; r2: number };
  exponential: { rate: number; base: number; r2: number } | null;
  /** Holt-Winters fit; null when history is shorter than two seasons. */
  seasonal: SeasonalFit | null;
  monthEndEstimate: number; // cumulative actual + projected through end of current month (linear)
  /** Month-end estimate using the seasonal model (null without a fit). */
  monthEndEstimateSeasonal: number | null;
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

const SEASON = 7; // weekly cycle
const HW_ALPHA = 0.35; // level smoothing
const HW_BETA = 0.1; // trend smoothing
const HW_GAMMA = 0.3; // seasonal smoothing

/**
 * Additive Holt-Winters (triple exponential smoothing) with a weekly season.
 * Returns the fitted state plus one-step-ahead in-sample predictions (used
 * both for charting the fit over history and for its R²). Requires at least
 * two full seasons; callers get null below that.
 */
function holtWinters(ys: number[]): { fit: SeasonalFit; inSample: number[] } | null {
  const n = ys.length;
  if (n < 2 * SEASON) return null;

  const fullSeasons = Math.floor(n / SEASON);

  // Initial level: mean of the first season.
  let level = 0;
  for (let i = 0; i < SEASON; i++) level += ys[i];
  level /= SEASON;

  // Initial trend: average per-day change between the first two seasons.
  let trend = 0;
  for (let i = 0; i < SEASON; i++) trend += (ys[i + SEASON] - ys[i]) / SEASON;
  trend /= SEASON;

  // Initial seasonal offsets: average deviation from each season's mean.
  const seasonals = new Array<number>(SEASON).fill(0);
  for (let s = 0; s < fullSeasons; s++) {
    let seasonMean = 0;
    for (let i = 0; i < SEASON; i++) seasonMean += ys[s * SEASON + i];
    seasonMean /= SEASON;
    for (let i = 0; i < SEASON; i++) {
      seasonals[i] += (ys[s * SEASON + i] - seasonMean) / fullSeasons;
    }
  }

  // Smooth through the series, recording one-step-ahead predictions.
  const inSample = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    const si = i % SEASON;
    inSample[i] = level + trend + seasonals[si];
    const prevLevel = level;
    level = HW_ALPHA * (ys[i] - seasonals[si]) + (1 - HW_ALPHA) * (level + trend);
    trend = HW_BETA * (level - prevLevel) + (1 - HW_BETA) * trend;
    seasonals[si] = HW_GAMMA * (ys[i] - level) + (1 - HW_GAMMA) * seasonals[si];
  }

  // One-step-ahead R².
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sse += (ys[i] - inSample[i]) ** 2;
    sst += (ys[i] - meanY) ** 2;
  }
  const r2 = sst === 0 ? 0 : Math.max(0, 1 - sse / sst);

  return { fit: { r2, level, trend, seasonals }, inSample };
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
      seasonal: null,
      monthEndEstimate: 0,
      monthEndEstimateSeasonal: null,
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

  // Holt-Winters seasonal fit (needs >= 2 weekly seasons of history).
  const hw = holtWinters(ys);
  const seasonalAt = (h: number): number | null => {
    // h steps after the last observed point (h >= 1).
    if (!hw) return null;
    const idx = (history.length + h - 1) % SEASON;
    return Math.max(0, hw.fit.level + h * hw.fit.trend + hw.fit.seasonals[idx]);
  };

  const lastDate = history[history.length - 1].date;
  const points: ForecastPoint[] = history.map((p, i) => ({
    date: p.date,
    actual: p.value,
    linear: Math.max(0, lin.intercept + lin.slope * i),
    exponential: expFit ? expFit.base * Math.exp(expFit.rate * i) : null,
    seasonal: hw ? Math.max(0, hw.inSample[i]) : null,
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
      seasonal: seasonalAt(h),
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
  let monthEndEstimateSeasonal: number | null = hw ? 0 : null;
  for (const p of points) {
    if (p.date >= monthStart && p.date <= monthEnd) {
      monthEndEstimate += p.actual ?? p.linear ?? 0;
      if (monthEndEstimateSeasonal !== null) {
        monthEndEstimateSeasonal += p.actual ?? p.seasonal ?? 0;
      }
    }
  }

  return {
    points,
    dividerDate,
    linear: lin,
    exponential: expFit,
    seasonal: hw ? hw.fit : null,
    monthEndEstimate,
    monthEndEstimateSeasonal,
  };
}
