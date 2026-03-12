import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-list-page.tsx'), 'utf8');
}

describe('workflow list page source', () => {
  it('uses board-run posture labels instead of raw workflow-state fallbacks', () => {
    const source = readSource();
    expect(source).toContain('Delivery Posture Fallback');
    expect(source).toContain('resolveDeliveryPosture');
    expect(source).toContain('describeDeliveryPostureLabel');
    expect(source).toContain('Delivery Posture');
    expect(source).toContain('No runs match current filters.');
    expect(source).toContain('<h2>Board Runs</h2>');
    expect(source).toContain('Loading board runs...');
  });

  it('uses playbook-oriented board-run planning language', () => {
    const source = readSource();
    expect(source).toContain('playbook-aligned work plan ready for operator review');
    expect(source).toContain('Run name');
    expect(source).toContain('Start Planning Run');
    expect(source).toContain('planning board run');
  });
});
