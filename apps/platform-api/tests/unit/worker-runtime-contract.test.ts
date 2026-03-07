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
        workflow_id: 'workflow-123',
        tenant_id: 'tenant-abc',
        role: 'developer',
        input: { objective: 'ship s4' },
        context_stack: {
          workflow: { id: 'workflow-123' },
          agent: { id: 'agent-1' },
        },
        upstream_outputs: {
          architect: { design: 'approved' },
        },
        resource_bindings: [
          {
            type: 'git_repository',
            url: 'https://github.com/agirunner/agirunner-platform.git',
            credentials: {
              token: 'git-token-from-resource',
              ssh_private_key: 'ssh-private-key-from-resource',
              known_hosts: 'github.com ssh-ed25519 AAAA',
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
        defaultRoleConfigs: {
          developer: {
            system_prompt: 'Implement safely',
            tools: ['file_read', 'file_write'],
          },
        },
      },
    );

    expect(submission).toMatchObject({
      task_id: 'task-runtime-1',
      workflow_id: 'workflow-123',
      tenant_id: 'tenant-abc',
      role: 'developer',
      input: { objective: 'ship s4', description: 'ship s4', acceptance_criteria: [] },
      context_stack: {
        workflow: { id: 'workflow-123' },
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
        git_ssh_private_key: 'ssh-private-key-from-resource',
        git_ssh_known_hosts: 'github.com ssh-ed25519 AAAA',
      },
      role_config: {
        planning_mode: true,
        system_prompt: 'Implement safely',
        tools: ['file_read', 'file_write'],
      },
    });
  });

  it('preserves multiline ssh credentials without trimming terminal newlines', () => {
    const privateKey = '-----BEGIN OPENSSH PRIVATE KEY-----\nkey-body\n-----END OPENSSH PRIVATE KEY-----\n';
    const knownHosts = 'git.example.test ssh-ed25519 AAAA\n';

    const submission = buildRuntimeTaskSubmission({
      id: 'task-runtime-ssh',
      role: 'developer',
      input: {
        objective: 'ship s4',
        credentials: {
          git_ssh_private_key: privateKey,
          git_ssh_known_hosts: knownHosts,
        },
      },
    });

    expect(submission.credentials.git_ssh_private_key).toBe(privateKey);
    expect(submission.credentials.git_ssh_known_hosts).toBe(knownHosts);
  });

  it('normalizes string acceptance criteria to the runtime array contract', () => {
    const submission = buildRuntimeTaskSubmission(
      {
        id: 'task-runtime-2',
        tenant_id: 'tenant-abc',
        role: 'project-manager',
        input: {
          goal: 'write a hello world app',
          acceptance_criteria: 'app runs locally',
        },
      },
      {
        llmProvider: 'openai',
        llmModel: 'gpt-4o-mini',
        defaultRoleConfigs: {
          'project-manager': {
            system_prompt: 'Plan the work',
            tools: ['file_read'],
          },
        },
      },
    );

    expect(submission.input).toMatchObject({
      goal: 'write a hello world app',
      description: 'write a hello world app',
      acceptance_criteria: ['app runs locally'],
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
    let taskStatusPolls = 0;

    const server = createServer((req, res) => {
      observedAuthHeader = req.headers.authorization;
      observedPath = req.url;

      if (req.method === 'GET') {
        taskStatusPolls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            task_id: 'task-go-runtime-flag',
            status: 'completed',
            result: {
              output: { accepted: true, via: 'runtime-contract' },
            },
          }),
        );
        return;
      }

      let body = '';
      req.on('data', (chunk) => {
        body += chunk.toString();
      });
      req.on('end', () => {
        observedBody = JSON.parse(body) as Record<string, unknown>;
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ task_id: 'task-go-runtime-flag', status: 'accepted' }));
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
          tenant_id: 'tenant-123',
          role: 'developer',
          input: { objective: 's4 migration' },
          context: { stage: 's4' },
        },
        {
          internalWorkerBackend: 'go-runtime',
          runtimeUrl: `http://127.0.0.1:${address.port}/api/v1/tasks`,
          runtimeApiKey: 'runtime_token',
          agentApiKey: 'llm_key',
          llmProvider: 'openai',
          llmModel: 'gpt-4o-mini',
          defaultRoleConfigs: {
            developer: {
              system_prompt: 'Implement safely',
              tools: ['file_read'],
            },
          },
        },
      );

      expect(result.success).toBe(true);
      expect(result.output).toEqual({ accepted: true, via: 'runtime-contract' });
      expect(observedAuthHeader).toBe('Bearer runtime_token');
      expect(observedPath).toBe('/api/v1/tasks/task-go-runtime-flag');
      expect(observedBody).toMatchObject({
        task_id: 'task-go-runtime-flag',
        tenant_id: 'tenant-123',
        role: 'developer',
        input: { objective: 's4 migration', description: 's4 migration' },
        context_stack: { stage: 's4' },
        credentials: {
          llm_api_key: 'llm_key',
          llm_provider: 'openai',
          llm_model: 'gpt-4o-mini',
        },
        role_config: {
          system_prompt: 'Implement safely',
          tools: ['file_read'],
        },
      });
      expect(taskStatusPolls).toBe(1);
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
