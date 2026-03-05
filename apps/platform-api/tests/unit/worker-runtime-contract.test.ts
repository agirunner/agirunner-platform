import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { executeTask } from '../../src/bootstrap/built-in-worker.js';
import {
  buildLegacyWorkerRuntimePayload,
  buildRuntimeTaskSubmission,
  internalWorkerBackendSchema,
} from '../../src/built-in/worker-runtime-contract.js';

describe('worker-runtime contract builders', () => {
  it('buildLegacyWorkerRuntimePayload preserves legacy executor payload shape', () => {
    const payload = buildLegacyWorkerRuntimePayload({
      id: 'task-legacy-1',
      title: 'Legacy execution',
      type: 'analysis',
      input: { ticket: '90' },
      context: { branch: 'feature/90-v105-s0' },
    });

    expect(payload).toEqual({
      task_id: 'task-legacy-1',
      title: 'Legacy execution',
      type: 'analysis',
      input: { ticket: '90' },
      context: { branch: 'feature/90-v105-s0' },
    });
  });

  it('buildRuntimeTaskSubmission maps platform task fields to runtime contract shape', () => {
    const submission = buildRuntimeTaskSubmission(
      {
        id: 'task-runtime-1',
        pipeline_id: 'pipeline-123',
        tenant_id: 'tenant-abc',
        role: 'developer',
        input: { objective: 'ship s0' },
        context_stack: {
          pipeline: { id: 'pipeline-123' },
          agent: { id: 'agent-1' },
        },
        upstream_outputs: {
          architect: { design: 'approved' },
        },
        resource_bindings: [
          {
            type: 'git_repository',
            url: 'https://github.com/agirunner/agentbaton-platform.git',
            credentials: {
              token: 'git-token-from-resource',
            },
          },
        ],
        role_config: {
          planning_mode: true,
        },
        environment: {
          network_policy: 'restricted',
        },
        constraints: {
          timeout_seconds: 1800,
        },
      },
      {
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
      },
    );

    expect(submission).toMatchObject({
      task_id: 'task-runtime-1',
      pipeline_id: 'pipeline-123',
      tenant_id: 'tenant-abc',
      role: 'developer',
      input: { objective: 'ship s0' },
      context_stack: {
        pipeline: { id: 'pipeline-123' },
        agent: { id: 'agent-1' },
      },
      upstream_outputs: {
        architect: { design: 'approved' },
      },
      constraints: {
        timeout_seconds: 1800,
      },
      credentials: {
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        git_token: 'git-token-from-resource',
      },
    });
  });

  it('internalWorkerBackendSchema rejects unknown migration backend values', () => {
    const parsed = internalWorkerBackendSchema.safeParse('legacy-python');
    expect(parsed.success).toBe(false);
  });
});

describe('executeTask migration endpoint behavior', () => {
  it('uses agentApiKey when agentApiUrl is selected even if runtimeApiKey is also set', async () => {
    let observedAuthHeader: string | undefined;

    const server = createServer((req, res) => {
      observedAuthHeader = req.headers.authorization;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ accepted: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start agent endpoint test server');
    }

    try {
      const result = await executeTask(
        {
          id: 'task-agent-endpoint',
          title: 'Agent API endpoint routing',
          type: 'code',
        },
        {
          internalWorkerBackend: 'legacy-node',
          agentApiUrl: `http://127.0.0.1:${address.port}/execute`,
          agentApiKey: 'agent_token',
          runtimeUrl: 'http://127.0.0.1:65530/runtime',
          runtimeApiKey: 'runtime_token',
        },
      );

      expect(result.success).toBe(true);
      expect(observedAuthHeader).toBe('Bearer agent_token');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    }
  });

  it('uses runtimeApiKey when runtimeUrl fallback is selected even if agentApiKey is also set', async () => {
    let observedAuthHeader: string | undefined;
    let observedBody: Record<string, unknown> | undefined;

    const server = createServer((req, res) => {
      observedAuthHeader = req.headers.authorization;

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        observedBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start runtime fallback test server');
    }

    try {
      const result = await executeTask(
        {
          id: 'task-runtime-fallback',
          title: 'Runtime endpoint fallback',
          type: 'code',
          input: { mode: 'legacy' },
          context: { stage: 's0' },
        },
        {
          internalWorkerBackend: 'legacy-node',
          runtimeUrl: `http://127.0.0.1:${address.port}/execute`,
          runtimeApiKey: 'runtime_token',
          agentApiKey: 'agent_token',
        },
      );

      expect(result.success).toBe(true);
      expect(observedAuthHeader).toBe('Bearer runtime_token');
      expect(observedBody).toEqual({
        task_id: 'task-runtime-fallback',
        title: 'Runtime endpoint fallback',
        type: 'code',
        input: { mode: 'legacy' },
        context: { stage: 's0' },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    }
  });

  it('submits runtime-contract payload when go-runtime backend is enabled', async () => {
    let observedAuthHeader: string | undefined;
    let observedPath: string | undefined;
    let observedBody: Record<string, unknown> | undefined;

    const server = createServer((req, res) => {
      observedAuthHeader = req.headers.authorization;
      observedPath = req.url;

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        observedBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ output: { accepted: true, via: 'runtime-contract' } }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Failed to start go-runtime endpoint test server');
    }

    try {
      const result = await executeTask(
        {
          id: 'task-go-runtime-flag',
          role: 'developer',
          input: { objective: 's3 migration' },
          context: { stage: 's3' },
        },
        {
          internalWorkerBackend: 'go-runtime',
          runtimeUrl: `http://127.0.0.1:${address.port}/api/v1/tasks`,
          runtimeApiKey: 'runtime_token',
          agentApiKey: 'llm_key',
        },
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ accepted: true, via: 'runtime-contract' });
      expect(observedAuthHeader).toBe('Bearer runtime_token');
      expect(observedPath).toBe('/api/v1/tasks');
      expect(observedBody).toMatchObject({
        task_id: 'task-go-runtime-flag',
        role: 'developer',
        input: { objective: 's3 migration' },
        context_stack: { stage: 's3' },
        credentials: {
          llm_api_key: 'llm_key',
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        }),
      );
    }
  });

  it('fails closed when go-runtime backend is selected without runtimeUrl', async () => {
    const result = await executeTask(
      {
        id: 'task-go-runtime-missing-url',
        role: 'developer',
      },
      {
        internalWorkerBackend: 'go-runtime',
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires executor.runtimeUrl');
  });
});
