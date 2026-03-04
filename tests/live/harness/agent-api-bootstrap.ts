import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { loadConfig } from '../config.js';

export interface AgentApiBootstrap {
  /** URL to inject into worker container env (AGENT_API_URL). */
  agentApiUrl: string;
  /** Optional AGENT_API_KEY to inject for endpoint auth. */
  agentApiKey?: string;
  /** Human-readable source descriptor for diagnostics. */
  source: 'provided' | 'harness-live-executor';
  /**
   * When true, URL reachability must be re-checked after docker stack startup.
   * This is used for AP-7 fail-closed lanes where compose setup has not yet
   * started at bootstrap time.
   */
  requiresPostSetupValidation?: boolean;
  dispose: () => Promise<void>;
}

interface ExecutorRequest {
  task_id?: string;
  title?: string;
  type?: string;
  input?: unknown;
  context?: Record<string, unknown>;
}

interface OpenAiTaskResult {
  summary: string;
  implementation: string[];
  changed_files: Array<{
    path: string;
    change: string;
    reason: string;
  }>;
  patch: string;
  tests: string[];
  risks: string[];
  review_notes?: string[];
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const AP7_SCENARIO = 'ap7-failure-recovery';

export async function bootstrapAgentApiEndpoint(params: {
  scenarios: readonly string[];
  provider: string;
  existingUrl?: string;
  existingApiKey?: string;
}): Promise<AgentApiBootstrap | null> {
  if (!usesBuiltInWorker(params.scenarios)) {
    return null;
  }

  const config = loadConfig();
  const ap7FailClosed =
    config.ap7RequireProvidedAgentApiUrl && params.scenarios.includes(AP7_SCENARIO);

  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const existingUrl = params.existingUrl?.trim();
  if (existingUrl) {
    const workerReachableUrl = toWorkerReachableUrl(existingUrl);
    const reachable = await canReachAgentApi(workerReachableUrl, config.agentApiProbeTimeoutMs);

    if (reachable) {
      return {
        agentApiUrl: workerReachableUrl,
        agentApiKey: params.existingApiKey?.trim() || undefined,
        source: 'provided',
        dispose: async () => {},
      };
    }

    if (ap7FailClosed) {
      if (isLocalWorkerEndpoint(workerReachableUrl)) {
        console.warn(
          `AP-7 fail-closed: deferring AGENT_API_URL reachability check until stack bootstrap (${workerReachableUrl}).`,
        );
        return {
          agentApiUrl: workerReachableUrl,
          agentApiKey: params.existingApiKey?.trim() || undefined,
          source: 'provided',
          dispose: async () => {},
        };
      }

      throw new Error(
        `AP-7 fail-closed: provided AGENT_API_URL is unreachable for built-in worker (${workerReachableUrl}). ` +
          'Harness fallback executor is disabled for AP-7 truth-lane execution-path integrity.',
      );
    }

    if (openAiKey) {
      console.warn(
        `Provided AGENT_API_URL appears unreachable for built-in worker (${workerReachableUrl}); falling back to harness live executor.`,
      );
      return startHarnessOpenAiExecutor(openAiKey);
    }

    throw new Error(
      `Provided AGENT_API_URL appears unreachable for built-in worker (${workerReachableUrl}) and OPENAI_API_KEY is unavailable for harness fallback executor.`,
    );
  }

  if (ap7FailClosed) {
    throw new Error(
      'AP-7 fail-closed: AGENT_API_URL must be explicitly configured for built-in worker execution. ' +
        'Harness fallback executor is disabled for AP-7 truth-lane execution-path integrity.',
    );
  }

  // Built-in scenarios require a worker-reachable AGENT_API_URL.
  // For non-AP7 lanes, the harness-hosted executor is transport-compatible
  // across live providers, so bootstrap should not be gated on lane provider.
  if (!openAiKey) {
    return null;
  }

  return startHarnessOpenAiExecutor(openAiKey);
}

function usesBuiltInWorker(scenarios: readonly string[]): boolean {
  const builtInScenarios = new Set([
    'ap1-sdlc-pipeline',
    'ap3-standalone-worker',
    'ap5-full',
    'ap7-failure-recovery',
    'sdlc-happy',
    'sdlc-sad',
    'maintenance-happy',
  ]);
  return scenarios.some((scenario) => builtInScenarios.has(scenario));
}

function toWorkerReachableUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (LOCAL_HOSTNAMES.has(parsed.hostname)) {
    parsed.hostname = 'host.docker.internal';
  }

  if (parsed.pathname === '/health' || parsed.pathname === '/healthz') {
    throw new Error(
      `AGENT_API_URL=${rawUrl} points to a health endpoint. Expected task execution endpoint (e.g. .../execute).`,
    );
  }

  return parsed.toString();
}

function isLocalWorkerEndpoint(workerUrl: string): boolean {
  try {
    const parsed = new URL(workerUrl);
    return parsed.hostname === 'host.docker.internal' || LOCAL_HOSTNAMES.has(parsed.hostname);
  } catch {
    return false;
  }
}

async function canReachAgentApi(workerUrl: string, timeoutMs: number): Promise<boolean> {
  const candidates = new Set<string>();
  candidates.add(workerUrl);

  try {
    const parsed = new URL(workerUrl);
    if (parsed.hostname === 'host.docker.internal') {
      const localhost = new URL(workerUrl);
      localhost.hostname = 'localhost';
      candidates.add(localhost.toString());

      const loopback = new URL(workerUrl);
      loopback.hostname = '127.0.0.1';
      candidates.add(loopback.toString());
    }
  } catch {
    // Keep raw candidate only.
  }

  for (const candidate of candidates) {
    if (await probeHttpEndpoint(candidate, timeoutMs)) {
      return true;
    }
  }

  return false;
}

async function probeHttpEndpoint(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
    });

    return response.status >= 100;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function startHarnessOpenAiExecutor(openAiKey: string): Promise<AgentApiBootstrap> {
  const agentApiKey = `harness-${randomUUID()}`;
  const model = process.env.LIVE_EXECUTOR_MODEL?.trim() || 'gpt-4o-mini';

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (!req.url) {
          writeJson(res, 400, { error: 'missing_url' });
          return;
        }

        if (req.method === 'GET' && req.url === '/health') {
          writeJson(res, 200, { status: 'ok' });
          return;
        }

        if (req.method !== 'POST' || req.url !== '/execute') {
          writeJson(res, 404, { error: 'not_found' });
          return;
        }

        const providedKey = req.headers['x-agent-key'];
        const directKey = Array.isArray(providedKey) ? providedKey[0] : providedKey;

        const authorizationHeader = req.headers.authorization;
        const authorization = Array.isArray(authorizationHeader)
          ? authorizationHeader[0]
          : authorizationHeader;
        const bearerKey =
          typeof authorization === 'string' && authorization.startsWith('Bearer ')
            ? authorization.slice('Bearer '.length).trim()
            : undefined;

        const provided = directKey ?? bearerKey;
        if (provided !== agentApiKey) {
          writeJson(res, 401, { error: 'invalid_agent_key' });
          return;
        }

        const body = await readRequestBody(req, 256_000);
        const payload = safeParseJson<ExecutorRequest>(body);
        const response = await executeWithOpenAi(payload, openAiKey, model);
        writeJson(res, 200, response);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJson(res, 502, { error: 'executor_failed', message });
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '0.0.0.0', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('Failed to bind harness executor server');
  }

  const workerUrl = `http://host.docker.internal:${addr.port}/execute`;

  return {
    agentApiUrl: workerUrl,
    agentApiKey,
    source: 'harness-live-executor',
    dispose: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function resolveOpenAiApiBaseUrl(): string {
  const configured =
    process.env.LIVE_EXECUTOR_API_BASE_URL?.trim() ||
    process.env.LIVE_AUTH_LLM_API_BASE_URL?.trim() ||
    loadConfig().authenticityLlmApiBaseUrl;

  if (!configured) {
    throw new Error('LIVE_EXECUTOR_API_BASE_URL is required for harness OpenAI executor endpoint');
  }

  return configured.replace(/\/+$/, '');
}

async function executeWithOpenAi(
  payload: ExecutorRequest,
  apiKey: string,
  model: string,
): Promise<Record<string, unknown>> {
  const role = deriveRole(payload);
  const prompt = [
    'You are executing one SDLC task inside an autonomous software delivery pipeline.',
    'Return strict JSON only.',
    'Be concrete, implementation-focused, and evidence-backed.',
    'Do not use placeholders, TODOs, or template language.',
    'Include at least one realistic git diff hunk in patch.',
    '',
    `Role: ${role}`,
    `Task title: ${payload.title ?? 'untitled'}`,
    `Task type: ${payload.type ?? 'task'}`,
    `Task input: ${safeStringify(payload.input)}`,
    `Task context: ${safeStringify(payload.context)}`,
  ].join('\n');

  const response = await fetch(`${resolveOpenAiApiBaseUrl()}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are an autonomous software engineer returning structured JSON task outputs for a pipeline worker.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'task_execution_output',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: [
              'summary',
              'implementation',
              'changed_files',
              'patch',
              'tests',
              'risks',
              'review_notes',
            ],
            properties: {
              summary: { type: 'string', minLength: 1 },
              implementation: {
                type: 'array',
                minItems: 2,
                items: { type: 'string', minLength: 1 },
              },
              changed_files: {
                type: 'array',
                minItems: 1,
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['path', 'change', 'reason'],
                  properties: {
                    path: { type: 'string', minLength: 1 },
                    change: { type: 'string', minLength: 1 },
                    reason: { type: 'string', minLength: 1 },
                  },
                },
              },
              patch: { type: 'string', minLength: 20 },
              tests: {
                type: 'array',
                minItems: 1,
                items: { type: 'string', minLength: 1 },
              },
              risks: {
                type: 'array',
                minItems: 1,
                items: { type: 'string', minLength: 1 },
              },
              review_notes: {
                type: 'array',
                items: { type: 'string', minLength: 1 },
              },
            },
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI executor HTTP ${response.status}: ${details}`);
  }

  const parsed = safeParseJson<Record<string, unknown>>(await response.text());
  const content =
    parsed?.choices &&
    Array.isArray(parsed.choices) &&
    parsed.choices[0] &&
    typeof parsed.choices[0] === 'object' &&
    (parsed.choices[0] as { message?: { content?: string } }).message?.content;

  if (typeof content !== 'string' || content.trim().length === 0) {
    throw new Error('OpenAI executor returned empty content');
  }

  const modelOutput = safeParseJson<OpenAiTaskResult>(content);
  if (!modelOutput) {
    throw new Error('OpenAI executor returned invalid JSON output');
  }

  return {
    scenario: deriveScenario(payload),
    task_id: payload.task_id ?? 'unknown-task',
    pipeline_id: derivePipelineId(payload),
    role,
    handled_by: 'ap-live-harness-executor',
    execution_mode: 'live-agent-api',
    summary: modelOutput.summary,
    implementation: modelOutput.implementation,
    changed_files: modelOutput.changed_files,
    patch: modelOutput.patch,
    tests: modelOutput.tests,
    risks: modelOutput.risks,
    review_notes: modelOutput.review_notes ?? [],
  };
}

function deriveRole(payload: ExecutorRequest): string {
  const context = payload.context ?? {};
  const taskContext =
    context.task && typeof context.task === 'object'
      ? (context.task as Record<string, unknown>)
      : undefined;

  const role =
    (typeof taskContext?.role === 'string' && taskContext.role) ||
    (typeof context.role === 'string' && context.role) ||
    payload.type ||
    'unknown-role';

  return role;
}

function deriveScenario(payload: ExecutorRequest): string {
  const context = payload.context ?? {};
  if (typeof context.scenario === 'string' && context.scenario.trim()) {
    return context.scenario;
  }
  return 'sdlc-happy';
}

function derivePipelineId(payload: ExecutorRequest): string | null {
  const context = payload.context ?? {};
  if (typeof context.pipeline_id === 'string' && context.pipeline_id.trim()) {
    return context.pipeline_id;
  }

  if (context.pipeline && typeof context.pipeline === 'object') {
    const pipeline = context.pipeline as Record<string, unknown>;
    if (typeof pipeline.id === 'string' && pipeline.id.trim()) {
      return pipeline.id;
    }
  }

  return null;
}

function safeParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

async function readRequestBody(req: http.IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`request body exceeded ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function writeJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}
