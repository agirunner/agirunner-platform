import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource(): string {
  return readFileSync(
    resolve(import.meta.dirname, './execution-inspector-summary-view.tsx'),
    'utf8',
  );
}

describe('execution inspector summary view source', () => {
  it('keeps only three responsive summary regions and removes activity families', () => {
    const source = readSource();

    expect(source).toContain("className=\"grid gap-4 lg:grid-cols-3\"");
    expect(source).toContain("className=\"grid gap-4 md:grid-cols-2\"");
    expect(source).toContain('Top activity paths');
    expect(source).toContain('Role lanes');
    expect(source).toContain('Active runtimes and operators');
    expect(source).toContain('title="Activity coverage"');
    expect(source).toContain('title="Captured runtime"');
    expect(source).not.toContain('Activity families');
    expect(source).not.toContain('Review posture');
    expect(source).not.toContain('Attention');
    expect(source).not.toContain('Top failure');
  });

  it('uses human-friendly copy for activity paths and actor summaries', () => {
    const source = readSource();

    expect(source).toContain('describeActivityPathDetail');
    expect(source).not.toContain('Activity key');
    expect(source).not.toContain('actor_type}:${item.actor_id}');
    expect(source).toContain('describeActorPrimaryLabel');
    expect(source).toContain('describeActorDetail');
    expect(source).toContain("from '../log-viewer/log-actor-presentation.js'");
  });
});
