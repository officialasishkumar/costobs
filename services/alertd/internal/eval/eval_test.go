package eval

import (
	"context"
	"strings"
	"testing"
	"time"
)

// fakeRunner returns a fixed sum per query call in sequence, and records the
// queries and args it received so we can assert on SQL construction.
type fakeRunner struct {
	sums  []float64
	calls int

	gotQueries [][]any
	gotSQL     []string
}

func (f *fakeRunner) SumCost(_ context.Context, query string, args ...any) (float64, error) {
	f.gotSQL = append(f.gotSQL, query)
	f.gotQueries = append(f.gotQueries, args)
	v := 0.0
	if f.calls < len(f.sums) {
		v = f.sums[f.calls]
	}
	f.calls++
	return v, nil
}

var fixedNow = time.Date(2026, 6, 1, 12, 0, 0, 0, time.UTC)

func TestEvaluate_DailyThreshold(t *testing.T) {
	tests := []struct {
		name      string
		threshold float64
		observed  float64
		want      bool
	}{
		{"breach above", 100, 150, true},
		{"no breach below", 100, 50, false},
		{"no breach exactly equal", 100, 100, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fr := &fakeRunner{sums: []float64{tt.observed}}
			r := Rule{OrgSlug: "acme", Kind: KindDailyThreshold, ThresholdUSD: tt.threshold}
			res, err := Evaluate(context.Background(), fr, r, fixedNow)
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if res.Breached != tt.want {
				t.Errorf("breached = %v, want %v", res.Breached, tt.want)
			}
			if res.ObservedUSD != tt.observed {
				t.Errorf("observed = %v, want %v", res.ObservedUSD, tt.observed)
			}
			if res.ThresholdUSD != tt.threshold {
				t.Errorf("threshold = %v, want %v", res.ThresholdUSD, tt.threshold)
			}
		})
	}
}

func TestEvaluate_MonthlyBudget(t *testing.T) {
	fr := &fakeRunner{sums: []float64{500}}
	r := Rule{OrgSlug: "acme", Kind: KindMonthlyBudget, BudgetUSD: 400}
	res, err := Evaluate(context.Background(), fr, r, fixedNow)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if !res.Breached {
		t.Errorf("expected breach (500 > 400)")
	}
	// Window must start at the first of the month.
	args := fr.gotQueries[0]
	from := args[1].(time.Time)
	if from.Day() != 1 || from.Hour() != 0 {
		t.Errorf("month window from = %v, want first-of-month midnight", from)
	}
}

func TestEvaluate_Spike_Rolling7d(t *testing.T) {
	// 7d total = 70 -> avg 10/day. factor 3 -> threshold 30.
	tests := []struct {
		name     string
		observed float64
		total7d  float64
		factor   float64
		want     bool
	}{
		{"breach", 40, 70, 3, true},     // 40 > 30
		{"no breach", 25, 70, 3, false}, // 25 < 30
		{"zero baseline never breaches", 100, 0, 3, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// call order: today sum first, then baseline window.
			fr := &fakeRunner{sums: []float64{tt.observed, tt.total7d}}
			r := Rule{OrgSlug: "acme", Kind: KindSpike, Factor: tt.factor, Baseline: BaselineRolling7d}
			res, err := Evaluate(context.Background(), fr, r, fixedNow)
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if res.Breached != tt.want {
				t.Errorf("breached = %v, want %v (observed=%v threshold=%v)",
					res.Breached, tt.want, res.ObservedUSD, res.ThresholdUSD)
			}
		})
	}
}

func TestEvaluate_Spike_Yesterday(t *testing.T) {
	// yesterday total = 20, factor 2 -> threshold 40.
	fr := &fakeRunner{sums: []float64{50, 20}}
	r := Rule{OrgSlug: "acme", Kind: KindSpike, Factor: 2, Baseline: BaselineYesterday}
	res, err := Evaluate(context.Background(), fr, r, fixedNow)
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if res.ThresholdUSD != 40 {
		t.Errorf("threshold = %v, want 40", res.ThresholdUSD)
	}
	if !res.Breached {
		t.Errorf("expected breach (50 > 40)")
	}
	// baseline window should be exactly one day wide.
	bArgs := fr.gotQueries[1]
	from := bArgs[1].(time.Time)
	to := bArgs[2].(time.Time)
	if to.Sub(from) != 24*time.Hour {
		t.Errorf("yesterday window width = %v, want 24h", to.Sub(from))
	}
}

func TestScopeClause(t *testing.T) {
	clause, args, err := scopeClause(map[string]string{"provider": "openai", "feature": "chat"})
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	// keys sorted: feature then provider.
	want := " AND feature = ? AND provider = ?"
	if clause != want {
		t.Errorf("clause = %q, want %q", clause, want)
	}
	if len(args) != 2 || args[0] != "chat" || args[1] != "openai" {
		t.Errorf("args = %v, want [chat openai]", args)
	}
}

func TestScopeClause_RejectsUnknownKey(t *testing.T) {
	if _, _, err := scopeClause(map[string]string{"evil; DROP TABLE": "x"}); err == nil {
		t.Fatal("expected error for unknown scope key")
	}
}

func TestScopeClause_Empty(t *testing.T) {
	clause, args, err := scopeClause(nil)
	if err != nil || clause != "" || args != nil {
		t.Errorf("empty scope: clause=%q args=%v err=%v", clause, args, err)
	}
}

func TestSumCostWindow_SQLIncludesScope(t *testing.T) {
	fr := &fakeRunner{sums: []float64{0}}
	r := Rule{OrgSlug: "acme", Kind: KindDailyThreshold, ThresholdUSD: 1,
		Scope: map[string]string{"provider": "openai"}}
	if _, err := Evaluate(context.Background(), fr, r, fixedNow); err != nil {
		t.Fatalf("err: %v", err)
	}
	sql := fr.gotSQL[0]
	if !strings.Contains(sql, "org_id = ?") || !strings.Contains(sql, "provider = ?") {
		t.Errorf("SQL missing expected clauses: %s", sql)
	}
	// org_id is first arg, scope arg is last.
	args := fr.gotQueries[0]
	if args[0] != "acme" {
		t.Errorf("first arg = %v, want acme", args[0])
	}
	if args[len(args)-1] != "openai" {
		t.Errorf("last arg = %v, want openai", args[len(args)-1])
	}
}

func TestEvaluate_UnknownKind(t *testing.T) {
	fr := &fakeRunner{}
	_, err := Evaluate(context.Background(), fr, Rule{Kind: "bogus"}, fixedNow)
	if err == nil {
		t.Fatal("expected error for unknown kind")
	}
}
