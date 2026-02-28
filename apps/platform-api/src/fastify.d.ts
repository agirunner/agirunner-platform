import type pg from 'pg';

import type { ApiKeyIdentity } from './auth/api-key.js';
import type { AppEnv } from './config/schema.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: AppEnv;
    pgPool: pg.Pool;
  }

  interface FastifyRequest {
    auth?: ApiKeyIdentity;
  }
}
