# Self-Hosting CostObs

CostObs ships in two self-hosting modes, both **fully offline** — no external
service calls, no licensing checks, no phone-home telemetry.

- **Mode A — Docker Compose.** One machine, one command. Best for local dev and
  a 5-minute evaluation.
- **Mode B — Kubernetes (Helm).** Production self-hosting: scaling, TLS/ingress,
  OIDC, and bring-your-own external Postgres + ClickHouse.

---

## Mode A — Docker Compose

### Prerequisites
- Docker + Docker Compose v2.
- ~3 GB RAM free (ClickHouse is capped at 2 GB, Postgres at 512 MB).

### Bring up the stack
```bash
cp .env.example .env       # adjust if you like; defaults work offline
docker compose up          # add -d to detach
```

This starts ClickHouse, Postgres, runs the `pg-migrate` and `ch-migrate`
one-shot golang-migrate jobs, then `ingest` (:8080), `alertd`, and the
`dashboard` (:3000). The `ingest` service self-seeds a default org and a dev API
key on boot (`COSTOBS_DEV_SEED=true`).

Services and ports:

| Service | Port | Purpose |
| --- | --- | --- |
| dashboard | 3000 | UI + read API |
| ingest | 8080 | `POST /v1/events`, `/healthz`, `/metrics` |
| clickhouse | 8123 / 9000 | HTTP / native |
| postgres | 5432 | metadata |

Open the dashboard at <http://localhost:3000>.

### 5-minute SDK demo (with the dev key)
The dev seed creates org `default` with API key `costobs_dev_secret_key` (both
configurable in `.env`).

```bash
pip install costobs   # or: cd sdks/python && pip install -e .

export COSTOBS_INGEST_URL=http://localhost:8080
export COSTOBS_API_KEY=costobs_dev_secret_key
python sdks/python/examples/quickstart.py
```

The quickstart runs fully offline (it falls back to a fake OpenAI-shaped client
if no `OPENAI_API_KEY` is set), so it exercises wrap → local cost calc →
background ship without needing a real provider key. Minimal usage in your own
code:

```python
import costobs
from openai import OpenAI

costobs.configure(
    ingest_url="http://localhost:8080",
    api_key="costobs_dev_secret_key",
)

client = costobs.wrap(OpenAI(), team="payments", environment="prod", service="api")

with costobs.request_context(customer_id="cust-42", trace_id="trace-abc"):
    client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": "hello"}],
        feature="summarize",
        prompt_version="v1",
    )

costobs.flush()   # drain telemetry (e.g. before a short-lived script exits)
```

Refresh the dashboard — the event, its cost, and its attribution dimensions are
there.

### Tear down
```bash
docker compose down          # keep data
docker compose down -v       # also drop the clickhouse/postgres volumes
```

---

## Mode B — Kubernetes (Helm)

Chart location: `deploy/helm/costobs`. Example value files:
`deploy/k8s-examples/values-small.yaml`, `deploy/k8s-examples/values-prod.yaml`.

### What the chart deploys
- **ingest** — stateless Deployment, horizontally scalable (replicas + HPA).
- **dashboard** — stateless Deployment, horizontally scalable (replicas + HPA).
- **alertd** — **singleton** Deployment (`replicas: 1`, `Recreate` strategy). It
  is a periodic worker; running more than one would double-fire alerts.
- **postgres / clickhouse** — optional **bundled single-node StatefulSets**, or
  disabled in favor of external managed databases (BYO).
- **migrations** — golang-migrate run as Helm **pre-install / pre-upgrade hook
  Jobs**, with the SQL mounted from ConfigMaps.

> **Why no Bitnami subcharts?** The bundled databases are our own minimal
> StatefulSets, so `helm install` pulls **zero** external Helm repositories.
> Every dependency is a plain OCI image you can mirror once into a private
> registry — which is what makes the air-gapped story work.

### Quick install (small / single-node)
```bash
helm install costobs deploy/helm/costobs \
  -f deploy/k8s-examples/values-small.yaml \
  --namespace costobs --create-namespace
```

This bundles single-node Postgres + ClickHouse, runs 1 replica of each app
tier, and (for the demo) enables `devSeed`. There is no ingress; use
port-forward:

```bash
kubectl -n costobs port-forward svc/costobs-dashboard 3000:3000
# open http://localhost:3000

kubectl -n costobs port-forward svc/costobs-ingest 8080:8080
# point the SDK at COSTOBS_INGEST_URL=http://localhost:8080
```

Retrieve the seeded dev key:
```bash
kubectl -n costobs get secret costobs-creds \
  -o jsonpath='{.data.dev-api-key}' | base64 -d; echo
```

### Production install (BYO databases + TLS + OIDC)
Create the prerequisite Secrets first so passwords never live in values files:

```bash
kubectl -n costobs create secret generic costobs-db \
  --from-literal=postgres-dsn='postgres://costobs:***@pg.internal:5432/costobs?sslmode=require' \
  --from-literal=clickhouse-dsn='clickhouse://costobs:***@ch.internal:9000/costobs' \
  --from-literal=clickhouse-http-url='https://costobs:***@ch.internal:8443/costobs'

kubectl -n costobs create secret generic costobs-oidc \
  --from-literal=client-secret='***'

helm install costobs deploy/helm/costobs \
  -f deploy/k8s-examples/values-prod.yaml \
  --namespace costobs --create-namespace
```

`values-prod.yaml` sets `postgres.enabled=false` / `clickhouse.enabled=false`,
ingest 3 replicas + HPA, dashboard 2 replicas + HPA, ingress + TLS, OIDC auth,
and `devSeed.enabled=false`.

### Bring-your-own (external) databases
Set `enabled: false` and provide connection details. Two options:

**A. Reference an existing Secret (recommended for prod):**
```yaml
postgres:
  enabled: false
  external:
    existingSecret: costobs-db    # key: postgres-dsn
clickhouse:
  enabled: false
  external:
    existingSecret: costobs-db    # keys: clickhouse-dsn, clickhouse-http-url
```

**B. Inline DSNs (chart stores them in a generated Secret):**
```yaml
postgres:
  enabled: false
  external:
    dsn: "postgres://user:pass@host:5432/costobs?sslmode=require"
clickhouse:
  enabled: false
  external:
    dsn: "clickhouse://user:pass@host:9000/costobs"
    httpUrl: "https://user:pass@host:8443/costobs"   # ClickHouse Cloud uses 8443
```

DSN reference: native `clickhouse://user:pass@host:9000/db` for ingest/alertd
and migrations; HTTP `http(s)://user:pass@host:PORT/db` for the dashboard;
Postgres `postgres://user:pass@host:5432/db?sslmode=...`. For ClickHouse Cloud,
use TLS native (`secure`) per your driver and the HTTPS endpoint for `httpUrl`.

### TLS and ingress
```yaml
ingress:
  enabled: true
  className: nginx
  host: costobs.example.com
  ingestHost: ingest.costobs.example.com   # omit to serve ingest at /v1 on host
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  tls:
    enabled: true
    secretName: costobs-tls
```
With cert-manager, `tls.secretName` is the Secret it mints. Without it, create a
TLS Secret named `costobs-tls` (keys `tls.crt`/`tls.key`) yourself. If
`ingestHost` is empty, the ingest API is exposed at `/v1` on the dashboard host.

### OIDC auth (optional, off by default)
The dashboard defaults to `authMode: none` (single-user / trusted-network).
Enable OIDC:
```yaml
dashboard:
  authMode: oidc
  oidc:
    issuer: "https://id.example.com/realms/costobs"
    clientId: "costobs-dashboard"
    existingSecret: costobs-oidc   # key: client-secret
```
These map to `COSTOBS_AUTH_MODE` / `COSTOBS_OIDC_ISSUER` /
`COSTOBS_OIDC_CLIENT_ID` / `COSTOBS_OIDC_CLIENT_SECRET`.

### Scaling
- **ingest** and **dashboard** are stateless. Set fixed `replicas`, or enable
  the HPA:
  ```yaml
  ingest:    { autoscaling: { enabled: true, minReplicas: 3, maxReplicas: 12, targetCPUUtilizationPercentage: 70 } }
  dashboard: { autoscaling: { enabled: true, minReplicas: 2, maxReplicas: 6,  targetCPUUtilizationPercentage: 70 } }
  ```
  (HPA requires `metrics-server`.)
- **alertd** must stay at `replicas: 1`. Do not scale it.
- **ClickHouse**: the bundled instance is single-node — fine for small/medium
  deployments. For large volume use external ClickHouse Cloud or a cluster and
  set `clickhouse.enabled=false`.

### Migrations (Helm hooks)
When `migrations.enabled=true` (default), two hook Jobs run on **pre-install**
and **pre-upgrade** (`costobs-migrate-pg`, `costobs-migrate-ch`) using the
`migrate/migrate` image — mirroring the compose `pg-migrate` / `ch-migrate`
commands. The SQL is embedded from `deploy/helm/costobs/migrations/{postgres,
clickhouse}/` into ConfigMaps and mounted at `/migrations`. On a fresh install
with bundled DBs, an init container waits for the database to accept
connections before `migrate ... up` runs. Failed Job pods are kept for
debugging (`hookDeletePolicy`).

To inspect a migration run:
```bash
kubectl -n costobs logs job/costobs-migrate-ch
kubectl -n costobs logs job/costobs-migrate-pg
```

### Air-gapped notes
- **No Helm repo dependencies.** `helm install` resolves nothing over the
  network beyond the images you reference.
- **Mirror images into a private registry**, then point everything at it:
  ```yaml
  global:
    imageRegistry: "registry.internal:5000"
    imagePullSecrets:
      - name: regcred
  ```
  Images to mirror: the CostObs ingest/dashboard/alertd images, plus
  `postgres:16-alpine`, `clickhouse/clickhouse-server:24.8-alpine`, and
  `migrate/migrate:v4.17.1` (only the DB/migrate images you actually use).
- No service phones home, validates a license, or requires reaching a SaaS
  control plane. The pricing file is bundled in the SDK and shipped in-repo
  (`shared/pricing/`); update it locally (see [pricing.md](pricing.md)).

### Verify the chart locally
```bash
helm lint deploy/helm/costobs
helm template costobs deploy/helm/costobs
helm template costobs deploy/helm/costobs -f deploy/k8s-examples/values-prod.yaml
```

### Uninstall
```bash
helm uninstall costobs -n costobs
# The generated creds Secret (costobs-creds) and any PVCs are retained by
# design; delete them explicitly if you want a clean slate:
kubectl -n costobs delete secret costobs-creds
kubectl -n costobs delete pvc -l app.kubernetes.io/instance=costobs
```
