import { ValidationError } from '../errors/domain-errors.js';

type TokenEndpointAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic' | 'private_key_jwt';

export function assertClientSecretAuthMethod(input: {
  clientSecret: string | null | undefined;
  tokenEndpointAuthMethod: TokenEndpointAuthMethod;
}): void {
  const hasClientSecret = typeof input.clientSecret === 'string' && input.clientSecret.trim().length > 0;
  if (hasClientSecret && input.tokenEndpointAuthMethod === 'none') {
    throw new ValidationError(
      'Remote MCP OAuth client secret must use client_secret_post, client_secret_basic, or private_key_jwt',
    );
  }
}
