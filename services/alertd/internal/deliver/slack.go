package deliver

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// slackMessage is a Slack incoming-webhook payload using a colored attachment
// with block fields, which renders well in channels.
type slackMessage struct {
	Text        string            `json:"text"`
	Attachments []slackAttachment `json:"attachments"`
}

type slackAttachment struct {
	Color  string       `json:"color"`
	Blocks []slackBlock `json:"blocks"`
}

type slackBlock struct {
	Type   string      `json:"type"`
	Text   *slackText  `json:"text,omitempty"`
	Fields []slackText `json:"fields,omitempty"`
}

type slackText struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// deliverSlack POSTs a human-readable, Slack-formatted message to the incoming
// webhook URL at config.url.
func (d *Dispatcher) deliverSlack(ctx context.Context, cfg map[string]any, p Payload) error {
	url := configString(cfg, "url")
	if url == "" {
		return fmt.Errorf("slack target missing url")
	}

	msg := buildSlackMessage(p)
	body, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("marshal slack payload: %w", err)
	}
	return d.post(ctx, url, "application/json", body, nil)
}

// buildSlackMessage renders a Payload into a Slack message. Exported indirectly
// via tests in the same package.
func buildSlackMessage(p Payload) slackMessage {
	header := fmt.Sprintf(":rotating_light: CostObs alert: *%s*", p.RuleName)

	fields := []slackText{
		{Type: "mrkdwn", Text: fmt.Sprintf("*Org:*\n%s", p.OrgSlug)},
		{Type: "mrkdwn", Text: fmt.Sprintf("*Kind:*\n%s", p.Kind)},
		{Type: "mrkdwn", Text: fmt.Sprintf("*Observed:*\n$%.2f", p.ObservedUSD)},
		{Type: "mrkdwn", Text: fmt.Sprintf("*Threshold:*\n$%.2f", p.ThresholdUSD)},
	}

	blocks := []slackBlock{
		{Type: "section", Text: &slackText{Type: "mrkdwn", Text: header}},
		{Type: "section", Fields: fields},
	}
	if scope := formatScope(p.Scope); scope != "" {
		blocks = append(blocks, slackBlock{
			Type: "section",
			Text: &slackText{Type: "mrkdwn", Text: "*Scope:* " + scope},
		})
	}

	return slackMessage{
		Text: fmt.Sprintf("CostObs alert: %s (observed $%.2f > threshold $%.2f)",
			p.RuleName, p.ObservedUSD, p.ThresholdUSD),
		Attachments: []slackAttachment{{Color: "#d93025", Blocks: blocks}},
	}
}

// formatScope renders the scope map deterministically as "k=v, k2=v2", or "all
// traffic" when empty.
func formatScope(scope map[string]string) string {
	if len(scope) == 0 {
		return "all traffic"
	}
	keys := make([]string, 0, len(scope))
	for k := range scope {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("`%s=%s`", k, scope[k]))
	}
	return strings.Join(parts, ", ")
}
