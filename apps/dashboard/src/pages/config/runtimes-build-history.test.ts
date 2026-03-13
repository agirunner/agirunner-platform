import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './runtimes-build-history.tsx'), 'utf8');
}

describe('runtimes build history source', () => {
  it('upgrades runtime image and build history into packet-first operator surfaces', () => {
    const source = readSource();
    expect(source).toContain('Active Runtime Image');
    expect(source).toContain('Build History');
    expect(source).toContain('describeRuntimePosture');
    expect(source).toContain('describeRuntimeNextAction');
    expect(source).toContain('Open manifest packet');
    expect(source).toContain('Rollback unavailable');
    expect(source).toContain('Recent runtime build linkage and recovery posture');
  });

  it('adds explicit responsive fallbacks instead of relying on tables shrinking', () => {
    const source = readSource();
    expect(source).toContain('lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('RuntimePacket');
    expect(source).toContain('Recovery path');
  });
});
