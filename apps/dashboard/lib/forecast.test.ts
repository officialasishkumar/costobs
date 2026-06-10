import { describe, expect, it } from 'vitest';
import { type SeriesPoint, buildForecast } from './forecast';

function series(values: number[], startDate = '2026-05-01'): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  const d = new Date(startDate + 'T00:00:00Z');
  for (const v of values) {
    out.push({ date: d.toISOString().slice(0, 10), value: v });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('linear fit', () => {
  it('recovers a perfect linear trend with R²=1', () => {
    const hist = series(Array.from({ length: 14 }, (_, i) => 10 + 2 * i));
    const r = buildForecast(hist, 7);
    expect(r.linear.slope).toBeCloseTo(2, 6);
    expect(r.linear.intercept).toBeCloseTo(10, 6);
    expect(r.linear.r2).toBeCloseTo(1, 6);
    // First projected day continues the line.
    const firstProjected = r.points[hist.length]!;
    expect(firstProjected.actual).toBeNull();
    expect(firstProjected.linear).toBeCloseTo(10 + 2 * 14, 6);
  });

  it('is flat (slope 0) on a constant series', () => {
    const r = buildForecast(series(new Array(10).fill(5)), 5);
    expect(r.linear.slope).toBeCloseTo(0, 9);
  });

  it('handles empty history', () => {
    const r = buildForecast([], 7);
    expect(r.points).toHaveLength(0);
    expect(r.seasonal).toBeNull();
    expect(r.monthEndEstimate).toBe(0);
  });
});

describe('exponential fit', () => {
  it('recovers compound growth', () => {
    const hist = series(Array.from({ length: 14 }, (_, i) => 100 * Math.exp(0.05 * i)));
    const r = buildForecast(hist, 7);
    expect(r.exponential).not.toBeNull();
    expect(r.exponential!.rate).toBeCloseTo(0.05, 6);
    expect(r.exponential!.base).toBeCloseTo(100, 3);
    expect(r.exponential!.r2).toBeCloseTo(1, 6);
  });

  it('is skipped when any day is zero (log undefined)', () => {
    const r = buildForecast(series([1, 0, 3, 4, 5, 6, 7, 8]), 3);
    expect(r.exponential).toBeNull();
  });
});

describe('holt-winters seasonal fit', () => {
  // Weekly pattern: weekdays at 100, weekends at 40 (positions 5,6 of each
  // 7-day block), no trend.
  const weeklyPattern = (weeks: number): number[] => {
    const out: number[] = [];
    for (let w = 0; w < weeks; w++) {
      out.push(100, 100, 100, 100, 100, 40, 40);
    }
    return out;
  };

  it('requires two full seasons', () => {
    expect(buildForecast(series(weeklyPattern(1)), 7).seasonal).toBeNull();
    expect(buildForecast(series(weeklyPattern(2)), 7).seasonal).not.toBeNull();
  });

  it('captures the weekday/weekend cycle a linear fit smears out', () => {
    const hist = series(weeklyPattern(4)); // 28 days
    const r = buildForecast(hist, 14);
    expect(r.seasonal).not.toBeNull();
    // Seasonal one-step R² should crush the linear fit on cyclic data.
    expect(r.seasonal!.r2).toBeGreaterThan(0.9);
    expect(r.linear.r2).toBeLessThan(0.2);

    // Projections continue the cycle: position 28 (index 0 of the week) is a
    // weekday (~100); positions 33/34 are the weekend dip (~40).
    const proj = r.points.slice(hist.length);
    expect(proj[0]!.seasonal).toBeGreaterThan(80);
    expect(proj[5]!.seasonal).toBeLessThan(60);
    expect(proj[6]!.seasonal).toBeLessThan(60);
  });

  it('tracks trend plus seasonality', () => {
    // +1/day trend layered over the weekly dip.
    const base = weeklyPattern(4);
    const hist = series(base.map((v, i) => v + i));
    const r = buildForecast(hist, 7);
    expect(r.seasonal).not.toBeNull();
    expect(r.seasonal!.trend).toBeGreaterThan(0.5);
    expect(r.seasonal!.trend).toBeLessThan(1.5);
  });

  it('never projects negative spend', () => {
    const hist = series(weeklyPattern(3).map((v) => Math.max(0, v - 95)));
    const r = buildForecast(hist, 14);
    for (const p of r.points) {
      if (p.seasonal !== null) expect(p.seasonal).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('month-end estimates', () => {
  it('seasonal estimate exists only with a seasonal fit', () => {
    const short = buildForecast(series([1, 2, 3]), 7);
    expect(short.monthEndEstimateSeasonal).toBeNull();
    const long = buildForecast(
      series(Array.from({ length: 21 }, (_, i) => 10 + (i % 7))),
      14,
    );
    expect(long.monthEndEstimateSeasonal).not.toBeNull();
  });
});
