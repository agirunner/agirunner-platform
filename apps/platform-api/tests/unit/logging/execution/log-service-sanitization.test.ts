import { describe, expect, it } from 'vitest';

import { buildExecutionContractLogPayload } from '../../../../src/services/task-claim/task-claim-llm-contracts.js';
import {
  createLogEntry,
  createLogServiceHarness,
  getInsertCall,
} from './support.js';

describe('LogService', () => {
  describe('insert sanitization', () => {
    it('sanitizes null bytes in payload and error fields before insert', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        source: 'runtime',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          prompt_summary: 'hello\u0000world',
          nested: { response_summary: 'good\u0000bye' },
        },
        error: { message: 'bad\u0000news' },
      }));

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      const error = JSON.parse(params[11] as string);
      expect(payload.prompt_summary).toBe('helloworld');
      expect(payload.nested.response_summary).toBe('goodbye');
      expect(error.message).toBe('badnews');
    });

    it('redacts secrets inside full buffered llm payload fields', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        source: 'runtime',
        category: 'llm',
        operation: 'llm.chat_stream',
        payload: {
          messages: [
            { role: 'user', content: 'Use sk-live-secret-value for this call' },
            { role: 'assistant', content: 'Bearer top-secret-token' },
          ],
          response_text: 'The key is sk-live-secret-value',
          response_tool_calls: [
            { id: 'call-1', name: 'web_fetch', input: { authorization: 'Bearer top-secret-token' } },
          ],
        },
      }));

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      expect(payload.messages).toEqual([
        { role: 'user', content: '[REDACTED]' },
        { role: 'assistant', content: '[REDACTED]' },
      ]);
      expect(payload.response_text).toBe('[REDACTED]');
      expect(payload.response_tool_calls).toEqual([
        { id: 'call-1', name: 'web_fetch', input: { authorization: '[REDACTED]' } },
      ]);
    });

    it('moves non-uuid resource identifiers into resource_name instead of rejecting the row', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        source: 'runtime',
        category: 'container',
        operation: 'container.exec',
        resourceType: 'container',
        resourceId: 'runtime-a59dbff2-b12b9434',
      }));

      const [, params] = getInsertCall(pool)!;
      expect(params[29]).toBeNull();
      expect(params[30]).toBe('runtime-a59dbff2-b12b9434');
    });

    it('redactsEncryptedAndReferencedSecretsInNestedArraysAndErrors', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        category: 'auth',
        level: 'error',
        operation: 'auth.oauth_connection.failed',
        status: 'failed',
        payload: {
          credentials: [
            { access_token: 'enc:v1:token:payload:tag' },
            { api_key_secret_ref: 'secret:OPENAI_API_KEY' },
          ],
        },
        error: {
          message: 'Bearer sk-secret-value leaked',
          stack: 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
        },
      }));

      const [, params] = getInsertCall(pool)!;
      const payload = JSON.parse(params[10] as string);
      const error = JSON.parse(params[11] as string);
      expect(payload.credentials).toBe('[REDACTED]');
      expect(error.message).toBe('[REDACTED]');
      expect(error.stack).toBe('[REDACTED]');
    });

    it('preserves execution contract diagnostics without redacting benign auth presence flags', async () => {
      const { pool, service } = createLogServiceHarness();

      const payload = buildExecutionContractLogPayload({
        llmResolution: {
          resolved: {
            provider: { providerType: 'anthropic' },
            model: {
              modelId: 'claude-sonnet-4-6',
              contextWindow: 200000,
              maxOutputTokens: 64000,
              endpointType: 'messages',
              inputCostPerMillionUsd: 3,
              outputCostPerMillionUsd: 15,
            },
            reasoningConfig: { effort: 'low', reasoning_effort: 'low' },
          },
        } as never,
        loopContract: {
          loopMode: 'tpaov',
          maxIterations: 800,
          llmMaxRetries: 5,
        },
        executionContainer: null,
        executionEnvironment: null,
        agentId: 'agent-1',
        workerId: null,
        task: {
          role_config: {},
          resource_bindings: [{
            type: 'git_repository',
            repository_url: 'https://github.com/example/repo.git',
          }],
          credentials: {
            git_token: 'ghp_example',
          },
        },
      });

      await service.insert(createLogEntry({
        source: 'platform',
        category: 'task_lifecycle',
        operation: 'task.execution_contract_resolved',
        payload,
      }));

      const [, params] = getInsertCall(pool)!;
      const insertedPayload = JSON.parse(params[10] as string);
      expect(insertedPayload).toMatchObject({
        llm_output_limit: 64000,
        git_binding_has_auth: false,
        git_http_auth_present: true,
        git_ssh_material_present: false,
        git_ssh_host_verifier_present: false,
      });
    });

    it('preserves benign token usage metrics on llm completion logs', async () => {
      const { pool, service } = createLogServiceHarness();

      await service.insert(createLogEntry({
        source: 'runtime',
        category: 'llm',
        operation: 'llm.chat_stream',
        status: 'completed',
        payload: {
          input_tokens: 500,
          output_tokens: 120,
          total_tokens: 620,
          reasoning_tokens: 300,
          tokens_before: 1800,
          tokens_after: 1500,
          tokens_saved: 300,
        },
      }));

      const [, params] = getInsertCall(pool)!;
      const insertedPayload = JSON.parse(params[10] as string);
      expect(insertedPayload).toMatchObject({
        input_tokens: 500,
        output_tokens: 120,
        total_tokens: 620,
        reasoning_tokens: 300,
        tokens_before: 1800,
        tokens_after: 1500,
        tokens_saved: 300,
      });
    });
  });
});
