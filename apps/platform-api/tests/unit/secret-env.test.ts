import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveSecretEnv } from '../../src/config/secret-env.js';

function writeSecretFile(contents: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-secret-env-'));
  const filePath = path.join(tempDir, 'secret.txt');
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

describe('resolveSecretEnv', () => {
  it('does not keep the deprecated requireFileInProduction config knob in source', () => {
    const secretEnvSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../src/config/secret-env.ts'),
      'utf8',
    );
    const appSource = fs.readFileSync(
      path.resolve(import.meta.dirname, '../../src/bootstrap/app.ts'),
      'utf8',
    );

    expect(secretEnvSource).not.toContain('requireFileInProduction');
    expect(appSource).not.toContain('requireFileInProduction');
  });

  it('loads secrets from *_FILE bindings into the target env', () => {
    const filePath = writeSecretFile('secret-from-file\n');
    const target: NodeJS.ProcessEnv = { NODE_ENV: 'production' };

    const resolved = resolveSecretEnv(
      {
        NODE_ENV: 'production',
        PLATFORM_API_KEY_FILE: filePath,
      },
      [{ envName: 'PLATFORM_API_KEY', required: true }],
      target,
    );

    expect(resolved.PLATFORM_API_KEY).toBe('secret-from-file');
  });

  it('rejects mismatched inline and file-backed values', () => {
    const filePath = writeSecretFile('secret-from-file');

    expect(() =>
      resolveSecretEnv(
        {
          NODE_ENV: 'development',
          PLATFORM_API_KEY: 'different-inline-secret',
          PLATFORM_API_KEY_FILE: filePath,
        },
        [{ envName: 'PLATFORM_API_KEY', required: true }],
      ),
    ).toThrow('PLATFORM_API_KEY and PLATFORM_API_KEY_FILE must match');
  });

  it('accepts inline secrets in production without any file-only production override', () => {
    const resolved = resolveSecretEnv(
      {
        NODE_ENV: 'production',
        PLATFORM_API_KEY: 'ar_admin_def_local_dev_123456789012345',
      },
      [{ envName: 'PLATFORM_API_KEY', required: true }],
    );

    expect(resolved.PLATFORM_API_KEY).toBe('ar_admin_def_local_dev_123456789012345');
  });

  it('allows inline secrets outside production when file backing is unavailable', () => {
    const resolved = resolveSecretEnv(
      {
        NODE_ENV: 'development',
        RUNTIME_API_KEY: 'runtime-secret-1234567890',
      },
      [{ envName: 'RUNTIME_API_KEY', required: true, minLength: 20 }],
    );

    expect(resolved.RUNTIME_API_KEY).toBe('runtime-secret-1234567890');
  });

  it('fails when a required secret file is empty', () => {
    const filePath = writeSecretFile('   \n');

    expect(() =>
      resolveSecretEnv(
        {
          NODE_ENV: 'production',
          JWT_SECRET_FILE: filePath,
        },
        [{ envName: 'JWT_SECRET', required: true }],
      ),
    ).toThrow('JWT_SECRET_FILE for JWT_SECRET resolved to an empty file');
  });
});
