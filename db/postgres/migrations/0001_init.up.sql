CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE orgs (
    id          BIGSERIAL PRIMARY KEY,
    slug        TEXT UNIQUE NOT NULL,           -- == ClickHouse org_id (stable, human-readable)
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
    id           BIGSERIAL PRIMARY KEY,
    email        CITEXT UNIQUE NOT NULL,
    oidc_subject TEXT UNIQUE,                   -- null in localhost no-auth mode
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
    org_id  BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role    TEXT NOT NULL DEFAULT 'admin',      -- admin|viewer
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE api_keys (
    id           BIGSERIAL PRIMARY KEY,
    org_id       BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    key_prefix   TEXT NOT NULL,                 -- first 8 chars; lookup handle shown in UI
    key_hash     BYTEA NOT NULL,                -- argon2id(secret)
    last_used_at TIMESTAMPTZ,
    revoked_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX api_keys_active_prefix ON api_keys (key_prefix) WHERE revoked_at IS NULL;

CREATE TABLE alert_rules (
    id               BIGSERIAL PRIMARY KEY,
    org_id           BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    kind             TEXT NOT NULL,             -- daily_threshold|spike|monthly_budget
    scope            JSONB NOT NULL DEFAULT '{}'::jsonb,
    config           JSONB NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT true,
    last_fired_at    TIMESTAMPTZ,
    cooldown_seconds INT NOT NULL DEFAULT 3600,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alert_targets (
    id        BIGSERIAL PRIMARY KEY,
    rule_id   BIGINT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    kind      TEXT NOT NULL,                    -- webhook|slack
    config    JSONB NOT NULL
);

CREATE TABLE dashboards (
    id         BIGSERIAL PRIMARY KEY,
    org_id     BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    layout     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pricing_overrides (
    id           BIGSERIAL PRIMARY KEY,
    org_id       BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    provider     TEXT NOT NULL,
    model        TEXT NOT NULL,
    pricing      JSONB NOT NULL,
    effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, provider, model, effective_at)
);
