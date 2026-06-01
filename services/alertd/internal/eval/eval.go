// Package eval contains the per-kind alert evaluators. Each evaluator builds a
// ClickHouse query from a rule's kind + scope + the relevant time window, runs
// it through a QueryRunner, and decides whether the threshold is breached.
//
// All evaluation logic takes a QueryRunner interface so the decision logic is
// unit-testable offline with a fake runner.
//
// Storage choice: queries target the raw `events` table rather than the
// `cost_daily` / `cost_attr_hourly` rollups. The rollups only carry a subset of
// the scope dimensions (cost_daily has provider/model; cost_attr_hourly has
// customer_id/feature/team), so they cannot satisfy arbitrary scope filters
// such as {"provider":"openai","feature":"chat","user_id":"u"} together. The
// raw events table carries every scope dimension and yields correct results for
// any subset, at the cost of scanning more rows.
package eval

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

// QueryRunner runs a single scalar-sum ClickHouse query. SumCost must return
// the sum of cost_usd (USD) matching the supplied SQL + args, or 0 with no
// error when no rows match.
type QueryRunner interface {
	SumCost(ctx context.Context, query string, args ...any) (float64, error)
}

// Kind enumerates the supported alert rule kinds.
const (
	KindDailyThreshold = "daily_threshold"
	KindSpike          = "spike"
	KindMonthlyBudget  = "monthly_budget"
)

// Baseline values for the spike kind.
const (
	BaselineRolling7d = "rolling_7d"
	BaselineYesterday = "yesterday"
)

// Rule is the minimal view of an alert rule that the evaluator needs. It is
// decoupled from the Postgres row type so eval has no DB dependency.
type Rule struct {
	OrgSlug string
	Kind    string
	Scope   map[string]string

	// Config fields (only the ones relevant to Kind are populated).
	ThresholdUSD float64 // daily_threshold
	BudgetUSD    float64 // monthly_budget
	Factor       float64 // spike
	Baseline     string  // spike
}

// Result is the outcome of evaluating a single rule.
type Result struct {
	Breached bool
	// ObservedUSD is the spend measured in the rule's evaluation window.
	ObservedUSD float64
	// ThresholdUSD is the effective threshold the observation was compared
	// against (the configured threshold/budget, or factor*baseline for spike).
	ThresholdUSD float64
}

// allowedScopeColumns restricts scope keys to known, indexable event columns to
// avoid SQL injection via arbitrary identifiers and to reject typos.
var allowedScopeColumns = map[string]bool{
	"provider":    true,
	"model":       true,
	"feature":     true,
	"team":        true,
	"service":     true,
	"customer_id": true,
	"user_id":     true,
	"environment": true,
	"operation":   true,
}

// scopeClause builds a deterministic "AND col = ?" fragment plus the ordered
// argument slice for the given scope map. Keys are sorted so the output is
// stable (important for tests). Unknown keys produce an error rather than being
// silently dropped. The returned fragment is empty when scope is empty.
func scopeClause(scope map[string]string) (string, []any, error) {
	if len(scope) == 0 {
		return "", nil, nil
	}
	keys := make([]string, 0, len(scope))
	for k := range scope {
		if !allowedScopeColumns[k] {
			return "", nil, fmt.Errorf("unsupported scope key %q", k)
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)

	var b strings.Builder
	args := make([]any, 0, len(keys))
	for _, k := range keys {
		b.WriteString(" AND ")
		b.WriteString(k)
		b.WriteString(" = ?")
		args = append(args, scope[k])
	}
	return b.String(), args, nil
}

// Evaluate dispatches on rule kind. now is injected (UTC is enforced) so the
// time windows are deterministic in tests.
func Evaluate(ctx context.Context, qr QueryRunner, r Rule, now time.Time) (Result, error) {
	now = now.UTC()
	switch r.Kind {
	case KindDailyThreshold:
		return evalDailyThreshold(ctx, qr, r, now)
	case KindSpike:
		return evalSpike(ctx, qr, r, now)
	case KindMonthlyBudget:
		return evalMonthlyBudget(ctx, qr, r, now)
	default:
		return Result{}, fmt.Errorf("unknown rule kind %q", r.Kind)
	}
}

// sumCostWindow runs a sum over events for org+scope within [from, to).
func sumCostWindow(ctx context.Context, qr QueryRunner, r Rule, from, to time.Time) (float64, error) {
	clause, scopeArgs, err := scopeClause(r.Scope)
	if err != nil {
		return 0, err
	}
	q := "SELECT sum(cost_usd) FROM events WHERE org_id = ? AND ts >= ? AND ts < ?" + clause
	args := make([]any, 0, 3+len(scopeArgs))
	args = append(args, r.OrgSlug, from, to)
	args = append(args, scopeArgs...)
	return qr.SumCost(ctx, q, args...)
}

func evalDailyThreshold(ctx context.Context, qr QueryRunner, r Rule, now time.Time) (Result, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	observed, err := sumCostWindow(ctx, qr, r, dayStart, now)
	if err != nil {
		return Result{}, err
	}
	return Result{
		Breached:     observed > r.ThresholdUSD,
		ObservedUSD:  observed,
		ThresholdUSD: r.ThresholdUSD,
	}, nil
}

func evalMonthlyBudget(ctx context.Context, qr QueryRunner, r Rule, now time.Time) (Result, error) {
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	observed, err := sumCostWindow(ctx, qr, r, monthStart, now)
	if err != nil {
		return Result{}, err
	}
	return Result{
		Breached:     observed > r.BudgetUSD,
		ObservedUSD:  observed,
		ThresholdUSD: r.BudgetUSD,
	}, nil
}

func evalSpike(ctx context.Context, qr QueryRunner, r Rule, now time.Time) (Result, error) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)

	// Today's spend so far.
	observed, err := sumCostWindow(ctx, qr, r, dayStart, now)
	if err != nil {
		return Result{}, err
	}

	// Baseline: average daily cost over the chosen window (excluding today).
	var baselineAvg float64
	switch r.Baseline {
	case BaselineYesterday:
		yStart := dayStart.AddDate(0, 0, -1)
		total, err := sumCostWindow(ctx, qr, r, yStart, dayStart)
		if err != nil {
			return Result{}, err
		}
		baselineAvg = total
	case BaselineRolling7d, "":
		// Trailing 7 full days [today-7, today); divide by 7 for a daily avg.
		start := dayStart.AddDate(0, 0, -7)
		total, err := sumCostWindow(ctx, qr, r, start, dayStart)
		if err != nil {
			return Result{}, err
		}
		baselineAvg = total / 7.0
	default:
		return Result{}, fmt.Errorf("unsupported spike baseline %q", r.Baseline)
	}

	threshold := r.Factor * baselineAvg
	// When there is no baseline (avg == 0) any positive spend is, strictly, an
	// infinite spike. We treat a zero baseline as "not enough data" and only
	// breach when there is some baseline to multiply, avoiding noisy alerts on
	// brand-new scopes.
	breached := baselineAvg > 0 && observed > threshold

	return Result{
		Breached:     breached,
		ObservedUSD:  observed,
		ThresholdUSD: threshold,
	}, nil
}
