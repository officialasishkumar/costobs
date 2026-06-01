package deliver

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// SignatureHeader is the header carrying the HMAC-SHA256 body signature.
const SignatureHeader = "X-CostObs-Signature"

// deliverWebhook POSTs the JSON payload to config.url. When config.secret is
// present, it adds an HMAC-SHA256 signature of the exact request body in the
// X-CostObs-Signature header, formatted as "sha256=<hex>".
func (d *Dispatcher) deliverWebhook(ctx context.Context, cfg map[string]any, p Payload) error {
	url := configString(cfg, "url")
	if url == "" {
		return fmt.Errorf("webhook target missing url")
	}

	body, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("marshal webhook payload: %w", err)
	}

	headers := map[string]string{}
	if secret := configString(cfg, "secret"); secret != "" {
		headers[SignatureHeader] = "sha256=" + signHMAC(secret, body)
	}

	return d.post(ctx, url, "application/json", body, headers)
}

// signHMAC returns the lowercase hex HMAC-SHA256 of body keyed by secret.
func signHMAC(secret string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifySignature reports whether sig (the full "sha256=<hex>" header value)
// is a valid HMAC-SHA256 of body under secret. Exported for use in tests and
// by webhook receivers.
func VerifySignature(secret string, body []byte, sig string) bool {
	const prefix = "sha256="
	if len(sig) <= len(prefix) || sig[:len(prefix)] != prefix {
		return false
	}
	want := signHMAC(secret, body)
	return hmac.Equal([]byte(sig[len(prefix):]), []byte(want))
}

// newReader wraps a byte slice in a fresh reader for each request attempt.
func newReader(b []byte) io.Reader { return bytes.NewReader(b) }

// drainAndClose drains and closes a response body so connections can be reused.
func drainAndClose(resp *http.Response) {
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()
}
