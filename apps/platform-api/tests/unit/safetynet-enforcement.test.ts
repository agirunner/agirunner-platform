import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const projectRoot = join(import.meta.dirname, '..', '..');

describe('platform safetynet enforcement', () => {
  it('keeps the platform safetynet event type inside registry metadata and the logger', () => {
    const matches = findTypeScriptMatches('platform.safetynet.triggered');

    expect(matches).toEqual([
      'src/services/safetynet/logging.ts',
      'src/services/safetynet/registry.ts',
    ]);
  });

  it('keeps the platform safetynet trigger counter inside metrics and the logger', () => {
    const matches = findTypeScriptMatches('safetynetTriggerCounter');

    expect(matches).toEqual([
      'src/observability/metrics.ts',
      'src/services/safetynet/logging.ts',
    ]);
  });
});

function findTypeScriptMatches(needle: string): string[] {
  const sourceRoot = join(projectRoot, 'src');
  const stack = [sourceRoot];
  const matches: string[] = [];

  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readDirEntries(current)) {
      if (entry.kind === 'dir') {
        stack.push(entry.path);
        continue;
      }
      if (!entry.path.endsWith('.ts')) {
        continue;
      }
      const content = readFileSync(entry.path, 'utf8');
      if (!content.includes(needle)) {
        continue;
      }
      matches.push(relative(projectRoot, entry.path).replaceAll('\\', '/'));
    }
  }

  return matches.sort();
}

function readDirEntries(directory: string): Array<{ path: string; kind: 'dir' | 'file' }> {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => ({
    path: join(directory, entry.name),
    kind: entry.isDirectory() ? 'dir' : 'file',
  }));
}
