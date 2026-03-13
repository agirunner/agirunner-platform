import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return [
    './project-scheduled-triggers-card.tsx',
    './project-scheduled-trigger-support.ts',
  ]
    .map((path) => readFileSync(resolve(import.meta.dirname, path), 'utf8'))
    .join('\n');
}

describe('project scheduled triggers card source', () => {
  it('adds automation posture packets and next-step guidance before the schedule list', () => {
    const source = readSource();
    expect(source).toContain('buildScheduledTriggerOverview');
    expect(source).toContain('Automation posture is healthy');
    expect(source).toContain('Automation attention is needed');
    expect(source).toContain('Best next step:');
    expect(source).toContain('Schedule coverage');
    expect(source).toContain('Attention needed');
    expect(source).toContain('Next trigger');
  });
});
