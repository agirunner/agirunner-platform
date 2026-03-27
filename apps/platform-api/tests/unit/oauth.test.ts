import { createHash } from 'node:crypto';

import { beforeEach, describe, expect, it } from 'vitest';

import { generateCodeVerifier, generateCodeChallenge, generateState } from '../../src/lib/pkce.js';
import { decodeJwtPayload, extractChatGptAccountId, extractEmailFromJwt } from '../../src/lib/jwt-decode.js';
import {
  configureProviderSecretEncryptionKey,
  storeOAuthToken,
  readOAuthToken,
  storeProviderSecret,
  readProviderSecret,
} from '../../src/lib/oauth-crypto.js';
import { getOAuthProfile, listOAuthProfiles, OPENAI_CODEX_PROFILE } from '../../src/catalogs/oauth-profiles.js';

/* ─── PKCE ──────────────────────────────────────────────────────────────── */

describe('PKCE utilities', () => {
  it('generateCodeVerifier returns a 64-char hex string', () => {
    const verifier = generateCodeVerifier();
    expect(verifier).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(verifier)).toBe(true);
  });

  it('generateCodeVerifier produces unique values', () => {
    const a = generateCodeVerifier();
    const b = generateCodeVerifier();
    expect(a).not.toBe(b);
  });

  it('generateCodeChallenge produces correct SHA-256 base64url digest', () => {
    const verifier = 'test-verifier-value';
    const challenge = generateCodeChallenge(verifier);
    const expected = createHash('sha256').update(verifier, 'utf8').digest('base64url');
    expect(challenge).toBe(expected);
  });

  it('generateState returns a 64-char hex string', () => {
    const state = generateState();
    expect(state).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(state)).toBe(true);
  });

  it('generateState produces unique values', () => {
    const a = generateState();
    const b = generateState();
    expect(a).not.toBe(b);
  });
});

/* ─── JWT Decode ────────────────────────────────────────────────────────── */

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = Buffer.from('fake-signature').toString('base64url');
  return `${header}.${body}.${signature}`;
}

describe('JWT decode', () => {
  it('decodeJwtPayload extracts payload from a JWT', () => {
    const token = createJwt({ sub: 'user-123', email: 'test@example.com' });
    const payload = decodeJwtPayload(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.email).toBe('test@example.com');
  });

  it('decodeJwtPayload throws on malformed token', () => {
    expect(() => decodeJwtPayload('not-a-jwt')).toThrow('expected 3 parts');
  });

  it('decodeJwtPayload throws on invalid JSON payload', () => {
    const header = Buffer.from('{}').toString('base64url');
    const body = Buffer.from('not-json').toString('base64url');
    const sig = Buffer.from('sig').toString('base64url');
    expect(() => decodeJwtPayload(`${header}.${body}.${sig}`)).toThrow('not valid JSON');
  });

  it('extractChatGptAccountId extracts account ID from auth claim', () => {
    const token = createJwt({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_abc123',
      },
    });
    expect(extractChatGptAccountId(token)).toBe('acct_abc123');
  });

  it('extractChatGptAccountId throws when auth claim is missing', () => {
    const token = createJwt({ sub: 'user' });
    expect(() => extractChatGptAccountId(token)).toThrow('missing');
  });

  it('extractChatGptAccountId throws when account ID is missing', () => {
    const token = createJwt({
      'https://api.openai.com/auth': {},
    });
    expect(() => extractChatGptAccountId(token)).toThrow('missing chatgpt_account_id');
  });

  it('extractEmailFromJwt returns email when present', () => {
    const token = createJwt({ email: 'user@example.com' });
    expect(extractEmailFromJwt(token)).toBe('user@example.com');
  });

  it('extractEmailFromJwt returns null when email is absent', () => {
    const token = createJwt({ sub: 'user' });
    expect(extractEmailFromJwt(token)).toBeNull();
  });
});

/* ─── OAuth Token Storage ──────────────────────────────────────────────── */

describe('OAuth token storage', () => {
  beforeEach(() => {
    configureProviderSecretEncryptionKey('test-encryption-key');
  });

  it('storeOAuthToken encrypts the token at rest', () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.test-access-token.signature';
    expect(storeOAuthToken(token)).not.toBe(token);
  });

  it('readOAuthToken decrypts encrypted values', () => {
    const token = 'eyJhbGciOiJSUzI1NiJ9.test-access-token.signature';
    expect(readOAuthToken(storeOAuthToken(token))).toBe(token);
  });

  it('roundtrips losslessly', () => {
    const token = 'sk-test-token-with-special-chars-!@#$%';
    expect(readOAuthToken(storeOAuthToken(token))).toBe(token);
  });

  it('reads legacy plaintext provider secrets for compatibility', () => {
    expect(readProviderSecret('legacy-secret')).toBe('legacy-secret');
  });

  it('roundtrips provider API secrets losslessly', () => {
    const secret = 'sk-provider-live-secret';
    expect(readProviderSecret(storeProviderSecret(secret))).toBe(secret);
  });
});

/* ─── OAuth Profiles ────────────────────────────────────────────────────── */

describe('OAuth profiles', () => {
  it('getOAuthProfile returns the openai-codex profile', () => {
    const profile = getOAuthProfile('openai-codex');
    expect(profile.profileId).toBe('openai-codex');
    expect(profile.displayName).toBe('OpenAI (Subscription)');
    expect(profile.description).toBe('Use your ChatGPT subscription to access OpenAI models.');
    expect(profile.tokenLifetime).toBe('short');
    expect(profile.costModel).toBe('subscription');
    expect(profile.authorizeUrl).toContain('auth.openai.com');
    expect(profile.tokenUrl).toContain('auth.openai.com');
  });

  it('getOAuthProfile throws for unknown profile', () => {
    expect(() => getOAuthProfile('nonexistent')).toThrow('Unknown OAuth provider profile');
  });

  it('listOAuthProfiles returns all profiles', () => {
    const profiles = listOAuthProfiles();
    expect(profiles.length).toBeGreaterThan(0);
    expect(profiles[0].profileId).toBe('openai-codex');
  });

  it('openai-codex profile has static models', () => {
    expect(OPENAI_CODEX_PROFILE.staticModels.length).toBeGreaterThan(0);
    const modelIds = OPENAI_CODEX_PROFILE.staticModels.map((m) => m.modelId);
    expect(modelIds).toContain('gpt-5.4');
    expect(modelIds).toContain('gpt-5.4-mini');
    expect(modelIds).toContain('gpt-5.3-codex');
  });

  it('openai-codex exposes gpt-5.4-mini with low medium high reasoning', () => {
    const model = OPENAI_CODEX_PROFILE.staticModels.find((entry) => entry.modelId === 'gpt-5.4-mini');
    expect(model).toBeDefined();
    expect(model?.endpointType).toBe('responses');
    expect(model?.supportsToolUse).toBe(true);
    expect(model?.supportsVision).toBe(true);
    expect(model?.contextWindow).toBe(400000);
    expect(model?.maxOutputTokens).toBe(128000);
    expect(model?.reasoningConfig).toEqual({
      type: 'reasoning_effort',
      options: ['low', 'medium', 'high'],
      default: 'medium',
    });
  });

  it('openai-codex profile uses responses endpoint', () => {
    expect(OPENAI_CODEX_PROFILE.endpointType).toBe('responses');
    for (const model of OPENAI_CODEX_PROFILE.staticModels) {
      expect(model.endpointType).toBe('responses');
    }
  });

  it('openai-codex does not expose removed spark models', () => {
    const model = OPENAI_CODEX_PROFILE.staticModels.find((entry) => entry.modelId === 'gpt-5.3-codex-spark');
    expect(model).toBeUndefined();
  });

  it('openai-codex profile has PKCE authorize params matching Codex CLI', () => {
    expect(OPENAI_CODEX_PROFILE.scopes).toContain('offline_access');
    expect(OPENAI_CODEX_PROFILE.scopes).toContain('openid');
    expect(OPENAI_CODEX_PROFILE.scopes).toContain('email');
    expect(OPENAI_CODEX_PROFILE.clientId).toBeTruthy();
    expect(OPENAI_CODEX_PROFILE.extraAuthorizeParams.codex_cli_simplified_flow).toBe('true');
  });
});
