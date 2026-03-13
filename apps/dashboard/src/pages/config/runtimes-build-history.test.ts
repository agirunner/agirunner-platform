import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './runtimes-build-history.tsx',
    './runtimes-build-history.packet.tsx',
    './runtimes-build-history.support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('runtimes build history source', () => {
  it('upgrades runtime image and build history into packet-first operator surfaces', () => {
    const source = readSource();
    expect(source).toContain('Active Runtime Image');
    expect(source).toContain('Build History');
    expect(source).toContain('Operator recovery brief');
    expect(source).toContain('Recorded builds');
    expect(source).toContain('Current posture');
    expect(source).toContain('describeRuntimePosture');
    expect(source).toContain('describeRuntimeNextAction');
    expect(source).toContain('buildRuntimeRecoveryBrief');
    expect(source).toContain('buildRuntimeHistorySummaryCards');
    expect(source).toContain('Inspect manifest packet');
    expect(source).toContain('ActiveRuntimeManifestPacket');
    expect(source).toContain('Manifest packet');
    expect(source).toContain('Open raw manifest JSON');
    expect(source).not.toContain('Rollback unavailable');
    expect(source).toContain('Recent runtime build linkage and recovery posture');
  });

  it('adds explicit responsive fallbacks instead of relying on tables shrinking', () => {
    const source = readSource();
    expect(source).toContain('lg:hidden');
    expect(source).toContain('hidden overflow-x-auto lg:block');
    expect(source).toContain('RuntimePacket');
    expect(source).toContain('sm:grid-cols-2 xl:grid-cols-3');
    expect(source).toContain('xl:grid-cols-[minmax(0,1fr)_320px]');
    expect(source).toContain('Recovery path');
  });
});
