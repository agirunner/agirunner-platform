import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSource() {
  return readFileSync(resolve(import.meta.dirname, './workflow-list-page.tsx'), 'utf8');
}

describe('legacy workflow list page source', () => {
  it('uses delivery posture labels instead of raw workflow-state fallbacks', () => {
    const source = readSource();
    expect(source).toContain('Delivery Posture Fallback');
    expect(source).toContain('resolveDeliveryPosture');
    expect(source).toContain('describeDeliveryPostureLabel');
    expect(source).toContain('Delivery Posture');
    expect(source).toContain('No runs match current filters.');
  });

  it('uses playbook-oriented planning language', () => {
    const source = readSource();
    expect(source).toContain('playbook-aligned delivery plan ready for operator review');
    expect(source).not.toContain('phase-gated plan');
    expect(source).toContain('Run name');
    expect(source).toContain('Start Planning Run');
  });
});
