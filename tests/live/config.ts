/**
 * Centralized configuration for live test harness.
 *
 * All URLs, timeouts, and environment-dependent values are sourced from
 * environment variables with sensible defaults. No hardcoded values.
 */

export interface LiveConfig {
  /** Platform API base URL */
  apiBaseUrl: string;
  /** Dashboard base URL */
  dashboardBaseUrl: string;
  /** PostgreSQL connection string */
  postgresUrl: string;
  /** Maximum time to wait for a single task to complete (ms) */
  taskTimeoutMs: number;
  /** Maximum time to wait for a full pipeline to complete (ms) */
  pipelineTimeoutMs: number;
  /** Polling interval when checking state (ms) */
  pollIntervalMs: number;
  /** Health check wait timeout (ms) */
  healthTimeoutMs: number;
  /** SSE capture duration (ms) */
  sseDurationMs: number;
  /** Docker compose project name for leak detection */
  composeProject: string;
  /** If true, setup skips docker compose stack startup and validates health only */
  skipStackSetup: boolean;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function loadConfig(): LiveConfig {
  return {
    apiBaseUrl: process.env.LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080',
    dashboardBaseUrl: process.env.LIVE_DASHBOARD_BASE_URL ?? 'http://127.0.0.1:3000',
    postgresUrl:
      process.env.LIVE_POSTGRES_URL ??
      'postgresql://agentbaton:agentbaton@127.0.0.1:5432/agentbaton',
    taskTimeoutMs: Number(process.env.LIVE_TASK_TIMEOUT_MS ?? 300_000),
    pipelineTimeoutMs: Number(process.env.LIVE_PIPELINE_TIMEOUT_MS ?? 1_800_000),
    pollIntervalMs: Number(process.env.LIVE_POLL_INTERVAL_MS ?? 2_000),
    healthTimeoutMs: Number(process.env.LIVE_HEALTH_TIMEOUT_MS ?? 300_000),
    sseDurationMs: Number(process.env.LIVE_SSE_DURATION_MS ?? 10_000),
    composeProject: process.env.COMPOSE_PROJECT_NAME ?? 'agentbaton-platform',
    skipStackSetup: parseBooleanEnv(process.env.LIVE_SKIP_STACK_SETUP),
  };
}
