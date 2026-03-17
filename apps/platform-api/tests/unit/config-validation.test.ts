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
