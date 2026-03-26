import { describe, expect, it } from 'vitest';

import { sanitizeSecretLikeValue } from '../../src/services/secret-redaction.js';

describe('sanitizeSecretLikeValue', () => {
  it('does not redact ordinary ids that only contain an sk- substring', () => {
    expect(
      sanitizeSecretLikeValue({
        task_id: 'task-pm-1',
        artifact_task_id: 'task-arch-1',
      }),
    ).toEqual({
      task_id: 'task-pm-1',
      artifact_task_id: 'task-arch-1',
    });
  });

  it('still redacts explicit OpenAI-style secret values', () => {
    expect(sanitizeSecretLikeValue({ api_key: 'sk-secret-value' })).toEqual({
      api_key: 'redacted://secret',
    });
  });

  it('redacts strings that embed bearer or api key secrets inside longer text', () => {
    expect(
      sanitizeSecretLikeValue({
        handoff_summary: 'Implemented the feature. Validation token: Bearer sk-live-secret-value.',
        note: 'Replay with Bearer sk-live-output-secret if the preview fails.',
      }),
    ).toEqual({
      handoff_summary: 'redacted://secret',
      note: 'redacted://secret',
    });
  });

  it('does not redact dotted workflow event names that are not secret material', () => {
    expect(
      sanitizeSecretLikeValue({
        event_type: 'stage.gate.request_changes',
        task_title: 'Orchestrate SDLC Lite Approval Rework: stage.gate.approve',
      }),
    ).toEqual({
      event_type: 'stage.gate.request_changes',
      task_title: 'Orchestrate SDLC Lite Approval Rework: stage.gate.approve',
    });
  });

  it('still redacts JWT-like dotted tokens', () => {
    expect(
      sanitizeSecretLikeValue({
        token: 'eyJhbGciOiJIUzI1NiJ9.payload.signature',
      }),
    ).toEqual({
      token: 'redacted://secret',
    });
  });

  it('redacts remote MCP secret parameter rows based on value_kind and auth-bearing keys', () => {
    expect(
      sanitizeSecretLikeValue({
        parameters: [
          {
            placement: 'header',
            key: 'Authorization',
            valueKind: 'secret',
            value: 'Bearer mcp-secret-token',
          },
          {
            placement: 'query',
            key: 'exaApiKey',
            valueKind: 'secret',
            value: 'exa-secret-value',
          },
          {
            placement: 'initialize_param',
            key: 'workspace_token',
            valueKind: 'secret',
            value: 'workspace-secret-value',
          },
        ],
      }),
    ).toEqual({
      parameters: [
        {
          placement: 'header',
          key: 'Authorization',
          valueKind: 'secret',
          value: 'redacted://secret',
        },
        {
          placement: 'query',
          key: 'exaApiKey',
          valueKind: 'secret',
          value: 'redacted://secret',
        },
        {
          placement: 'initialize_param',
          key: 'workspace_token',
          valueKind: 'secret',
          value: 'redacted://secret',
        },
      ],
    });
  });

  it('redacts oauth-backed remote MCP connection payloads', () => {
    expect(
      sanitizeSecretLikeValue({
        oauth_config: {
          clientId: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
          clientSecret: 'enc:v1:client-secret',
        },
        oauth_credentials: {
          accessToken: 'enc:v1:access-token',
          refreshToken: 'enc:v1:refresh-token',
        },
      }),
    ).toEqual({
      oauth_config: {
        clientId: 'https://platform.example.test/.well-known/oauth/mcp-client.json',
        clientSecret: 'redacted://secret',
      },
      oauth_credentials: {
        accessToken: 'redacted://secret',
        refreshToken: 'redacted://secret',
      },
    });
  });

  it('redacts endpoint urls that embed secret-like query parameters', () => {
    expect(
      sanitizeSecretLikeValue({
        endpoint_url: 'https://mcp.example.test/server?tavilyApiKey=tvly-secret-value&mode=search',
      }),
    ).toEqual({
      endpoint_url: 'redacted://secret',
    });
  });
});
