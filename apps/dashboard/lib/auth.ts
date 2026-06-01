import 'server-only';

// Pluggable auth seam.
//
// COSTOBS_AUTH_MODE:
//   - "none" (default): single-user dev. No login. Org comes from
//     COSTOBS_DEFAULT_ORG_SLUG (default "default"), user is synthetic.
//   - "oidc": self-hosted SSO. We expose a stub here so there is no hard
//     dependency on any SaaS auth provider. A real deployment would wire
//     NextAuth/Auth.js or a custom OIDC handler and resolve the session
//     here; until then it falls back to the default org so the app still
//     renders rather than crashing.

export type AuthMode = 'none' | 'oidc';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface Session {
  orgSlug: string;
  user: SessionUser;
}

export function authMode(): AuthMode {
  return process.env.COSTOBS_AUTH_MODE === 'oidc' ? 'oidc' : 'none';
}

function defaultOrgSlug(): string {
  return process.env.COSTOBS_DEFAULT_ORG_SLUG || 'default';
}

const SYNTHETIC_USER: SessionUser = {
  id: 'local',
  email: 'dev@localhost',
  name: 'Local Dev',
};

/**
 * Returns the current session: { orgSlug, user }.
 * Always resolves in "none" mode without any external config.
 */
export async function auth(): Promise<Session> {
  if (authMode() === 'oidc') {
    return resolveOidcSession();
  }
  return { orgSlug: defaultOrgSlug(), user: SYNTHETIC_USER };
}

/**
 * Stubbed OIDC resolution. Wire your provider here. Kept fully optional:
 * if no provider/session is configured we degrade to the default org so the
 * `none` path and the build never depend on OIDC being set up.
 */
async function resolveOidcSession(): Promise<Session> {
  // TODO: integrate NextAuth/Auth.js (getServerSession) or a custom OIDC
  // token verification and map the subject -> users/memberships in Postgres.
  return {
    orgSlug: defaultOrgSlug(),
    user: SYNTHETIC_USER,
  };
}
