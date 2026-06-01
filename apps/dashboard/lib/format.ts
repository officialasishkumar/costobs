// Display formatting helpers.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdPrecise = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const int = new Intl.NumberFormat('en-US');

export function fmtUsd(n: number): string {
  return usd.format(Number.isFinite(n) ? n : 0);
}

export function fmtUsdPrecise(n: number): string {
  return usdPrecise.format(Number.isFinite(n) ? n : 0);
}

export function fmtCompact(n: number): string {
  return compact.format(Number.isFinite(n) ? n : 0);
}

export function fmtInt(n: number): string {
  return int.format(Number.isFinite(n) ? Math.round(n) : 0);
}

export function fmtNumber(n: number): string {
  return int.format(Number.isFinite(n) ? n : 0);
}
