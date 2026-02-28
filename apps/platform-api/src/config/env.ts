import { envSchema, type AppEnv } from './schema.js';

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}
