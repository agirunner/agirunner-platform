import { describe, expect, it } from 'vitest';

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
  });
});
