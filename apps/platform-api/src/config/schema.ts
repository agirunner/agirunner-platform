import { z } from 'zod';

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
  z.string().url().optional(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8080),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
    WEBHOOK_ENCRYPTION_KEY: z
      .string()
      .min(32, 'WEBHOOK_ENCRYPTION_KEY must be at least 32 characters long'),
    JWT_EXPIRES_IN: z.string().default('1h'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
    RATE_LIMIT_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(100),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    HEARTBEAT_GRACE_PERIOD_MS: z.coerce.number().int().min(0).default(300000),
    WORKFLOW_ACTIVATION_DELAY_MS: z.coerce.number().int().min(0).default(10000),
    WORKFLOW_ACTIVATION_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1).default(1800000),
    WORKFLOW_ACTIVATION_STALE_AFTER_MS: z.coerce.number().int().min(1).default(300000),
    WORKFLOW_BUDGET_WARNING_RATIO: z.coerce.number().gt(0).lte(1).default(0.8),
    TASK_MAX_SUBTASK_DEPTH: z.coerce.number().int().min(1).default(3),
    TASK_MAX_SUBTASKS_PER_PARENT: z.coerce.number().int().min(1).default(20),
    ARTIFACT_STORAGE_BACKEND: z.enum(['local', 's3', 'gcs', 'azure']).default('local'),
    ARTIFACT_LOCAL_ROOT: z.string().min(1).default('/tmp/agirunner-platform-artifacts'),
    ARTIFACT_ACCESS_URL_TTL_SECONDS: z.coerce.number().int().min(1).default(900),
    ARTIFACT_PREVIEW_MAX_BYTES: z.coerce.number().int().min(1).default(1048576),
    WORKSPACE_ARTIFACT_MAX_UPLOAD_FILES: z.coerce.number().int().min(1).default(10),
    WORKSPACE_ARTIFACT_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(10485760),
    ARTIFACT_S3_BUCKET: z.string().optional(),
    ARTIFACT_S3_REGION: z.string().default('us-east-1'),
    ARTIFACT_S3_ENDPOINT: z.string().url().optional(),
    ARTIFACT_S3_ACCESS_KEY_ID: z.string().optional(),
    ARTIFACT_S3_SECRET_ACCESS_KEY: z.string().optional(),
    ARTIFACT_S3_SESSION_TOKEN: z.string().optional(),
    ARTIFACT_S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default('true'),
    ARTIFACT_GCS_BUCKET: z.string().optional(),
    ARTIFACT_GCS_PROJECT_ID: z.string().optional(),
    ARTIFACT_GCS_KEY_FILE: z.string().optional(),
    ARTIFACT_GCS_CREDENTIALS_JSON: z.string().optional(),
    ARTIFACT_AZURE_ACCOUNT_NAME: z.string().optional(),
    ARTIFACT_AZURE_CONTAINER: z.string().optional(),
    ARTIFACT_AZURE_CONNECTION_STRING: z.string().optional(),
    ARTIFACT_AZURE_ACCOUNT_KEY: z.string().optional(),
    TASK_CANCEL_SIGNAL_GRACE_PERIOD_MS: z.coerce.number().int().min(1).default(60000),
    WORKER_WEBSOCKET_PATH: z.string().min(1).default('/api/v1/events'),
    EVENT_STREAM_PATH: z.string().min(1).default('/api/v1/events/stream'),
    WORKER_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(30),
    WORKER_DISPATCH_ACK_TIMEOUT_MS: z.coerce.number().int().min(1).default(15000),
    WORKER_DISPATCH_BATCH_LIMIT: z.coerce.number().int().min(1).default(20),
    WORKER_OFFLINE_THRESHOLD_MULTIPLIER: z.coerce.number().min(1).default(2),
    WORKER_DEGRADED_THRESHOLD_MULTIPLIER: z.coerce.number().min(1).default(1),
    WORKER_OFFLINE_GRACE_PERIOD_MS: z.coerce.number().int().min(0).default(300000),
    PLATFORM_PUBLIC_BASE_URL: z.string().url().default('http://localhost:8080'),
    INTEGRATION_ACTION_TTL_SECONDS: z.coerce.number().int().min(60).default(86400),
    GOVERNANCE_RETENTION_JOB_INTERVAL_MS: z.coerce.number().int().min(1000).default(3600000),
    GOVERNANCE_TASK_PRUNE_AFTER_DAYS: z.coerce.number().int().min(1).default(30),
    GOVERNANCE_WORKFLOW_DELETE_AFTER_DAYS: z.coerce.number().int().min(1).default(30),
    GOVERNANCE_EXECUTION_LOG_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
    GIT_WEBHOOK_MAX_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
    AGIRUNNER_DASHBOARD_URL: optionalUrl,
    AGIRUNNER_BASE_URL: optionalUrl,
    AGIRUNNER_ADMIN_EMAIL: z.string().email().default('admin@agirunner.local'),
    AGIRUNNER_SSO_GOOGLE_CLIENT_ID: z.string().optional(),
    AGIRUNNER_SSO_GOOGLE_CLIENT_SECRET: z.string().optional(),
    AGIRUNNER_SSO_GOOGLE_REDIRECT_URI: optionalUrl,
    AGIRUNNER_SSO_GITHUB_CLIENT_ID: z.string().optional(),
    AGIRUNNER_SSO_GITHUB_CLIENT_SECRET: z.string().optional(),
    AGIRUNNER_SSO_GITHUB_REDIRECT_URI: optionalUrl,
    RUNTIME_URL: optionalUrl,
    RUNTIME_API_KEY: z.string().optional(),
    CONTAINER_MANAGER_CONTROL_URL: z.string().url().default('http://container-manager:9090'),
    CONTAINER_MANAGER_CONTROL_TOKEN: z.string().optional(),
    EXECUTE_ROUTE_MODE: z
      .enum(['disabled', 'test-simulated', 'test-execution-backed'])
      .default('disabled'),
    LIVE_EXECUTOR_API_BASE_URL: optionalUrl,
    LIVE_AUTH_LLM_API_BASE_URL: optionalUrl,
    LIVE_EVALUATION_MODEL: z.string().optional(),
    LIVE_AUTH_LLM_MODEL: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    LIFECYCLE_AGENT_HEARTBEAT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(15000),
    LIFECYCLE_WORKER_HEARTBEAT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(15000),
    LIFECYCLE_TASK_TIMEOUT_CHECK_INTERVAL_MS: z.coerce.number().int().min(1).default(60000),
    LIFECYCLE_DISPATCH_LOOP_INTERVAL_MS: z.coerce.number().int().min(1).default(2000),
    /**
     * FR-820 — External workers run anywhere.
     *
     * Comma-separated list of origins allowed to connect to the worker
     * WebSocket endpoint.  Defaults to '*' (any host) so that external workers
     * can connect from any network location without additional configuration.
     *
     * Example for restricted deployments:
     *   WORKER_ALLOWED_ORIGINS=https://workers.example.com,http://localhost:3000
     */
    WORKER_ALLOWED_ORIGINS: z.string().default('*'),
  })
  .superRefine((env, context) => {
    if (env.ARTIFACT_STORAGE_BACKEND === 's3') {
      requireArtifactSettings(context, env, 's3', [
        ['ARTIFACT_S3_BUCKET', env.ARTIFACT_S3_BUCKET],
        ['ARTIFACT_S3_ACCESS_KEY_ID', env.ARTIFACT_S3_ACCESS_KEY_ID],
        ['ARTIFACT_S3_SECRET_ACCESS_KEY', env.ARTIFACT_S3_SECRET_ACCESS_KEY],
      ]);
    }

    if (env.ARTIFACT_STORAGE_BACKEND === 'gcs') {
      requireArtifactSettings(context, env, 'gcs', [
        ['ARTIFACT_GCS_BUCKET', env.ARTIFACT_GCS_BUCKET],
      ]);
    }

    if (env.ARTIFACT_STORAGE_BACKEND === 'azure') {
      requireArtifactSettings(context, env, 'azure', [
        ['ARTIFACT_AZURE_ACCOUNT_NAME', env.ARTIFACT_AZURE_ACCOUNT_NAME],
        ['ARTIFACT_AZURE_CONTAINER', env.ARTIFACT_AZURE_CONTAINER],
      ]);

      const hasConnectionString = hasValue(env.ARTIFACT_AZURE_CONNECTION_STRING);
      const hasAccountKey = hasValue(env.ARTIFACT_AZURE_ACCOUNT_KEY);
      if (!hasConnectionString && !hasAccountKey) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['ARTIFACT_AZURE_CONNECTION_STRING'],
          message:
            'ARTIFACT_AZURE_CONNECTION_STRING or ARTIFACT_AZURE_ACCOUNT_KEY is required when ARTIFACT_STORAGE_BACKEND=azure',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

function requireArtifactSettings(
  context: z.RefinementCtx,
  env: AppEnv,
  backend: AppEnv['ARTIFACT_STORAGE_BACKEND'],
  required: Array<[keyof AppEnv, string | undefined]>,
): void {
  for (const [field, value] of required) {
    if (!hasValue(value)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when ARTIFACT_STORAGE_BACKEND=${backend}`,
      });
    }
  }
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
