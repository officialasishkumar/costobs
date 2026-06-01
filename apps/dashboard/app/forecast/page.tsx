import { Card, Grid, Metric, Text } from '@tremor/react';
import { currentOrgSlug } from '@/lib/tenant';
import { getDailyTotalsForForecast } from '@/lib/queries';
import { buildForecast } from '@/lib/forecast';
import { ForecastChart } from '@/components/ForecastChart';
import { ForecastToggle } from '@/components/ForecastToggle';
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

  try {
    const history = await getDailyTotalsForForecast(org, HISTORY_DAYS);
    const result = buildForecast(
      history.map((h) => ({ date: h.date, value: h.cost_usd })),
      HORIZON_DAYS,
    );

    const projectedTotal = result.points
      .filter((p) => p.actual === null)
      .reduce((s, p) => s + (p.linear ?? 0), 0);

    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <p className="text-tremor-default text-tremor-content">
            Linear least-squares trend on the last {HISTORY_DAYS} days, projected{' '}
            {HORIZON_DAYS} days forward.
          </p>
          <ForecastToggle showExponential={showExponential} />
        </div>

        <Grid numItemsSm={2} numItemsLg={3} className="gap-4">
          <Card>
            <Text>Month-end estimate (linear)</Text>
            <Metric>{fmtUsd(result.monthEndEstimate)}</Metric>
          </Card>
          <Card>
            <Text>Next {HORIZON_DAYS}d projected spend</Text>
            <Metric>{fmtUsd(projectedTotal)}</Metric>
          </Card>
          <Card>
            <Text>Trend (linear R²)</Text>
            <Metric>{result.linear.r2.toFixed(3)}</Metric>
            <Text className="mt-1">
              slope {fmtUsd(result.linear.slope)} / day
              {result.exponential
                ? ` · exp R² ${result.exponential.r2.toFixed(3)}`
                : ''}
            </Text>
          </Card>
        </Grid>

        <ForecastChart result={result} showExponential={showExponential} />
      </div>
    );
  } catch (err) {
    return (
      <div className="space-y-6">
        <QueryError error={err} />
      </div>
    );
  }
}
