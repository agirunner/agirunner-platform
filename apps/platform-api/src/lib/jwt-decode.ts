/**
 * Decodes a JWT payload without signature verification.
 * Used to extract claims from OpenAI Codex OAuth tokens.
 * We do NOT validate the signature — OpenAI's API validates the token on each request.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT: expected 3 parts separated by dots');
  }

  const payloadBase64 = parts[1];
  const payloadJson = Buffer.from(payloadBase64, 'base64url').toString('utf8');

  try {
    return JSON.parse(payloadJson) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JWT: payload is not valid JSON');
  }
}

/**
 * Extracts the ChatGPT account ID from an OpenAI Codex OAuth access token.
 * The account ID is at claim path "https://api.openai.com/auth" → "chatgpt_account_id".
 */
export function extractChatGptAccountId(accessToken: string): string {
  const payload = decodeJwtPayload(accessToken);
  const authClaim = payload['https://api.openai.com/auth'] as Record<string, unknown> | undefined;

  if (!authClaim || typeof authClaim !== 'object') {
    throw new Error('JWT missing "https://api.openai.com/auth" claim');
  }

  const accountId = authClaim.chatgpt_account_id;
  if (typeof accountId !== 'string' || accountId.length === 0) {
    throw new Error('JWT missing chatgpt_account_id in auth claim');
  }

  return accountId;
}

/**
 * Extracts the email from a JWT (from the standard "email" claim or id_token).
 */
export function extractEmailFromJwt(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const email = payload.email;
  return typeof email === 'string' ? email : null;
}
