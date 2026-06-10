package costobs

import "context"

// Metadata is request-scoped attribution attached to observed calls.
// Unknown attribution should go in Tags.
type Metadata struct {
	Environment   string
	Team          string
	Service       string
	CustomerID    string
	UserID        string
	TraceID       string
	Feature       string
	PromptKey     string
	PromptVersion string
	Tags          map[string]string
}

type ctxKey struct{}

// WithMetadata returns a context carrying metadata for calls made beneath it.
// Nested calls merge: inner non-zero fields override outer ones, tags union.
func WithMetadata(ctx context.Context, m Metadata) context.Context {
	if existing, ok := ctx.Value(ctxKey{}).(Metadata); ok {
		m = mergeMetadata(existing, m)
	}
	return context.WithValue(ctx, ctxKey{}, m)
}

// MetadataFrom extracts the active metadata (zero value if none).
func MetadataFrom(ctx context.Context) Metadata {
	if m, ok := ctx.Value(ctxKey{}).(Metadata); ok {
		return m
	}
	return Metadata{}
}

func mergeMetadata(base, over Metadata) Metadata {
	pick := func(b, o string) string {
		if o != "" {
			return o
		}
		return b
	}
	out := Metadata{
		Environment:   pick(base.Environment, over.Environment),
		Team:          pick(base.Team, over.Team),
		Service:       pick(base.Service, over.Service),
		CustomerID:    pick(base.CustomerID, over.CustomerID),
		UserID:        pick(base.UserID, over.UserID),
		TraceID:       pick(base.TraceID, over.TraceID),
		Feature:       pick(base.Feature, over.Feature),
		PromptKey:     pick(base.PromptKey, over.PromptKey),
		PromptVersion: pick(base.PromptVersion, over.PromptVersion),
	}
	if len(base.Tags) > 0 || len(over.Tags) > 0 {
		out.Tags = make(map[string]string, len(base.Tags)+len(over.Tags))
		for k, v := range base.Tags {
			out.Tags[k] = v
		}
		for k, v := range over.Tags {
			out.Tags[k] = v
		}
	}
	return out
}
