import { createHash, randomBytes } from 'node:crypto';

const VERIFIER_LENGTH_BYTES = 32;
const STATE_LENGTH_BYTES = 32;

export function generateCodeVerifier(): string {
  return randomBytes(VERIFIER_LENGTH_BYTES).toString('hex');
}

export function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier, 'utf8')
    .digest('base64url');
}

export function generateState(): string {
  return randomBytes(STATE_LENGTH_BYTES).toString('hex');
}
