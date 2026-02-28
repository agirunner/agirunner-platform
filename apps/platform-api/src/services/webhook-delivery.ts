import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function createWebhookSignature(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function verifyWebhookSignature(secret: string, payload: string, signature: string): boolean {
  const expected = createWebhookSignature(secret, payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(signatureBuffer, expectedBuffer);
}

export function generateWebhookSecret(): string {
  return randomBytes(32).toString('hex');
}
