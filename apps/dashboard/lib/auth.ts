import 'server-only';

// Pluggable auth seam.
//
// COSTOBS_AUTH_MODE:
//   - "none" (default): single-user dev. No login. Org comes from
//     COSTOBS_DEFAULT_ORG_SLUG (default "default"), user is synthetic.
//   - "oidc": self-hosted SSO. We expose a seam here so there is no hard
//     dependency on any SaaS auth provider. A real deployment must wire
//     NextAuth/Auth.js or a custom OIDC handler and resolve the session
//     here; until that is done, "oidc" mode fails closed instead of
//     silently serving the default org to unauthenticated visitors.

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
 * OIDC resolution seam. Wire your provider here (NextAuth/Auth.js
 * getServerSession or custom token verification mapping the subject to
 * users/memberships in Postgres). Until wired, this FAILS CLOSED: serving
 * the default org to every unauthenticated visitor would be an auth bypass.
 */
async function resolveOidcSession(): Promise<Session> {
  throw new Error(
    'COSTOBS_AUTH_MODE=oidc is set but no OIDC provider is wired in ' +
      'lib/auth.ts (resolveOidcSession). Refusing to serve data without ' +
      'authentication — integrate your OIDC provider or set ' +
      'COSTOBS_AUTH_MODE=none for single-user mode.',
  );
}
