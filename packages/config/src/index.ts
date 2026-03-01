import { readFileSync } from 'node:fs';

export type WorkerConnectionMode = 'websocket' | 'sse' | 'polling';

export interface WorkerConfig {
  server: {
    url: string;
    authToken?: string;
  };
  runtime: {
    adapter: string;
    settings: Record<string, unknown>;
  };
  capabilities: string[];
  toolTags: {
    required: string[];
    optional: string[];
  };
  connection: {
    mode: WorkerConnectionMode;
    heartbeatIntervalSeconds: number;
    reconnect: {
      minMs: number;
      maxMs: number;
    };
  };
  taskFilter: {
    projectId?: string;
    taskTypes: string[];
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}

const DEFAULT_CONFIG: WorkerConfig = {
  server: {
    url: 'http://localhost:8080',
  },
  runtime: {
    adapter: 'custom-script',
    settings: {},
  },
  capabilities: [],
  toolTags: {
    required: [],
    optional: [],
  },
  connection: {
    mode: 'websocket',
    heartbeatIntervalSeconds: 30,
    reconnect: {
      minMs: 500,
      maxMs: 10_000,
    },
  },
  taskFilter: {
    taskTypes: [],
  },
  logging: {
    level: 'info',
  },
};

export interface LoadWorkerConfigOptions {
  filePath: string;
  env?: NodeJS.ProcessEnv;
}

export function loadWorkerConfig(options: LoadWorkerConfigOptions): WorkerConfig {
  const env = options.env ?? process.env;
  const fromFile = parseWorkerConfigFile(options.filePath);

  const merged = deepMerge(
    DEFAULT_CONFIG as unknown as Record<string, unknown>,
    fromFile as Record<string, unknown>,
  ) as unknown as WorkerConfig;
  return applyEnvOverrides(merged, env);
}

export function parseWorkerConfigFile(filePath: string): Partial<WorkerConfig> {
  const raw = readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Worker config file must contain a JSON object');
  }
  return parsed as Partial<WorkerConfig>;
}

function applyEnvOverrides(base: WorkerConfig, env: NodeJS.ProcessEnv): WorkerConfig {
  return {
    ...base,
    server: {
      ...base.server,
      url: env.AGENTBATON_WORKER_SERVER_URL ?? base.server.url,
      authToken: env.AGENTBATON_WORKER_AUTH_TOKEN ?? base.server.authToken,
    },
    runtime: {
      ...base.runtime,
      adapter: env.AGENTBATON_WORKER_RUNTIME_ADAPTER ?? base.runtime.adapter,
    },
    capabilities: parseCsv(env.AGENTBATON_WORKER_CAPABILITIES) ?? base.capabilities,
    toolTags: {
      required: parseCsv(env.AGENTBATON_WORKER_TOOL_TAGS_REQUIRED) ?? base.toolTags.required,
      optional: parseCsv(env.AGENTBATON_WORKER_TOOL_TAGS_OPTIONAL) ?? base.toolTags.optional,
    },
    connection: {
      ...base.connection,
      mode: parseConnectionMode(env.AGENTBATON_WORKER_CONNECTION_MODE) ?? base.connection.mode,
      heartbeatIntervalSeconds:
        parseInteger(env.AGENTBATON_WORKER_HEARTBEAT_INTERVAL_SECONDS) ?? base.connection.heartbeatIntervalSeconds,
      reconnect: {
        minMs: parseInteger(env.AGENTBATON_WORKER_RECONNECT_MIN_MS) ?? base.connection.reconnect.minMs,
        maxMs: parseInteger(env.AGENTBATON_WORKER_RECONNECT_MAX_MS) ?? base.connection.reconnect.maxMs,
      },
    },
    taskFilter: {
      projectId: env.AGENTBATON_WORKER_FILTER_PROJECT_ID ?? base.taskFilter.projectId,
      taskTypes: parseCsv(env.AGENTBATON_WORKER_FILTER_TASK_TYPES) ?? base.taskFilter.taskTypes,
    },
    logging: {
      level: parseLogLevel(env.AGENTBATON_WORKER_LOG_LEVEL) ?? base.logging.level,
    },
  };
}

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseConnectionMode(value: string | undefined): WorkerConnectionMode | undefined {
  if (value === 'websocket' || value === 'sse' || value === 'polling') {
    return value;
  }
  return undefined;
}

function parseLogLevel(value: string | undefined): WorkerConfig['logging']['level'] | undefined {
  if (value === 'debug' || value === 'info' || value === 'warn' || value === 'error') {
    return value;
  }
  return undefined;
}

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      output[key] &&
      typeof output[key] === 'object' &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }
    output[key] = value;
  }
  return output;
}
