import type { AppEnv } from '../config/schema.js';

export interface SSOProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface SSOUserInfo {
  email: string;
  displayName: string;
  providerUserId: string;
  provider: string;
}

type SsoProviderEnv = Pick<
  AppEnv,
  | 'AGIRUNNER_BASE_URL'
  | 'AGIRUNNER_SSO_GOOGLE_CLIENT_ID'
  | 'AGIRUNNER_SSO_GOOGLE_CLIENT_SECRET'
  | 'AGIRUNNER_SSO_GOOGLE_REDIRECT_URI'
  | 'AGIRUNNER_SSO_GITHUB_CLIENT_ID'
  | 'AGIRUNNER_SSO_GITHUB_CLIENT_SECRET'
  | 'AGIRUNNER_SSO_GITHUB_REDIRECT_URI'
>;

export function getSSOProviderConfig(provider: string, env: SsoProviderEnv): SSOProviderConfig | null {
  const config = readProviderConfig(provider, env);
  if (!config.clientId || !config.clientSecret) {
    return null;
  }
  return config;
}

export function buildAuthorizationUrl(provider: string, config: SSOProviderConfig, state: string): string {
  const params = new URLSearchParams();
  params.set('client_id', config.clientId);
  params.set('redirect_uri', `${config.redirectUri}/api/v1/auth/sso/${provider}/callback`);
  params.set('state', state);
  params.set('response_type', 'code');

  switch (provider) {
    case 'google':
      params.set('scope', 'openid email profile');
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    case 'github':
      params.set('scope', 'read:user user:email');
      return `https://github.com/login/oauth/authorize?${params}`;
    default:
      throw new Error(`Unsupported SSO provider: ${provider}`);
  }
}

export async function exchangeCodeForUser(
  provider: string,
  config: SSOProviderConfig,
  code: string,
): Promise<SSOUserInfo> {
  switch (provider) {
    case 'google':
      return exchangeGoogle(config, code);
    case 'github':
      return exchangeGitHub(config, code);
    default:
      throw new Error(`Unsupported SSO provider: ${provider}`);
  }
}

function readProviderConfig(provider: string, env: SsoProviderEnv): SSOProviderConfig {
  switch (provider) {
    case 'google':
      return {
        clientId: env.AGIRUNNER_SSO_GOOGLE_CLIENT_ID ?? '',
        clientSecret: env.AGIRUNNER_SSO_GOOGLE_CLIENT_SECRET ?? '',
        redirectUri: env.AGIRUNNER_SSO_GOOGLE_REDIRECT_URI ?? env.AGIRUNNER_BASE_URL ?? '',
      };
    case 'github':
      return {
        clientId: env.AGIRUNNER_SSO_GITHUB_CLIENT_ID ?? '',
        clientSecret: env.AGIRUNNER_SSO_GITHUB_CLIENT_SECRET ?? '',
        redirectUri: env.AGIRUNNER_SSO_GITHUB_REDIRECT_URI ?? env.AGIRUNNER_BASE_URL ?? '',
      };
    default:
      return { clientId: '', clientSecret: '', redirectUri: '' };
  }
}

async function exchangeGoogle(config: SSOProviderConfig, code: string): Promise<SSOUserInfo> {
  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: `${config.redirectUri}/api/v1/auth/sso/google/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResp.ok) {
    const err = await tokenResp.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  const tokens = (await tokenResp.json()) as { access_token: string };

  const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userResp.ok) throw new Error('Failed to fetch Google user info');

  const user = (await userResp.json()) as { id: string; email: string; name: string };
  return { email: user.email, displayName: user.name, providerUserId: user.id, provider: 'google' };
}

async function exchangeGitHub(config: SSOProviderConfig, code: string): Promise<SSOUserInfo> {
  const tokenResp = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!tokenResp.ok) throw new Error('GitHub token exchange failed');

  const tokens = (await tokenResp.json()) as { access_token: string };

  const [userResp, emailsResp] = await Promise.all([
    fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    }),
    fetch('https://api.github.com/user/emails', {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
    }),
  ]);

  if (!userResp.ok) throw new Error('Failed to fetch GitHub user info');

  const user = (await userResp.json()) as { id: number; login: string; name: string | null };

  let email = '';
  if (emailsResp.ok) {
    const emails = (await emailsResp.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
    const primary = emails.find((e) => e.primary && e.verified);
    if (primary) email = primary.email;
  }

  return {
    email,
    displayName: user.name ?? user.login,
    providerUserId: String(user.id),
    provider: 'github',
  };
}
