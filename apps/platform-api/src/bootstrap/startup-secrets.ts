function requireSecretValue(
  source: NodeJS.ProcessEnv,
  envName: 'JWT_SECRET' | 'WEBHOOK_ENCRYPTION_KEY',
): string {
  const secretValue = source[envName];

  if (!secretValue || secretValue.trim().length === 0) {
    throw new Error(`Missing required environment variable ${envName}. Set ${envName} before starting platform-api.`);
  }

  return secretValue;
}

function assertSecretMinLength(secretValue: string, envName: string, minLength: number): void {
  if (secretValue.trim().length < minLength) {
    throw new Error(`${envName} must be at least ${minLength} characters long.`);
  }
}

export function assertRequiredStartupSecrets(source: NodeJS.ProcessEnv = process.env): void {
  const jwtSecret = requireSecretValue(source, 'JWT_SECRET');
  const webhookEncryptionKey = requireSecretValue(source, 'WEBHOOK_ENCRYPTION_KEY');

  assertSecretMinLength(jwtSecret, 'JWT_SECRET', 32);
  assertSecretMinLength(webhookEncryptionKey, 'WEBHOOK_ENCRYPTION_KEY', 32);
}
