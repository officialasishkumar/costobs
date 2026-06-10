.PHONY: dev up down logs migrate seed test lint sdk-test ingest-test fmt

# --- Mode A: localhost ---
dev up: ## bring up the full local stack
	docker compose up --build

down: ## tear down (keep volumes)
	docker compose down

clean: ## tear down + wipe data volumes
	docker compose down -v

logs:
	docker compose logs -f

# --- migrations (run inside compose network; usually automatic via *-migrate services) ---
migrate:
	docker compose up pg-migrate ch-migrate

# seed default org + dev api key (idempotent; also runs on ingest boot when COSTOBS_DEV_SEED=true)
seed:
	docker compose exec ingest /ingest seed

# --- tests ---
test: sdk-test ingest-test

sdk-test:
	cd sdks/python && python -m pytest -q
	cd sdks/go && go test ./...

ingest-test:
	cd services/ingest && go test ./...
	cd services/alertd && go test ./...
	cd services/billsyncd && go test ./...

lint:
	cd services/ingest && go vet ./...
	cd services/alertd && go vet ./...
	cd services/billsyncd && go vet ./...

fmt:
	cd services/ingest && go fmt ./...
	cd services/alertd && go fmt ./...
	cd sdks/python && python -m ruff format . || true

# copy the canonical pricing file into both SDK bundles
sync-pricing:
	cp shared/pricing/pricing-v2026.06.yaml sdks/python/costobs/data/
	cp shared/pricing/pricing-v2026.06.yaml sdks/typescript/src/data/
	cp shared/pricing/pricing-v2026.06.yaml sdks/go/data/

# populate the dashboard with synthetic demo data (no provider key needed)
demo-data:
	./scripts/seed-demo.sh

# copy canonical db/ migrations into the Helm chart bundle
sync-chart:
	cp db/clickhouse/migrations/*.sql deploy/helm/costobs/migrations/clickhouse/
	cp db/postgres/migrations/*.sql deploy/helm/costobs/migrations/postgres/
