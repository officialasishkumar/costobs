import { currentOrgSlug } from '@/lib/tenant';
import { getDailyTotalsForForecast } from '@/lib/queries';
import { buildForecast } from '@/lib/forecast';
import { ForecastChart } from '@/components/ForecastChart';
import { ForecastToggle } from '@/components/ForecastToggle';
import { PageHeader } from '@/components/PageHeader';
import { QueryError } from '@/components/DataState';
import { fmtUsd } from '@/lib/format';

// Reads cost_daily daily totals (last 30 days), fits the trend in TS.
export const dynamic = 'force-dynamic';

const HISTORY_DAYS = 30;
const HORIZON_DAYS = 30;

export default async function ForecastPage({
  searchParams,
}: {
  searchParams: Promise<{ exp?: string }>;
}) {
  const sp = await searchParams;
  const showExponential = sp.exp === '1';
  const org = await currentOrgSlug();

  const header = (
    <PageHeader
      eyebrow="05 / forecast"
      title="Spend trajectory"
      description={`Linear least-squares trend on the last ${HISTORY_DAYS} days, projected ${HORIZON_DAYS} days forward.`}
    >
      <ForecastToggle showExponential={showExponential} />
    </PageHeader>
  );

  try {
    const history = await getDailyTotalsForForecast(org, HISTORY_DAYS);
    const result = buildForecast(
      history.map((h) => ({ date: h.date, value: h.cost_usd })),
      HORIZON_DAYS,
    );

    const projectedTotal = result.points
      .filter((p) => p.actual === null)
      .reduce((s, p) => s + (p.linear ?? 0), 0);

    const stats = [
      {
        label: 'Month-end estimate · linear',
        value: fmtUsd(result.monthEndEstimate),
        accent: true,
        sub: null as string | null,
      },
      {
        label: `Next ${HORIZON_DAYS}d projected spend`,
        value: fmtUsd(projectedTotal),
        accent: false,
        sub: null,
      },
      {
        label: 'Trend · linear R²',
        value: result.linear.r2.toFixed(3),
        accent: false,
        sub:
          `slope ${fmtUsd(result.linear.slope)} / day` +
          (result.exponential ? ` · exp R² ${result.exponential.r2.toFixed(3)}` : ''),
      },
    ];

    return (
      <div className="space-y-6">
        {header}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s, i) => (
            <div
              key={s.label}
              className={`panel reveal reveal-${i + 1} p-5 ${s.accent ? 'panel--ticked' : ''}`}
            >
              <p className="label-mono">{s.label}</p>
              <p
                className={`readout mt-2 text-[1.7rem] font-medium leading-9 ${
                  s.accent ? 'text-ember-bright' : ''
                }`}
              >
                {s.value}
              </p>
              {s.sub ? (
                <p className="mt-1 font-mono text-xs text-dark-tremor-content">{s.sub}</p>
              ) : null}
            </div>
          ))}
        </div>
        <ForecastChart result={result} showExponential={showExponential} />
      </div>
    );
  } catch (err) {
    return (
      <div className="space-y-6">
        {header}
        <QueryError error={err} />
      </div>
    );
  }
}
