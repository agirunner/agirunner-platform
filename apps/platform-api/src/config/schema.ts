import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  JWT_EXPIRES_IN: z.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(100),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  HEARTBEAT_GRACE_PERIOD_MS: z.coerce.number().int().min(0).default(300000),
  AGENT_HEARTBEAT_GRACE_PERIOD_MS: z.coerce.number().int().min(0).default(300000),
  AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(60),
  AGENT_KEY_EXPIRY_MS: z.coerce.number().int().min(1).default(31536000000),
  AGENT_HEARTBEAT_TOLERANCE_MS: z.coerce.number().int().min(1).default(2000),
  TASK_DEFAULT_TIMEOUT_MINUTES: z.coerce.number().int().min(1).default(30),
  TASK_DEFAULT_AUTO_RETRY: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('false'),
  TASK_DEFAULT_MAX_RETRIES: z.coerce.number().int().min(0).default(0),
  WORKER_WEBSOCKET_PATH: z.string().min(1).default('/api/v1/events'),
  EVENT_STREAM_PATH: z.string().min(1).default('/api/v1/events'),
  EVENT_STREAM_KEEPALIVE_INTERVAL_MS: z.coerce.number().int().min(1).default(15000),
  WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
  WORKER_API_KEY_TTL_MS: z.coerce.number().int().min(1).default(31536000000),
  AGENT_API_KEY_TTL_MS: z.coerce.number().int().min(1).default(31536000000),
  WORKER_DISPATCH_ACK_TIMEOUT_MS: z.coerce.number().int().min(1).default(15000),
  WORKER_DISPATCH_BATCH_LIMIT: z.coerce.number().int().min(1).default(20),
  WORKER_RECONNECT_MIN_MS: z.coerce.number().int().min(1).default(1000),
  WORKER_RECONNECT_MAX_MS: z.coerce.number().int().min(1).default(60000),
  WORKER_OFFLINE_THRESHOLD_MULTIPLIER: z.coerce.number().min(1).default(2),
  WORKER_DEGRADED_THRESHOLD_MULTIPLIER: z.coerce.number().min(1).default(1),
  WORKER_OFFLINE_GRACE_PERIOD_MS: z.coerce.number().int().min(0).default(300000),
  WORKER_WEBSOCKET_PING_INTERVAL_MS: z.coerce.number().int().min(1).default(20000),
  WEBHOOK_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(4),
  WEBHOOK_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(1).default(200),
  LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(15000),
  LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(15000),
  LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(60000),
  LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS: z.coerce.number().int().min(1).default(2000),
});

export type AppEnv = z.infer<typeof envSchema>;
