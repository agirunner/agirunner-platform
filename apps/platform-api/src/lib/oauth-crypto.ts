/**
 * OAuth token storage utilities.
 *
 * Tokens are stored as-is — same as API keys in `api_key_secret_ref`.
 * If at-rest encryption is added later, it should cover ALL credentials
 * (API keys + OAuth tokens) uniformly, not just OAuth.
 */

/** Store a token (identity function — no encryption). */
export function storeOAuthToken(plaintext: string): string {
  return plaintext;
}

/** Read a stored token (identity function — no decryption). */
export function readOAuthToken(stored: string): string {
  return stored;
}
