import { describe, expect, it } from 'vitest';

import { loadEnv } from '../../src/config/env.js';

describe('config validation', () => {
  it('accepts valid environment values', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
    });

    expect(env.PORT).toBe(9999);
    expect(env.NODE_ENV).toBe('test');
    expect(env.CORS_ORIGIN).toBe('http://localhost:5173');
    expect(env.ARTIFACT_STORAGE_BACKEND).toBe('local');
    expect('LOG_LEVEL' in env).toBe(false);
  });

  it('does not surface deprecated standalone-agent timing env keys once runtime defaults own that policy', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
      AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS: '45',
      AGENT_HEARTBEAT_GRACE_PERIOD_MS: '120000',
      AGENT_HEARTBEAT_TOLERANCE_MS: '3',
      AGENT_KEY_EXPIRY_MS: '90000',
    });

    expect('AGENT_DEFAULT_HEARTBEAT_INTERVAL_SECONDS' in env).toBe(false);
    expect('AGENT_HEARTBEAT_GRACE_PERIOD_MS' in env).toBe(false);
    expect('AGENT_HEARTBEAT_TOLERANCE_MS' in env).toBe(false);
    expect('AGENT_KEY_EXPIRY_MS' in env).toBe(false);
  });

  it('does not surface deprecated worker or worker-agent API key lifetime env keys once runtime defaults own them', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
      WORKER_API_KEY_TTL_MS: '120000',
      AGENT_API_KEY_TTL_MS: '180000',
    });

    expect('WORKER_API_KEY_TTL_MS' in env).toBe(false);
    expect('AGENT_API_KEY_TTL_MS' in env).toBe(false);
  });

  it('does not surface platform timing env keys once runtime defaults own transport and webhook timing', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
      EVENT_STREAM_KEEPALIVE_INTERVAL_MS: '30000',
      WORKER_RECONNECT_MIN_MS: '1000',
      WORKER_RECONNECT_MAX_MS: '60000',
      WORKER_WEBSOCKET_PING_INTERVAL_MS: '20000',
      WEBHOOK_MAX_ATTEMPTS: '4',
      WEBHOOK_RETRY_BASE_DELAY_MS: '200',
    });

    expect('EVENT_STREAM_KEEPALIVE_INTERVAL_MS' in env).toBe(false);
    expect('WORKER_RECONNECT_MIN_MS' in env).toBe(false);
    expect('WORKER_RECONNECT_MAX_MS' in env).toBe(false);
    expect('WORKER_WEBSOCKET_PING_INTERVAL_MS' in env).toBe(false);
    expect('WEBHOOK_MAX_ATTEMPTS' in env).toBe(false);
    expect('WEBHOOK_RETRY_BASE_DELAY_MS' in env).toBe(false);
  });

  it('does not surface the removed execute compatibility route env knob', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      PORT: '9999',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
      JWT_SECRET: 'a'.repeat(32),
      WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
      EXECUTE_ROUTE_MODE: 'test-simulated',
    });

    expect('EXECUTE_ROUTE_MODE' in env).toBe(false);
  });

  it('rejects invalid configuration', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: 'abc',
        DATABASE_URL: '',
        JWT_SECRET: 'short',
        WEBHOOK_ENCRYPTION_KEY: 'tiny',
      }),
    ).toThrowError();
  });

  it('requires S3 settings when S3 artifact storage is enabled', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '9999',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        JWT_SECRET: 'a'.repeat(32),
        WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
        ARTIFACT_STORAGE_BACKEND: 's3',
      }),
    ).toThrowError(/ARTIFACT_S3_BUCKET/);
  });

  it('requires GCS settings when GCS artifact storage is enabled', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '9999',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        JWT_SECRET: 'a'.repeat(32),
        WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
        ARTIFACT_STORAGE_BACKEND: 'gcs',
      }),
    ).toThrowError(/ARTIFACT_GCS_BUCKET/);
  });

  it('requires Azure settings when Azure artifact storage is enabled', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'test',
        PORT: '9999',
        DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
        JWT_SECRET: 'a'.repeat(32),
        WEBHOOK_ENCRYPTION_KEY: 'b'.repeat(32),
        ARTIFACT_STORAGE_BACKEND: 'azure',
        ARTIFACT_AZURE_ACCOUNT_NAME: 'storage-account',
        ARTIFACT_AZURE_CONTAINER: 'artifacts',
      }),
    ).toThrowError(/ARTIFACT_AZURE_CONNECTION_STRING|ARTIFACT_AZURE_ACCOUNT_KEY/);
  });
});
