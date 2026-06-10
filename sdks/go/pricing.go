package costobs

import (
	_ "embed"
	"strings"
	"sync"

	"github.com/shopspring/decimal"
	"gopkg.in/yaml.v3"
)

//go:embed data/pricing-v2026.06.yaml
var pricingYAML []byte

type pricingFile struct {
	Version string `yaml:"version"`
	Models  []struct {
		Provider           string   `yaml:"provider"`
		Model              string   `yaml:"model"`
		Match              string   `yaml:"match"`
		Operation          string   `yaml:"operation"`
		InputPerToken      *float64 `yaml:"input_per_token"`
		CachedInputPerTok  *float64 `yaml:"cached_input_per_token"`
		OutputPerToken     *float64 `yaml:"output_per_token"`
		ReasoningPerToken  *float64 `yaml:"reasoning_per_token"`
		ToolPerToken       *float64 `yaml:"tool_per_token"`
		AudioPerSecond     *float64 `yaml:"audio_per_second"`
		PerCharacter       *float64 `yaml:"per_character"`
		BatchDiscount      *float64 `yaml:"batch_discount"`
		FinetuneSurcharge  *float64 `yaml:"finetune_surcharge"`
		ImageTiers         []struct {
			PerTile float64 `yaml:"per_tile"`
			Base    float64 `yaml:"base"`
		} `yaml:"image_tiers"`
	} `yaml:"models"`
}

type modelRule struct {
	provider, model, match string
	input, cachedInput, output, reasoning, tool *decimal.Decimal
	audioPerSecond, perCharacter                *decimal.Decimal
	imagePerTile, imageBase                     *decimal.Decimal
}

func (r *modelRule) matches(provider, model string) bool {
	if r.provider != provider {
		return false
	}
	if r.match == "prefix" {
		return strings.HasPrefix(model, r.model)
	}
	return model == r.model
}

// PricingEngine computes per-call cost from the bundled pricing file using
// exact decimal math. Unknown models cost 0 until pricing is added.
type PricingEngine struct {
	Version string
	rules   []modelRule

	mu    sync.RWMutex
	cache map[string]*modelRule
}

var (
	defaultEngine     *PricingEngine
	defaultEngineOnce sync.Once
)

// DefaultPricing returns the shared engine loaded from the embedded file.
func DefaultPricing() *PricingEngine {
	defaultEngineOnce.Do(func() {
		eng, err := NewPricingEngine(pricingYAML)
		if err != nil {
			// The embedded file is validated by tests; an error here means a
			// broken build, so fall back to an engine that prices everything 0.
			eng = &PricingEngine{Version: "invalid", cache: map[string]*modelRule{}}
		}
		defaultEngine = eng
	})
	return defaultEngine
}

// NewPricingEngine parses a pricing YAML document.
func NewPricingEngine(raw []byte) (*PricingEngine, error) {
	var pf pricingFile
	if err := yaml.Unmarshal(raw, &pf); err != nil {
		return nil, err
	}
	dec := func(p *float64) *decimal.Decimal {
		if p == nil {
			return nil
		}
		d := decimal.NewFromFloat(*p)
		return &d
	}
	eng := &PricingEngine{Version: pf.Version, cache: map[string]*modelRule{}}
	for _, m := range pf.Models {
		r := modelRule{
			provider:       m.Provider,
			model:          m.Model,
			match:          m.Match,
			input:          dec(m.InputPerToken),
			cachedInput:    dec(m.CachedInputPerTok),
			output:         dec(m.OutputPerToken),
			reasoning:      dec(m.ReasoningPerToken),
			tool:           dec(m.ToolPerToken),
			audioPerSecond: dec(m.AudioPerSecond),
			perCharacter:   dec(m.PerCharacter),
		}
		if len(m.ImageTiers) > 0 {
			t := decimal.NewFromFloat(m.ImageTiers[0].PerTile)
			b := decimal.NewFromFloat(m.ImageTiers[0].Base)
			r.imagePerTile, r.imageBase = &t, &b
		}
		eng.rules = append(eng.rules, r)
	}
	return eng, nil
}

func (e *PricingEngine) find(provider, model string) *modelRule {
	key := provider + "\x00" + model
	e.mu.RLock()
	if r, ok := e.cache[key]; ok {
		e.mu.RUnlock()
		return r
	}
	e.mu.RUnlock()

	var found *modelRule
	// Exact matches take priority; then longest prefix wins.
	for i := range e.rules {
		r := &e.rules[i]
		if r.match != "prefix" && r.matches(provider, model) {
			found = r
			break
		}
	}
	if found == nil {
		for i := range e.rules {
			r := &e.rules[i]
			if r.match == "prefix" && r.matches(provider, model) {
				if found == nil || len(r.model) > len(found.model) {
					found = r
				}
			}
		}
	}
	e.mu.Lock()
	e.cache[key] = found
	e.mu.Unlock()
	return found
}

// Cost computes the USD cost of one call. Returns 0 for unknown models.
func (e *PricingEngine) Cost(u Usage, provider, model string) decimal.Decimal {
	rule := e.find(provider, model)
	if rule == nil {
		return decimal.Zero
	}
	total := decimal.Zero
	mulInt := func(rate *decimal.Decimal, n int) {
		if rate != nil && n != 0 {
			total = total.Add(rate.Mul(decimal.NewFromInt(int64(n))))
		}
	}
	mulInt(rule.input, u.InputTokens)
	if u.CachedInputTokens > 0 {
		rate := rule.cachedInput
		if rate == nil {
			rate = rule.input
		}
		mulInt(rate, u.CachedInputTokens)
	}
	mulInt(rule.output, u.OutputTokens)
	if u.ReasoningTokens > 0 {
		rate := rule.reasoning
		if rate == nil {
			rate = rule.output
		}
		mulInt(rate, u.ReasoningTokens)
	}
	mulInt(rule.tool, u.ToolTokens)
	if u.AudioSeconds > 0 && rule.audioPerSecond != nil {
		total = total.Add(rule.audioPerSecond.Mul(decimal.NewFromFloat(u.AudioSeconds)))
	}
	mulInt(rule.perCharacter, u.Characters)
	if u.ImageTiles > 0 && rule.imagePerTile != nil {
		mulInt(rule.imagePerTile, u.ImageTiles)
		if u.ImageCount > 0 && rule.imageBase != nil {
			mulInt(rule.imageBase, u.ImageCount)
		}
	}
	return total
}
