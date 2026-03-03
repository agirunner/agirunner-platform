/**
 * Centralized configuration for live test harness.
 *
 * All URLs, timeouts, and environment-dependent values are sourced from
 * environment variables with sensible defaults. No hardcoded values.
 */

export type EvaluationMode = 'deterministic' | 'llm';

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
  /** Max wait while polling for a claimable task (ms) */
  claimPollTimeoutMs: number;
  /** Health check wait timeout (ms) */
  healthTimeoutMs: number;
  /** SSE capture duration (ms) */
  sseDurationMs: number;
  /** Docker compose project name for leak detection */
  composeProject: string;
  /** If true, setup skips docker compose stack startup and validates health only */
  skipStackSetup: boolean;
  /**
   * Legacy evaluation mode (kept for backwards compatibility).
   * Hybrid authenticity gate is always enforced in the harness runner.
   */
  evaluationMode: EvaluationMode;
  /** Optional evaluator model selection for llm mode (e.g. gpt-4o-mini) */
  evaluationModel: string;
  /** Optional evaluator provider for llm mode (openai|anthropic|google) */
  evaluationProvider: string;
  /** Authenticity validator LLM provider (phase 1 default: openai). */
  authenticityLlmProvider: string;
  /** Authenticity validator LLM model (default: gpt-4o-mini). */
  authenticityLlmModel: string;
  /** Authenticity validator timeout in milliseconds. */
  authenticityLlmTimeoutMs: number;
  /** Authenticity validator API base URL (provider endpoint). */
  authenticityLlmApiBaseUrl: string;
  /** Max characters per evidence excerpt sent to authenticity LLM validator. */
  authenticityLlmMaxEvidenceChars: number;
}

function parseBooleanEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseEvaluationMode(value: string | undefined): EvaluationMode {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === 'deterministic') {
    return 'deterministic';
  }
  if (normalized === 'llm') {
    return 'llm';
  }
  throw new Error(
    `Invalid LIVE_EVALUATION_MODE value "${value}". Expected "deterministic" (default) or "llm".`,
  );
}

export function assertEvaluationConfig(config: LiveConfig): void {
  if (config.evaluationMode === 'llm') {
    if (!config.evaluationProvider || !config.evaluationModel) {
      throw new Error(
        'LIVE_EVALUATION_MODE=llm requires LIVE_EVALUATION_PROVIDER and LIVE_EVALUATION_MODEL to be set',
      );
    }
  }

  if (!config.authenticityLlmProvider || !config.authenticityLlmModel) {
    throw new Error(
      'LIVE_AUTH_LLM_PROVIDER and LIVE_AUTH_LLM_MODEL are required for hybrid authenticity validation',
    );
  }

  if (!config.authenticityLlmApiBaseUrl) {
    throw new Error('LIVE_AUTH_LLM_API_BASE_URL is required for hybrid authenticity validation');
  }

  if (!Number.isFinite(config.authenticityLlmTimeoutMs) || config.authenticityLlmTimeoutMs <= 0) {
    throw new Error('LIVE_AUTH_LLM_TIMEOUT_MS must be a positive number');
  }

  if (
    !Number.isFinite(config.authenticityLlmMaxEvidenceChars) ||
    config.authenticityLlmMaxEvidenceChars < 200
  ) {
    throw new Error('LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS must be >= 200');
  }
}

function resolveLiveApiBaseUrl(): string {
  if (process.env.LIVE_API_BASE_URL) {
    return process.env.LIVE_API_BASE_URL;
  }

  const apiPort = process.env.PLATFORM_API_PORT ?? '8080';
  return `http://127.0.0.1:${apiPort}`;
}

function resolveLiveDashboardBaseUrl(): string {
  if (process.env.LIVE_DASHBOARD_BASE_URL) {
    return process.env.LIVE_DASHBOARD_BASE_URL;
  }

  const dashboardPort = process.env.DASHBOARD_PORT ?? '3000';
  return `http://127.0.0.1:${dashboardPort}`;
}

function resolveLivePostgresUrl(): string {
  if (process.env.LIVE_POSTGRES_URL) {
    return process.env.LIVE_POSTGRES_URL;
  }

  const postgresPort = process.env.POSTGRES_PORT ?? '5432';
  return `postgresql://agentbaton:agentbaton@127.0.0.1:${postgresPort}/agentbaton`;
}

export function loadConfig(): LiveConfig {
  return {
    apiBaseUrl: resolveLiveApiBaseUrl(),
    dashboardBaseUrl: resolveLiveDashboardBaseUrl(),
    postgresUrl: resolveLivePostgresUrl(),
    taskTimeoutMs: Number(process.env.LIVE_TASK_TIMEOUT_MS ?? 300_000),
    pipelineTimeoutMs: Number(process.env.LIVE_PIPELINE_TIMEOUT_MS ?? 1_800_000),
    pollIntervalMs: Number(process.env.LIVE_POLL_INTERVAL_MS ?? 2_000),
    claimPollTimeoutMs: Number(process.env.LIVE_CLAIM_POLL_TIMEOUT_MS ?? 60_000),
    healthTimeoutMs: Number(process.env.LIVE_HEALTH_TIMEOUT_MS ?? 300_000),
    sseDurationMs: Number(process.env.LIVE_SSE_DURATION_MS ?? 10_000),
    composeProject: process.env.COMPOSE_PROJECT_NAME ?? 'agentbaton-platform',
    skipStackSetup: parseBooleanEnv(process.env.LIVE_SKIP_STACK_SETUP),
    evaluationMode: parseEvaluationMode(process.env.LIVE_EVALUATION_MODE),
    evaluationProvider: process.env.LIVE_EVALUATION_PROVIDER?.trim() ?? '',
    evaluationModel: process.env.LIVE_EVALUATION_MODEL?.trim() ?? '',
    authenticityLlmProvider: process.env.LIVE_AUTH_LLM_PROVIDER?.trim() ?? 'openai',
    authenticityLlmModel: process.env.LIVE_AUTH_LLM_MODEL?.trim() ?? 'gpt-4o-mini',
    authenticityLlmTimeoutMs: Number(process.env.LIVE_AUTH_LLM_TIMEOUT_MS ?? 20_000),
    authenticityLlmApiBaseUrl:
      process.env.LIVE_AUTH_LLM_API_BASE_URL?.trim() ?? 'https://api.openai.com/v1',
    authenticityLlmMaxEvidenceChars: Number(process.env.LIVE_AUTH_LLM_MAX_EVIDENCE_CHARS ?? 1_200),
  };
}
