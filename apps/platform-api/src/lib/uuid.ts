import { z } from 'zod';

const uuidSchema = z.string().uuid();

export function readUuidOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const result = uuidSchema.safeParse(value);
  return result.success ? result.data : undefined;
}
