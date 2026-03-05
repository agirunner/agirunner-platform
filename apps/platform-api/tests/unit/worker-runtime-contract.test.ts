import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { executeTask } from '../../src/bootstrap/built-in-worker.js';
import {
  buildLegacyWorkerRuntimePayload,
  buildRuntimeTaskSubmission,
  internalWorkerBackendSchema,
} from '../../src/built-in/worker-runtime-contract.js';

describe('worker-runtime contract builders', () => {
  it('buildRuntimeTaskSubmission maps platform task fields to runtime contract shape', () => {
    const submission = buildRuntimeTaskSubmission(
      {
        id: 'task-runtime-1',
        pipeline_id: 'pipeline-123',
        tenant_id: 'tenant-abc',
        role: 'developer',
        input: { objective: 'ship s4' },
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
      input: { objective: 'ship s4' },
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

  it('internalWorkerBackendSchema accepts go-runtime and rejects legacy-node', () => {
    expect(internalWorkerBackendSchema.safeParse('go-runtime').success).toBe(true);
    expect(internalWorkerBackendSchema.safeParse('legacy-node').success).toBe(false);
  });

  it('buildLegacyWorkerRuntimePayload throws deprecation error in go-only mode', () => {
    expect(() =>
      buildLegacyWorkerRuntimePayload({
        id: 'legacy-disabled',
      }),
    ).toThrow(/deprecated and disabled/i);
  });
});

describe('executeTask runtime endpoint behavior', () => {
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
          input: { objective: 's4 migration' },
          context: { stage: 's4' },
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
        input: { objective: 's4 migration' },
        context_stack: { stage: 's4' },
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

  it('fails closed when runtimeUrl is missing', async () => {
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
